r"""Compare participant recordings or archived 32-sign batches side by side.

Examples (run from the SignSync project folder):

    python scripts/compare_landmarks.py --label FRIEND
    python scripts/compare_landmarks.py --label HELP --participants 1 3 --samples 3 7
    python scripts/compare_landmarks.py --label SORRY --sample-a 3 --sample-b 7 --sample-c 2
    python scripts/compare_landmarks.py --label FAMILY --label-c HELP --sample-a 2 --sample-b 5 --sample-c 3
    python scripts/compare_landmarks.py --label PLEASE --label-b SORRY --samples 1 1 1
    python .\scripts\compare_landmarks.py --label HELP --sample-a 6 --sample-b 6 --label-c FAMILY --sample-c 6
    python scripts/compare_landmarks.py --label HELP --id-c 015e578e-6e63-4f96-b204-97f66bfd4e4d
    python scripts/compare_landmarks.py --label SORRY --raw-frames
    python scripts/compare_landmarks.py --label WHICH --save-gif which-comparison.gif
    python scripts/compare_landmarks.py --label SORRY --samples 1 1 1
    python scripts/compare_landmarks.py --dataset-version v2 --participants 3 --id-c d63561e7 --raw-frames
    python scripts/compare_landmarks.py --dataset-version v5 --raw-frames --label STAY --samples 1 1 1
    python scripts/compare_landmarks.py --batches --label PERSON --raw-frames
    python scripts/compare_landmarks.py --batches --label STUDENT --samples 7

Controls:
    Space       pause/resume
    Left/Right step backward/forward and pause
    Shift+Left/Right jump ten display frames and pause
    Up/Down     increase/decrease playback speed
    Home/End    first/last display frame
    Escape      close the viewer
"""

from __future__ import annotations
from processed_paths import processed_artifact_path

import argparse
import json
from math import ceil
from pathlib import Path
import re
from time import perf_counter
from zipfile import BadZipFile, ZipFile

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.animation import FuncAnimation, PillowWriter
from matplotlib.transforms import Bbox


DEFAULT_PLAYBACK_FPS = 120
DEFAULT_GIF_FPS = 60
DEFAULT_DISPLAY_FRAMES = 240
MAX_REFRESH_FPS = 120


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


def select_sequence_by_id(dataset: dict, sequence_id: str) -> tuple[dict, int]:
    """Resolve a full ID or unique prefix, returning its within-label sample number."""
    sequence_id = sequence_id.strip()
    if not sequence_id:
        raise ValueError("Sequence ID must not be empty")
    matches = [s for s in dataset["sequences"] if s["id"] == sequence_id]
    if not matches:
        matches = [s for s in dataset["sequences"] if s["id"].startswith(sequence_id)]
    if not matches:
        raise ValueError(f"Sequence ID {sequence_id!r} was not found in this participant's dataset")
    if len(matches) != 1:
        raise ValueError(f"Sequence ID {sequence_id!r} is ambiguous; use the full ID")
    sequence = matches[0]
    if not sequence.get("frames"):
        raise ValueError(f"{sequence['id']}: no frames to display")
    same_label = [s for s in dataset["sequences"] if s["label"] == sequence["label"]]
    number = next(i for i, s in enumerate(same_label, 1) if s["id"] == sequence["id"])
    return sequence, number


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
        lines, = axis.plot([], [], color=color, linewidth=1.5, alpha=0.85, solid_capstyle="butt")
        dots, = axis.plot([], [], color=color, marker="o", markersize=18 ** 0.5,
                          markeredgewidth=plt.rcParams["patch.linewidth"], linestyle="none", label=label, zorder=3)
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


def maximize_window(canvas):
    if not canvas.required_interactive_framework or canvas.manager is None:
        return

    manager = canvas.manager
    window = getattr(manager, "window", None)
    for method in ("showMaximized", "Maximize"):
        maximize = getattr(window, method, None)
        if callable(maximize):
            maximize()
            return
    if hasattr(window, "wm_state"):
        from tkinter import TclError

        try:
            window.wm_state("zoomed")
            return
        except TclError:
            pass
    manager.full_screen_toggle()


