"""Play two participants' landmark sequences side by side.

Examples (run from the SignSync project folder):

    python scripts/compare_landmarks.py --label FRIEND
    python scripts/compare_landmarks.py --label HELP --sample-a 3 --sample-b 7
    python scripts/compare_landmarks.py --label WHICH --save-gif which-comparison.gif

Controls:
    Space       pause/resume
    Left/Right step backward/forward while paused
    Escape      close the viewer
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.animation import FuncAnimation, PillowWriter


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
    return matches[sample_number - 1]


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


def all_visible_points(sequence: dict, mirror: bool) -> np.ndarray:
    points: list[tuple[float, float]] = []
    for frame in sequence["frames"]:
        raw = frame.get("raw", {})
        for hand_name in ("leftHand", "rightHand"):
            for point in raw.get(hand_name) or []:
                points.append(landmark_xy(point, mirror))
        for point in (raw.get("pose") or {}).values():
            points.append(landmark_xy(point, mirror))
    return np.asarray(points, dtype=float)


def shared_bounds(sequence_a: dict, sequence_b: dict, mirror: bool):
    points = np.vstack(
        [
            all_visible_points(sequence_a, mirror),
            all_visible_points(sequence_b, mirror),
        ]
    )
    minimum = points.min(axis=0)
    maximum = points.max(axis=0)
    span = np.maximum(maximum - minimum, 0.1)
    padding = span * 0.08
    return minimum - padding, maximum + padding


def draw_hand(axis, hand, color: str, name: str, mirror: bool):
    if not hand:
        return
    points = np.asarray([landmark_xy(point, mirror) for point in hand])
    for start, end in HAND_CONNECTIONS:
        axis.plot(
            points[[start, end], 0],
            points[[start, end], 1],
            color=color,
            linewidth=1.5,
            alpha=0.85,
        )
    axis.scatter(
        points[:, 0],
        points[:, 1],
        color=color,
        s=20,
        label=name,
        zorder=3,
    )


def draw_pose(axis, pose, mirror: bool):
    if not pose:
        return
    for start, end in POSE_CONNECTIONS:
        if start not in pose or end not in pose:
            continue
        start_xy = landmark_xy(pose[start], mirror)
        end_xy = landmark_xy(pose[end], mirror)
        axis.plot(
            [start_xy[0], end_xy[0]],
            [start_xy[1], end_xy[1]],
            color="0.45",
            linewidth=2,
            alpha=0.75,
        )
    points = np.asarray([landmark_xy(point, mirror) for point in pose.values()])
    axis.scatter(
        points[:, 0],
        points[:, 1],
        color="0.35",
        s=24,
        label="Pose",
        zorder=2,
    )


def presence_summary(sequence: dict) -> str:
    frames = sequence["frames"]
    left = sum(bool(frame.get("raw", {}).get("leftHand")) for frame in frames)
    right = sum(bool(frame.get("raw", {}).get("rightHand")) for frame in frames)
    pose = sum(bool(frame.get("raw", {}).get("pose")) for frame in frames)
    total = len(frames)
    return (
        f"{total} frames | left {left / total:.0%} | "
        f"right {right / total:.0%} | pose {pose / total:.0%}"
    )


def main() -> None:
    project_folder = Path(__file__).resolve().parent.parent
    dataset_folder = project_folder.parent / "SignSync Dataset" / "processed"

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label", default="FRIEND", help="Sign label to compare")
    parser.add_argument("--sample-a", type=int, default=1, help="Participant 01 sample number")
    parser.add_argument("--sample-b", type=int, default=1, help="Participant 02 sample number")
    parser.add_argument("--fps", type=float, default=15.0, help="Playback speed (default: 15)")
    parser.add_argument(
        "--display-frames",
        type=int,
        default=60,
        help="Aligned animation frames per loop (default: 60)",
    )
    parser.add_argument("--mirror", action="store_true", help="Mirror the x-axis like a selfie camera")
    parser.add_argument("--save-gif", type=Path, help="Optional output GIF path")
    arguments = parser.parse_args()

    if arguments.display_frames < 2:
        parser.error("--display-frames must be at least 2")

    label = arguments.label.strip().upper().replace(" ", "_")
    dataset_a = load_dataset(dataset_folder / "participant_01-dataset.json")
    dataset_b = load_dataset(dataset_folder / "participant_02-dataset.json")
    sequence_a = select_sequence(dataset_a, label, arguments.sample_a)
    sequence_b = select_sequence(dataset_b, label, arguments.sample_b)

    minimum, maximum = shared_bounds(sequence_a, sequence_b, arguments.mirror)
    figure, axes = plt.subplots(1, 2, figsize=(12, 7), sharex=True, sharey=True)
    figure.suptitle(f"{label}: normalized-time landmark comparison")
    figure.text(
        0.5,
        0.02,
        "Space: pause/play   ←/→: step   Esc: close",
        ha="center",
    )

    state = {"frame": 0, "paused": False}

    def draw(display_index: int):
        state["frame"] = display_index
        progress = display_index / (arguments.display_frames - 1)
        for axis, sequence, participant, sample_number in (
            (axes[0], sequence_a, "Participant 01", arguments.sample_a),
            (axes[1], sequence_b, "Participant 02", arguments.sample_b),
        ):
            frame_index = aligned_frame_index(
                sequence,
                display_index,
                arguments.display_frames,
            )
            raw = sequence["frames"][frame_index].get("raw", {})
            axis.clear()
            draw_pose(axis, raw.get("pose"), arguments.mirror)
            draw_hand(axis, raw.get("leftHand"), "tab:blue", "Left hand", arguments.mirror)
            draw_hand(axis, raw.get("rightHand"), "tab:orange", "Right hand", arguments.mirror)
            axis.set_xlim(minimum[0], maximum[0])
            axis.set_ylim(maximum[1], minimum[1])
            axis.set_aspect("equal", adjustable="box")
            axis.set_title(
                f"{participant} · sample {sample_number}\n"
                f"{sequence['id'][:8]} · frame {frame_index + 1}/{len(sequence['frames'])} "
                f"· {progress:.0%}"
            )
            axis.set_xlabel("Camera x")
            axis.grid(alpha=0.15)
        axes[0].set_ylabel("Camera y")
        handles, labels = axes[1].get_legend_handles_labels()
        if handles:
            axes[1].legend(handles, labels, loc="lower right")
        return []

    animation = FuncAnimation(
        figure,
        draw,
        frames=range(arguments.display_frames),
        interval=1000 / arguments.fps,
        repeat=True,
        cache_frame_data=False,
    )

    def on_key(event):
        if event.key == " ":
            state["paused"] = not state["paused"]
            if state["paused"]:
                animation.event_source.stop()
            else:
                animation.event_source.start()
        elif event.key in ("left", "right"):
            state["paused"] = True
            animation.event_source.stop()
            step = -1 if event.key == "left" else 1
            state["frame"] = (
                state["frame"] + step
            ) % arguments.display_frames
            draw(state["frame"])
            figure.canvas.draw_idle()
        elif event.key == "escape":
            plt.close(figure)

    figure.canvas.mpl_connect("key_press_event", on_key)

    print("Participant 01:", presence_summary(sequence_a))
    print("Participant 02:", presence_summary(sequence_b))

    if arguments.save_gif:
        output_path = arguments.save_gif.resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        animation.save(output_path, writer=PillowWriter(fps=arguments.fps))
        print("Saved:", output_path)
    else:
        plt.show()


if __name__ == "__main__":
    main()
