"""Review up to three participants side by side with smooth landmark playback.

Examples (run from the SignSync project folder):

    python scripts/compare_landmarks.py --label FRIEND
    python scripts/compare_landmarks.py --label HELP --participants 1 3 --samples 3 7
    python scripts/compare_landmarks.py --label SORRY --sample-a 3 --sample-b 7 --sample-c 2
    python scripts/compare_landmarks.py --label SORRY --raw-frames
    python scripts/compare_landmarks.py --label WHICH --save-gif which-comparison.gif
    python .\scripts\compare_landmarks.py --label SORRY --samples 1 1 1

Controls:
    Space       pause/resume
    Left/Right step backward/forward and pause
    Shift+Left/Right jump ten display frames and pause
    Up/Down     increase/decrease playback speed
    Home/End    first/last display frame
    Escape      close the viewer
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.animation import FuncAnimation, PillowWriter
from matplotlib.collections import LineCollection


HAND_CONNECTIONS = (
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (17, 18), (18, 19), (19, 20),
    (0, 17),
)

POSE_CONNECTIONS = (
    ("nose", "leftShoulder"),
    ("nose", "rightShoulder"),
    ("leftShoulder", "rightShoulder"),
    ("leftShoulder", "leftElbow"),
    ("leftElbow", "leftWrist"),
    ("rightShoulder", "rightElbow"),
    ("rightElbow", "rightWrist"),
    ("leftShoulder", "leftHip"),
    ("rightShoulder", "rightHip"),
    ("leftHip", "rightHip"),
)

def load_dataset(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as file:
        dataset = json.load(file)

    if dataset.get("schemaVersion") != 1:
        raise ValueError(f"{path.name}: expected schemaVersion 1")
    return dataset


def select_sequence(dataset: dict, label: str, sample_number: int) -> dict:
    matches = [
        sequence
        for sequence in dataset["sequences"]
        if sequence["label"] == label
    ]

    if not matches:
        raise ValueError(f"Label {label!r} was not found")
    if sample_number < 1 or sample_number > len(matches):
        raise ValueError(
            f"{label} has {len(matches)} samples; "
            f"choose --sample between 1 and {len(matches)}"
        )
    sequence = matches[sample_number - 1]
    if not sequence.get("frames"):
        raise ValueError(f"{sequence.get('id')}: no frames to display")
    return sequence


def aligned_frame_index(
    sequence: dict,
    display_index: int,
    display_frames: int,
) -> int:
    progress = display_index / (display_frames - 1)
    return round(progress * (len(sequence["frames"]) - 1))


def landmark_xy(point: dict, mirror: bool) -> tuple[float, float]:
    x = float(point["x"])
    return (1.0 - x if mirror else x, float(point["y"]))


def landmark_arrays(sequence: dict, mirror: bool) -> dict[str, np.ndarray]:
    """Keep missing detections as NaN, never fill tracking gaps."""
    pose_names = tuple(dict.fromkeys(name for edge in POSE_CONNECTIONS for name in edge))
    arrays = {
        "leftHand": np.full((len(sequence["frames"]), 21, 2), np.nan),
        "rightHand": np.full((len(sequence["frames"]), 21, 2), np.nan),
        "pose": np.full((len(sequence["frames"]), len(pose_names), 2), np.nan),
    }
    for index, frame in enumerate(sequence["frames"]):
        raw = frame.get("raw") or {}
        for name in ("leftHand", "rightHand"):
            hand = raw.get(name)
            if hand:
                if len(hand) != 21:
                    raise ValueError(f"{sequence['id']}: expected 21 {name} landmarks")
                arrays[name][index] = [landmark_xy(point, mirror) for point in hand]
        for j, name in enumerate(pose_names):
            point = (raw.get("pose") or {}).get(name)
            if point:
                arrays["pose"][index, j] = landmark_xy(point, mirror)
    return arrays


def display_points(points: np.ndarray, progress: float, smooth: bool) -> np.ndarray:
    position = progress * (len(points) - 1)
    nearest = points[round(position)].copy()
    if not smooth:
        return nearest
    low, high = int(np.floor(position)), int(np.ceil(position))
    fraction = position - low
    valid = np.isfinite(points[low]).all(axis=1) & np.isfinite(points[high]).all(axis=1)
    # Interpolate only where both neighboring frames have a detected landmark.
    nearest[valid] = points[low, valid] * (1 - fraction) + points[high, valid] * fraction
    return nearest


def create_artists(axis):
    groups = {}
    pose_names = tuple(dict.fromkeys(name for edge in POSE_CONNECTIONS for name in edge))
    pose_edges = [(pose_names.index(a), pose_names.index(b)) for a, b in POSE_CONNECTIONS]
    for name, color, label, edges in (
        ("pose", "0.45", "Pose", pose_edges),
        ("leftHand", "tab:blue", "Left hand", HAND_CONNECTIONS),
        ("rightHand", "tab:orange", "Right hand", HAND_CONNECTIONS),
    ):
        lines = LineCollection([], colors=color, linewidths=1.5, alpha=0.85)
        axis.add_collection(lines)
        dots = axis.scatter([], [], color=color, s=18, label=label, zorder=3)
        groups[name] = (lines, dots, np.asarray(edges))
    return groups


def presence_summary(sequence: dict) -> str:
    frames = sequence["frames"]
    left = sum(bool((frame.get("raw") or {}).get("leftHand")) for frame in frames)
    right = sum(bool((frame.get("raw") or {}).get("rightHand")) for frame in frames)
    pose = sum(bool((frame.get("raw") or {}).get("pose")) for frame in frames)
    total = len(frames)
    return (
        f"{total} frames | left {left / total:.0%} | "
        f"right {right / total:.0%} | pose {pose / total:.0%}"
    )


def main() -> None:
    dataset_folder = Path(__file__).resolve().parent.parent.parent / "SignSync Dataset" / "processed"
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--label", default="FRIEND")
    parser.add_argument("--participants", nargs="+", type=int, choices=(1, 2, 3), default=[1, 2, 3], help="Participants in display order (default: 1 2 3)")
    parser.add_argument("--samples", nargs="+", type=int, help="Sample numbers in the same order as --participants")
    for letter, participant in zip("abc", (1, 2, 3)):
        parser.add_argument(f"--sample-{letter}", type=int, default=1, help=f"Participant {participant:02d} sample number")
    parser.add_argument("--fps", type=float, default=30.0, help="Playback FPS (default: 30)")
    parser.add_argument("--display-frames", type=int, default=120, help="Frames per aligned loop (default: 120, or 4 seconds at 30 FPS)")
    parser.add_argument("--raw-frames", action="store_true", help="Show nearest recorded frames without interpolation")
    parser.add_argument("--mirror", action="store_true")
    parser.add_argument("--save-gif", type=Path)
    arguments = parser.parse_args()
    if arguments.display_frames < 2:
        parser.error("--display-frames must be at least 2")
    if not np.isfinite(arguments.fps) or arguments.fps <= 0:
        parser.error("--fps must be a positive finite number")
    if len(set(arguments.participants)) != len(arguments.participants):
        parser.error("Choose each participant only once")
    if arguments.samples is not None and len(arguments.samples) != len(arguments.participants):
        parser.error("Provide one --samples number per selected participant")
    defaults = {1: arguments.sample_a, 2: arguments.sample_b, 3: arguments.sample_c}
    samples = arguments.samples or [defaults[p] for p in arguments.participants]
    label = arguments.label.strip().upper().replace(" ", "_")
    sequences = []
    for participant, sample in zip(arguments.participants, samples):
        path = dataset_folder / f"participant_{participant:02d}-dataset.json"
        sequence = select_sequence(load_dataset(path), label, sample)
        sequences.append(sequence)
        print(f"Participant {participant:02d} | {label} | sample {sample}")
        print(f"  Sequence ID: {sequence['id']}")
        print(f"  {presence_summary(sequence)}")

    arrays = [landmark_arrays(s, arguments.mirror) for s in sequences]
    points = np.concatenate([v.reshape(-1, 2) for a in arrays for v in a.values()])
    points = points[np.isfinite(points).all(axis=1)]
    if not len(points):
        parser.error("Selected samples contain no visible landmarks")
    minimum, maximum = points.min(axis=0), points.max(axis=0)
    padding = np.maximum(maximum - minimum, 0.1) * 0.08
    minimum, maximum = minimum - padding, maximum + padding
    count = len(sequences)
    figure, grid = plt.subplots(1, count, figsize=(6 * count, 7), sharex=True, sharey=True, squeeze=False)
    axes = grid[0]
    mode = "Recorded frames" if arguments.raw_frames else "Interpolated playback (display only)"
    figure.suptitle(f"{label}: normalized-time comparison | {mode}")
    figure.text(0.5, 0.025, "Space: pause/play | Left/Right: step | Shift+Left/Right: jump 10 | Up/Down: speed | Home/End: endpoints | Esc: close", ha="center", fontsize=9)
    figure.subplots_adjust(top=0.82, bottom=0.13, wspace=0.15)
    groups = []
    statuses = []
    for axis, participant, sample, sequence in zip(axes, arguments.participants, samples, sequences):
        axis.set_xlim(minimum[0], maximum[0])
        axis.set_ylim(maximum[1], minimum[1])
        axis.set_aspect("equal", adjustable="box")
        axis.set_title(f"Participant {participant:02d} | sample {sample}\nID: {sequence['id']}", fontsize=9)
        axis.set_xlabel("Camera x")
        axis.grid(alpha=0.15)
        groups.append(create_artists(axis))
        statuses.append(axis.text(0.02, 0.98, "", transform=axis.transAxes, va="top", fontsize=9))
    axes[0].set_ylabel("Camera y")
    axes[-1].legend(loc="lower right")
    state = {"frame": 0, "paused": False, "fps": arguments.fps}
    # Cache display coordinates so playback updates existing artists only.
    cache = [{key: [display_points(value, i / (arguments.display_frames - 1), not arguments.raw_frames)
                    for i in range(arguments.display_frames)] for key, value in data.items()} for data in arrays]

    def draw(index):
        state["frame"] = index
        artists = []
        progress = index / (arguments.display_frames - 1)
        for sequence, data, group, status in zip(sequences, cache, groups, statuses):
            for key, (lines, dots, edges) in group.items():
                xy = data[key][index]
                segments = xy[edges]
                lines.set_segments(segments[np.isfinite(segments).all(axis=(1, 2))])
                dots.set_offsets(xy[np.isfinite(xy).all(axis=1)])
                artists.extend((lines, dots))
            source = aligned_frame_index(sequence, index, arguments.display_frames) + 1
            status.set_text(f"Source frame ~{source}/{len(sequence['frames'])} | {progress:.0%} | {state['fps']:g} FPS")
            artists.append(status)
        return artists

    def frames():
        # Resume from the manually selected frame, rather than a stale iterator.
        for _ in range(arguments.display_frames):
            yield (state["frame"] + 1) % arguments.display_frames

    animation = FuncAnimation(figure, draw, frames=range(arguments.display_frames) if arguments.save_gif else frames, init_func=lambda: draw(state["frame"]),
        interval=1000 / arguments.fps, repeat=True, cache_frame_data=False, blit=False)

    def on_key(event):
        if event.key == " ":
            state["paused"] = not state["paused"]
            if state["paused"]:
                animation.pause()
            else:
                animation.resume()
        elif event.key in ("left", "right", "shift+left", "shift+right", "home", "end"):
            state["paused"] = True
            animation.pause()
            if event.key in ("home", "end"):
                index = 0 if event.key == "home" else arguments.display_frames - 1
            else:
                step = (10 if event.key.startswith("shift+") else 1) * (-1 if event.key.endswith("left") else 1)
                index = (state["frame"] + step) % arguments.display_frames
            draw(index)
            figure.canvas.draw_idle()
        elif event.key in ("up", "down"):
            state["fps"] = min(120.0, max(1.0, state["fps"] * (1.25 if event.key == "up" else 0.8)))
            # TimedAnimation reuses its interval after each tick.
            animation._interval = 1000 / state["fps"]
            animation.event_source.interval = animation._interval
            draw(state["frame"])
            figure.canvas.draw_idle()
        elif event.key == "escape":
            plt.close(figure)

    figure.canvas.mpl_connect("key_press_event", on_key)
    draw(0)
    if arguments.save_gif:
        output = arguments.save_gif.resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        animation.save(output, writer=PillowWriter(fps=arguments.fps))
        plt.close(figure)
        print("Saved:", output)
    else:
        plt.show()


if __name__ == "__main__":
    main()