def play_interactive(figure, artists, statuses, draw_frame, frame_count, fps):
    canvas = figure.canvas
    timer = canvas.new_timer()
    frame = start_frame = 0
    start_time = None
    next_status_update = 0.0
    plot_background = status_background = None
    plot_region = status_region = None
    artists = sorted(artists, key=lambda artist: artist.get_zorder())
    if canvas.supports_blit:
        for artist in (*artists, *statuses):
            artist.set_animated(True)

    def blit_region(region, background, animated):
        canvas.restore_region(background)
        renderer = canvas.get_renderer()
        for artist in animated:
            artist.draw(renderer)
        canvas.blit(region)

    def render(index, update_status=False):
        nonlocal frame, next_status_update
        frame = index
        now = perf_counter()
        update_status = update_status or now >= next_status_update
        if update_status:
            next_status_update = now + 0.2
        draw_frame(frame, fps, update_status)
        if plot_background is None:
            canvas.draw_idle()
        else:
            blit_region(plot_region, plot_background, artists)
            if update_status and status_background is not None:
                blit_region(status_region, status_background, statuses)

    def start():
        nonlocal start_frame, start_time
        start_frame = frame
        start_time = perf_counter()
        timer.interval = ceil(1000 * min(1.0, 1 / min(fps, MAX_REFRESH_FPS)))
        timer.start()

    def pause():
        nonlocal start_time
        timer.stop()
        start_time = None

    def tick():
        if start_time is None or not plt.fignum_exists(figure.number):
            pause()
            return
        # Select the frame due now and schedule against the next deadline.
        # Slow draws can skip frames without stretching the aligned loop.
        now = perf_counter()
        loop_elapsed = (now - start_time) % (frame_count / fps)
        steps = int(loop_elapsed * fps)
        index = (start_frame + steps) % frame_count
        if index != frame:
            render(index)
        next_frame_delay = (steps + 1) / fps - loop_elapsed
        remaining = max(next_frame_delay, 1 / MAX_REFRESH_FPS) - (perf_counter() - now)
        timer.interval = max(1, ceil(1000 * min(1.0, remaining)))

    def on_draw(event):
        nonlocal plot_background, plot_region, status_background, status_region
        if event.canvas.is_saving():
            # Saving can replace the renderer, especially with a different DPI.
            plot_background = status_background = None
            return
        if not canvas.supports_blit:
            return
        # A full redraw replaces the backgrounds after resizing or toolbar use.
        plot_region = Bbox.intersection(Bbox.union([axis.bbox for axis in figure.axes]).padded(1), figure.bbox)
        text_box = Bbox.union([status.get_window_extent(event.renderer) for status in statuses]).padded(2)
        # Leave room for counters with additional digits in later frames.
        status_region = Bbox.intersection(Bbox.from_extents(0, text_box.y0, figure.bbox.x1, text_box.y1), figure.bbox)
        plot_background = canvas.copy_from_bbox(plot_region) if plot_region is not None else None
        status_background = canvas.copy_from_bbox(status_region) if status_region is not None else None
        for artist in (*artists, *statuses):
            artist.draw(event.renderer)

    def on_resize(event):
        nonlocal plot_background, status_background
        plot_background = status_background = None

    def on_key(event):
        nonlocal fps
        if event.key == " ":
            if start_time is None:
                start()
            else:
                pause()
                render(frame, update_status=True)
        elif event.key in ("left", "right", "shift+left", "shift+right", "home", "end"):
            pause()
            if event.key in ("home", "end"):
                index = 0 if event.key == "home" else frame_count - 1
            else:
                step = (10 if event.key.startswith("shift+") else 1) * (-1 if event.key.endswith("left") else 1)
                index = (frame + step) % frame_count
            render(index, update_status=True)
        elif event.key in ("up", "down"):
            fps = min(MAX_REFRESH_FPS, max(1.0, fps * (1.25 if event.key == "up" else 0.8)))
            render(frame, update_status=True)
            if start_time is not None:
                start()
        elif event.key == "escape":
            pause()
            plt.close(figure)

    timer.add_callback(tick)
    canvas.mpl_connect("draw_event", on_draw)
    canvas.mpl_connect("resize_event", on_resize)
    canvas.mpl_connect("key_press_event", on_key)
    canvas.mpl_connect("close_event", lambda event: pause())
    draw_frame(0, fps, True)
    maximize_window(canvas)
    canvas.draw_idle()
    start()
    plt.show()


