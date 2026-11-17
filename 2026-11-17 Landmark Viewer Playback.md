# Landmark Viewer Playback

## Goal

Improve interactive playback in [compare_landmarks.py](scripts/compare_landmarks.py), especially the maximized three-panel `AGAIN` batch comparison. Keep the normalized-time alignment, recorded and interpolated display modes, keyboard controls, and GIF export working.

## Verification plan

Measure the original and updated playback on the same `AGAIN` takes. Check elapsed loop time at 30 and 120 FPS, pause and stepping controls, redraws during resize, a participant comparison, and GIF export.

## Changes

- Cached the static figure and redraw the animated landmarks in one bounded region. Each skeleton group uses a single path for its segments.
- Drove interactive playback from a monotonic clock. Late draws skip display frames so one loop still takes `--display-frames / --fps` seconds.
- Moved the legend below the figure title and the frame counters above the plots. Counters refresh up to five times per second during playback and update immediately on pause, seek, or speed changes.

## Verification

- The same three raw `AGAIN` takes in maximized TkAgg at 1920 × 1007 went from about 2.2 display updates per second at both targets to 28.6 at 30 FPS and 40.2 at 120 FPS. The 120-frame loop took about four seconds at 30 FPS and about one second at 120 FPS.
- Exercised pause and resume, single-frame and ten-frame steps, wraparound, endpoint seeks, speed controls, resize, PNG save at a different DPI, and Escape on TkAgg. Compared the blitted canvas with a full redraw after resize and after saving.
- Exported and verified eight-frame GIFs from the three archived `AGAIN` takes and the mirrored, interpolated v5 `STAY` participant take.
- The interpolated 60 FPS, 240-frame configuration measured 37.2 updates per second and a 3.99-second loop on the same takes.

## Startup defaults

The [short command in the script guide](scripts/README.md#landmark-playback) starts at a 120 FPS playback target with 240 display frames. The source-frame lines show `120 FPS target` when the viewer opens. The default viewer loop takes two seconds. GIF export defaults to 60 FPS.
