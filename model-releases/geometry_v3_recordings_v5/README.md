# SignSync geometry-v3 recordings-v5 model batch

This backup contains all nine development GRU checkpoints: three held-out
participants, each trained with seeds 42, 43, and 44. Every run uses 20 signs,
40 frames per sequence, and 238 input channels. The recordings-v5 data replace
STAY and WHEN for all three participants and WAIT for P2 and P3 relative to the
older manifest. These models have **not** been tested on participant 04.

`release.json` identifies every checkpoint, its SHA-256 checksum, test metrics,
label map, input feature order, and source-export checksums. Each split also has
its training-fitted `normalization_test_participant_XX.npz`, containing
`feature_mean` and `feature_std` arrays shaped `(1, 1, 238)`. Use the
normalization file belonging to the checkpoint's held-out participant; the
three files are not interchangeable. `comparison_report.md` compares saved v4
models and retrained v5 models on the same v5 held-out samples.

To reproduce preprocessing and training from the local SignSync Dataset,
see `scripts/run_recordings_v5_experiments.py`. Its dependencies include
`preprocess_dataset.py`, `prepare_handshape_experiments.py`,
`prepare_geometry_experiments.py`, `gesture_geometry.py`, and `train_gru.py`.
The dataset exports and raw recordings are not included in this repository.
The checkpoint files alone are not enough to reconstruct collector features
from video; inference must use the same 164-value collector feature order,
handshape/geometry construction, 40-frame resampling, and saved normalization.

Nine-run paired v4-on-v5 versus v5 mean accuracy: **88.28% → 89.42%**.
STAY improved from 172/180 to 180/180 correct and WHEN from 77/180 to 139/180,
while THANK_YOU, FAMILY, and HELP regressed. These are development results,
not a final unseen-participant evaluation.