def batch_folders(dataset_root):
    intake = dataset_root / "experiments" / "samples_75_signs_batch_expansion_v1" / "intake.json"
    rows = json.loads(intake.read_text(encoding="utf-8"))["samples"]
    folders = {}
    for row in rows:
        folders.setdefault(row["label"], set()).add(dataset_root / "raw" / Path(row["batch"]).parent)
    return folders


def archive_takes(archive, label):
    with ZipFile(archive) as bundle:
        return [
            sequence
            for member in sorted(bundle.namelist()) if member.lower().endswith(".json")
            for sequence in json.loads(bundle.read(member))["sequences"]
            if sequence["label"] == label
        ]


def take_source(take):
    filename = Path((take.get("videoImport") or {}).get("filename", ""))
    if filename.suffix.lower() == ".mp4":
        return "WIN MP4" if filename.name.upper().startswith("WIN_") else "Named MP4"
    return filename.suffix.lower()


def batch_participant(archive, sources):
    if sources == {"Named MP4"}:
        if archive.name == "signsync-dataset-fast-20x-2026-11-14_20-56-07-samples.zip":
            return "P2 Joem"
        if archive.name == "signsync-dataset-fast-20x-2026-11-15_02-49-30-samples.zip":
            return "P3 Almari"
    if sources == {".webm"}:
        return "P1"
    if sources == {".mov"}:
        return "P4"
    if archive.name == "signsync-dataset-student-20x-2026-11-14_18-43-50-samples.zip" and sources == {"WIN MP4"}:
        return "P2 Joem"
    if sources == {"WIN MP4"}:
        return "P2 Joem (inferred)"
    if sources == {"Named MP4"}:
        return "P3 Almari (inferred)"
    if sources == {"WIN MP4", "Named MP4"}:
        return "Mixed MP4"
    return "Unassigned"


def batch_panels(dataset_root, label, samples):
    label = label.strip().upper().replace(" ", "_")
    folders = batch_folders(dataset_root).get(label, ())
    archives = sorted(path for folder in folders for path in folder.glob("*.zip"))
    if not archives:
        raise ValueError(f"No 32-sign batch archives found for {label!r}; choose a sign with --label")
    numbers = samples or [1]
    if len(numbers) == 1:
        numbers = numbers * len(archives)
    if len(numbers) != len(archives):
        raise ValueError(f"Provide one --samples number for all batches or one for each of the {len(archives)} batches")

    batches = []
    slots = {"P1": 1, "P2": 2, "P3": 3, "Mixed": 3, "P4": 4}
    for index, archive in enumerate(archives, 1):
        try:
            sequences = archive_takes(archive, label)
        except (KeyError, BadZipFile, OSError, ValueError) as error:
            raise ValueError(f"{archive.name}: {error}") from error
        source = batch_participant(archive, {take_source(take) for take in sequences})
        slot = slots.get(source.split()[0], 5)
        batches.append((slot, index, archive, source, sequences))
    batches.sort(key=lambda batch: (batch[0], batch[1]))

    panels = []
    for (_, index, archive, source, sequences), number in zip(batches, numbers):
        try:
            sequence = select_sequence({"sequences": sequences}, label, number)
            if not any(any((frame.get("raw") or {}).get(group) for group in ("pose", "leftHand", "rightHand"))
                       for frame in sequence["frames"]):
                raise ValueError(f"sample {number} contains no raw landmarks")
        except ValueError as error:
            raise ValueError(f"{archive.name}: {error}") from error
        if source == "Mixed MP4":
            source = ("P3 Almari (inferred, mixed batch)" if take_source(sequence) == "Named MP4"
                      else "Unassigned (mixed batch)")
        heading = f"{source} | Batch {index:02d} | {label} | sample {number}/{len(sequences)}"
        panels.append((heading, archive.name, sequence))
    return panels


