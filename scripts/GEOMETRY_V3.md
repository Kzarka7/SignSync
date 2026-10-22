# Full geometry-v3 experiment scripts

## STAY and WHEN replacement recordings v5

`run_recordings_v5_experiments.py` verifies the three v5 participant exports,
prepares 238-channel geometry inputs, and trains three held-out-participant
splits with seeds 42, 43, and 44. It compares saved v4 models and retrained v5
models on the same v5 test samples. The replacement signs are STAY and WHEN
for all three participants; other recordings are retained from v4.

```powershell
python .\scripts\run_recordings_v5_experiments.py --prepare-only
python .\scripts\run_recordings_v5_experiments.py
python .\scripts\export_predictions.py --all --feature-set geometry-recordings-v5 --seeds 42 43 44
```

The local report is `SignSync Dataset/models/reports/comparisons/geometry_v3_recordings_v5/report.md`.
The nine-run mean accuracy rose from 88.28% (saved v4 models on v5 test data)
to 89.42% (v5 models). Every v5 run exceeded 80% accuracy and correctly
recognized at least one sample of each sign. These are development results;
participant 04 has not been tested. Trained checkpoints and datasets are kept
outside this source repository.

## WAIT replacement recordings v4 (exploratory)

`run_recordings_v4_experiments.py` uses the three processed v4 participant
exports. P1 is unchanged from v3; P2 and P3 each replace only 20 WAIT recordings.
The 1,160 retained recordings must preserve their source frames and split IDs.
The model remains full geometry v3 with 238 channels and seeds 42/43/44.
Flagged P2 elbow tracking and P3 projected wrist-bend questions remain unresolved;
the user authorized exploratory retraining with this batch on 2026-10-08.

```powershell
python .\scripts\historical\run_recordings_v4_experiments.py --prepare-only
python .\scripts\historical\run_recordings_v4_experiments.py
python .\scripts\export_predictions.py --all --feature-set geometry-recordings-v4 --seeds 42 43 44
```

The runner preserves old artifacts and `samples.csv`, trains missing runs,
and compares saved v3 models against retrained v4 models on identical v4 test
recordings using each model's own training-fitted normalization. Historical
v3 results use different WAIT test recordings for P2/P3 and are context only.
Reconstructed inputs must match all retained test tensors (400 for P1; 380
for P2/P3). Reports are under `models/reports/comparisons/geometry_v3_recordings_v4`;
models are under `models/archive/recordings_v4`.
Prediction reports include old-on-v4 and new-v4 predictions and new-model
seed consistency. The runner does not update the manifest or push to GitHub.
V4 checkpoints use `best_model.h5` because native `.keras` saving stalled in
this Windows environment; the model architecture and training are unchanged.

This source checkpoint supports the full geometry-v3 batch: three participant holdouts, each with seeds 42, 43 and 44. It uses 238 input channels, including repeated first-observed handshape and orientation features. The no-start ablation is not registered in these working scripts.

The associated trained models and processed tensors remain locally under the sibling `SignSync Dataset` directory. They are not part of this source-code commit. Trained artifacts are separate from the scripts that prepare, train and evaluate them.

From the project root with the GRU Python environment active:

```powershell
# Prepare inputs only when the full-v3 processed folders do not already exist.
python .\scripts\prepare_geometry_experiments.py

# Train missing runs, reuse completed runs, and write the nine-run comparison.
python .\scripts\historical\run_geometry_experiments.py

# Export predictions from the saved full-v3 models across all three seeds.
python .\scripts\export_predictions.py --all --feature-set geometry --seeds 42 43 44

# Run the source checks.
python -m unittest discover -s scripts -p "test_*.py"
```

Preparation preserves the existing handshape-v2 channels, splits and labels. It refuses to overwrite prepared experiments. Model lookup supports the grouped local model directories; new full-v3 runs use `models/archive/geometry_v3`. Completed models are preserved. Comparison reports are written to `models/reports/comparisons/geometry_v3`.

Source scripts belong in Git. Model checkpoints, NumPy tensors, virtual environments, secrets and local backup folders are excluded by `.gitignore`. Ignoring a file does not remove older committed copies from Git history.

## Separate orientation-removal experiment

`run_orientation_ablation.py` derives 222-channel inputs from the existing full-v3 tensors. It removes the 16 explicit per-frame/first-observed palm-normal channels and their validity flags. Starting handshape and wrist/position features remain; raw landmarks still contain implicit orientation information. Splits, labels and retained normalization are unchanged. It does not overwrite full-v3 models.

```powershell
python .\scripts\historical\run_orientation_ablation.py --prepare-only
python .\scripts\historical\run_orientation_ablation.py
python .\scripts\export_predictions.py --all --feature-set geometry-no-orientation --seeds 42 43 44
```

