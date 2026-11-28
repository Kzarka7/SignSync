# Compare Landmarks 74 Signs

**What was asked**
Update `scripts/compare_landmarks.py` so it supports all 74 signs.

**What changed**
- `scripts/compare_landmarks.py`, `--batches` mode:
  - `batch_folders()` now scans `SignSync Dataset/raw/processed-samples/<category>/<SIGN>/*.zip` instead of reading the 32-sign `samples_75_signs_batch_expansion_v1/intake.json`.
  - New `intake_labels()`: P1–P4 participant inference (`batch_participant()`) is used only for the 32 intake signs.
  - Other signs are labelled by source: Live capture, WEBM, MOV, WIN MP4, Named MP4. A mixed archive shows the selected take's source with "(mixed batch)".
  - `take_source()` returns "Live capture" for takes with no `videoImport`.
  - An unknown `--label` now lists the available signs.
  - Updated the docstring, examples and `--batches` help text.
- Checked: `batch_panels()` loads all 75 labels (the 43 similarity signs plus the 32 intake signs, which include PARENTS), with no failures.
- Checked: `--batches --label THANK_YOU --samples 3 --save-gif` rendered six panels (four live captures, MOV, Named MP4).
- Ran `graphify update .`.

**Decisions and caveats**
- No participant names are inferred for the 43 similarity signs. Their batch-to-person mapping is not confirmed.
- Batch mode does not swap hand slots when `handAssignment.swapped` is set, so it behaves as it did before.
- Some signs, such as HELLO, NO, YES, THANK_YOU and WELCOME, have six archives, so they show six panels.

**Not done / open**
- The interactive viewer window was not opened. Only the GIF export path was exercised.

Related: [[Project Home]], [[2026-11-17 Landmark Viewer Playback]]