def participant_panels(parser, arguments, dataset_folder):
    if arguments.dataset_version != "baseline" and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", arguments.dataset_version):
        parser.error("--dataset-version must be baseline or a simple version suffix such as v2")
    if len(set(arguments.participants)) != len(arguments.participants):
        parser.error("Choose each participant only once")
    if arguments.samples is not None and len(arguments.samples) != len(arguments.participants):
        parser.error("Provide one --samples number per selected participant")
    defaults = {1: arguments.sample_a, 2: arguments.sample_b, 3: arguments.sample_c}
    samples = arguments.samples or [defaults[p] for p in arguments.participants]
    participant_labels = {
        participant: (getattr(arguments, f"label_{letter}") or arguments.label).strip().upper().replace(" ", "_")
        for letter, participant in zip("abc", (1, 2, 3))
    }
    panels = []
    for letter, participant in zip("abc", (1, 2, 3)):
        if getattr(arguments, f"id_{letter}") is not None and participant not in arguments.participants:
            parser.error(f"--id-{letter} requires participant {participant} in --participants")
    for participant, sample in zip(arguments.participants, samples):
        label = participant_labels[participant]
        suffix = "" if arguments.dataset_version == "baseline" else f"-{arguments.dataset_version}"
        path = processed_artifact_path(dataset_folder, f"participant_{participant:02d}-dataset{suffix}.json")
        if not path.is_file():
            parser.error(f"Participant {participant:02d} dataset was not found: {path}")
        dataset = load_dataset(path)
        sequence_id = getattr(arguments, f"id_{'abc'[participant - 1]}")
        try:
            if sequence_id is not None:
                sequence, sample = select_sequence_by_id(dataset, sequence_id)
                label = sequence["label"]
            else:
                sequence = select_sequence(dataset, label, sample)
        except ValueError as error:
            parser.error(f"Participant {participant:02d}: {error}")
        panels.append((f"Participant {participant:02d} | {label} | sample {sample}", path.name, sequence))
    return panels