Prepared tensors use the `_geometry_v3_no_orientation` experiment suffix. Model outputs are grouped under `models/archive/ablations/no_orientation`. The nine-run comparison is written to `models/reports/comparisons/geometry_v3_no_orientation/report.md` with loss, accuracy, macro F1 and per-sign results. This removal also reduces parameter count, so it tests the feature configuration rather than proving a particular internal decision mechanism.

## Separate wrist/position removal experiment

This comparison removes only eight added channels: wrist alignment cosine, signed wrist-bend sine, thumb-to-shoulder XY distance and wrist validity for each hand. It retains all starting handshape and orientation channels. Raw landmarks still carry implicit wrist/position information. The input width is 230, with identical retained values, normalization, labels and splits.

```powershell
python .\scripts\historical\run_wrist_position_ablation.py --prepare-only
python .\scripts\historical\run_wrist_position_ablation.py
python .\scripts\export_predictions.py --all --feature-set geometry-no-wrist-position --seeds 42 43 44
```

Outputs use the `_geometry_v3_no_wrist_position` suffix and are grouped under `models/archive/ablations/no_wrist_position`. The comparison is in `models/reports/comparisons/geometry_v3_no_wrist_position/report.md`. Full-v3 artifacts remain unchanged. Compare the whole nine-run batch and per-sign regressions before selecting a candidate; a best single seed is insufficient.

## Separate individual finger-joint experiment

Adds 20 channels to full v3 (258 total): four individual MCP cosines and four DIP cosines per hand, with separate validity flags for each group of four. Existing PIP curl and the averaged MCP feature remain. These are projected XY measurements, not calibrated anatomical angles; thumb geometry is unchanged. Features are computed on original frames before masked resampling and standardized using only the training subset. No extra starting-handshape copies are added. All original 238 values, sample IDs and splits are preserved.

```powershell
python .\scripts\historical\run_finger_joint_experiments.py --prepare-only
python .\scripts\historical\run_finger_joint_experiments.py
python .\scripts\export_predictions.py --all --feature-set geometry-finger-joints --seeds 42 43 44
```

Models are grouped under `models/archive/ablations/finger_joints`; comparison reports are under `models/reports/comparisons/geometry_v3_finger_joints`. The runner resumes completed evaluations and refuses mismatching artifacts. It hashes the nine reference checkpoints before and after training. More input channels increase parameter count; judge all nine runs and per-sign regressions, including SORRY versus PLEASE. Repeated use of these participants is development evaluation, not an untouched final test.

## Replacement recordings experiment

Uses the three `processed/archive/recordings_v2/datasets/participant_XX-dataset-v2.json` exports: 15 retained signs plus replacement recordings for THANK_YOU, SORRY, PLEASE, WAIT and WAVE_GREETING. Full geometry v3 remains 238 channels. The runner verifies that the retained 900 recordings keep their original splits, and prepares 640 training, 160 validation and 400 test samples for each participant holdout. Training-only normalization is refitted for the new training data. The manifest is not used or modified; this remains preliminary until recording review is complete.

```powershell
python .\scripts\historical\run_recordings_v2_experiments.py --prepare-only
python .\scripts\historical\run_recordings_v2_experiments.py
python .\scripts\export_predictions.py --all --feature-set geometry-recordings-v2 --seeds 42 43 44
```

The runner trains nine models and compares the old and retrained models on identical v2 test recordings. Each old model uses its original saved normalization. Reconstructed inputs must match saved tensors for the 300 retained test recordings per participant. Historical results on the old test recordings are context only, not the main comparison.

Outputs are grouped under `models/archive/recordings_v2`; the paired report is `models/reports/comparisons/geometry_v3_recordings_v2/report.md`. Prediction reports contain nine retrained-model CSVs, nine `old_on_v2__` CSVs and a consistency CSV for the retrained models. Completed runs can be resumed; mismatching artifacts are rejected. An interrupted incomplete model folder must be inspected before restarting because training refuses to overwrite it. Nothing is pushed to GitHub by this runner.

## FRIEND and WHERE replacement experiment

The three `processed/archive/recordings_v3/datasets/participant_XX-dataset-v3.json` exports replace 20 FRIEND and 20 WHERE recordings for P1 and P2. P3 is unchanged. Full geometry v3 retains the same 238 channels and training settings. The 1,120 retained recordings must keep their prior split assignments. The manifest remains on v2 until visual review of the new recordings is finished.

```powershell
python .\scripts\historical\run_recordings_v3_experiments.py --prepare-only
python .\scripts\historical\run_recordings_v3_experiments.py
python .\scripts\export_predictions.py --all --feature-set geometry-recordings-v3 --seeds 42 43 44
```

The runner saves nine new models under `models/archive/recordings_v3` and compares them with the nine saved v2 models on identical v3 test recordings. Each model uses its own training-fitted normalization. The paired report and per-sign results are under `models/reports/comparisons/geometry_v3_recordings_v3`; the prediction folder includes nine v3 reports, nine `old_on_v3__` reports, and a v3 consistency CSV. Existing v2 sources, model artifacts, and `samples.csv` are hash-checked and preserved.