def main() -> None:
    dataset_root = Path(__file__).resolve().parent.parent.parent / "SignSync Dataset"
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--batches", action="store_true", help="Compare all archives for a sign from the 32-sign vocabulary")
    parser.add_argument("--dataset-version", default="baseline", help="Participant dataset version: baseline (default) or a saved suffix such as v2")
    parser.add_argument("--label", default="FRIEND", help="Sign to compare; --label-a/b/c override it in participant mode")
    parser.add_argument("--participants", nargs="+", type=int, choices=(1, 2, 3), default=[1, 2, 3], help="Participants in display order (default: 1 2 3)")
    parser.add_argument("--samples", nargs="+", type=int, help="One number per participant; in batch mode, one for all batches or one per displayed panel in P1–P4 order")
    for letter, participant in zip("abc", (1, 2, 3)):
        parser.add_argument(f"--sample-{letter}", f"--samples-{letter}", type=int, default=1, help=f"Participant {participant:02d} sample number within its selected sign")
        parser.add_argument(f"--label-{letter}", help=f"Sign for Participant {participant:02d} (overrides --label)")
        parser.add_argument(f"--id-{letter}", help=f"Full sequence ID or unique prefix for Participant {participant:02d}; overrides its label and sample number")
    parser.add_argument("--fps", type=float, help=f"Frames per second (default: {DEFAULT_PLAYBACK_FPS} for the viewer, {DEFAULT_GIF_FPS} for GIF export)")
    parser.add_argument("--display-frames", type=int, default=DEFAULT_DISPLAY_FRAMES, help="Frames per aligned loop (default: %(default)s)")
    parser.add_argument("--raw-frames", action="store_true", help="Show nearest recorded frames without interpolation")
    parser.add_argument("--mirror", action="store_true")
    parser.add_argument("--save-gif", type=Path)
    arguments = parser.parse_args()
    if arguments.fps is None:
        arguments.fps = DEFAULT_GIF_FPS if arguments.save_gif else DEFAULT_PLAYBACK_FPS
    if arguments.display_frames < 2:
        parser.error("--display-frames must be at least 2")
    if not np.isfinite(arguments.fps) or arguments.fps <= 0:
        parser.error("--fps must be a positive finite number")
    if arguments.batches:
        try:
            panels = batch_panels(dataset_root, arguments.label, arguments.samples)
        except (OSError, ValueError) as error:
            parser.error(str(error))
    else:
        panels = participant_panels(parser, arguments, dataset_root / "processed")
    sequences = []
    for heading, filename, sequence in panels:
        sequences.append(sequence)
        print(f"{heading} | {filename}")
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
    compared_labels = " / ".join(dict.fromkeys(sequence["label"] for sequence in sequences))
    source_name = "Batch archives" if arguments.batches else arguments.dataset_version
    title = f"{compared_labels}: normalized-time comparison | {mode} | {source_name}"
    if not arguments.save_gif:
        title += f" | {MAX_REFRESH_FPS} FPS refresh limit"
    figure.suptitle(title)
    figure.text(0.5, 0.025, "Space: pause/play | Left/Right: step | Shift+Left/Right: jump 10 | Up/Down: speed | Home/End: endpoints | Esc: close", ha="center", fontsize=9)
    figure.subplots_adjust(top=0.82, bottom=0.13, wspace=0.15)
    groups = []
    statuses = []
    for axis, (heading, _, sequence) in zip(axes, panels):
        axis.set_xlim(minimum[0], maximum[0])
        axis.set_ylim(maximum[1], minimum[1])
        axis.set_aspect("equal", adjustable="box")
        title = f"{heading}\nID: {sequence['id']}"
        if arguments.batches:
            filename = (sequence.get("videoImport") or {}).get("filename") or "Source filename unavailable"
            title = f"{heading}\n{filename}\nID: {sequence['id']}"
        axis.set_title(title, fontsize=9, pad=24)
        axis.set_xlabel("Camera x")
        axis.grid(alpha=0.15)
        groups.append(create_artists(axis))
        statuses.append(axis.annotate("", (0.02, 1), xycoords="axes fraction", xytext=(0, 4),
                                      textcoords="offset points", va="bottom", fontsize=9))
    axes[0].set_ylabel("Camera y")
    handles, labels = axes[-1].get_legend_handles_labels()
    figure.legend(handles, labels, loc="upper center", bbox_to_anchor=(0.5, 0.945), ncols=3)
    cache = []
    for data, group in zip(arrays, groups):
        display_data = {}
        for key, (_, _, edges) in group.items():
            xy = np.stack([display_points(data[key], i / (arguments.display_frames - 1), not arguments.raw_frames)
                           for i in range(arguments.display_frames)])
            xy[~np.isfinite(xy).all(axis=2)] = np.nan
            # A NaN separates each bone so one path can draw every segment.
            segments = np.full((arguments.display_frames, len(edges), 3, 2), np.nan)
            segments[:, :, :2] = xy[:, edges]
            display_data[key] = (xy, segments.reshape(arguments.display_frames, -1, 2))
        cache.append(display_data)

    def draw(index, fps, update_status):
        progress = index / (arguments.display_frames - 1)
        for sequence, data, group, status in zip(sequences, cache, groups, statuses):
            for key, (lines, dots, _) in group.items():
                xy, segments = data[key]
                lines.set_data(*segments[index].T)
                dots.set_data(*xy[index].T)
            if update_status:
                source = aligned_frame_index(sequence, index, arguments.display_frames) + 1
                status.set_text(f"Source frame ~{source}/{len(sequence['frames'])} | {progress:.0%} | {fps:g} FPS target")

    if arguments.save_gif:
        output = arguments.save_gif.resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        animation = FuncAnimation(
            figure, lambda index: draw(index, arguments.fps, True),
            frames=range(arguments.display_frames), cache_frame_data=False,
        )
        animation.save(output, writer=PillowWriter(fps=arguments.fps))
        plt.close(figure)
        print("Saved:", output)
    else:
        artists = [artist for group in groups for lines, dots, _ in group.values() for artist in (lines, dots)]
        play_interactive(figure, artists, statuses, draw, arguments.display_frames, arguments.fps)


if __name__ == "__main__":
    main()
