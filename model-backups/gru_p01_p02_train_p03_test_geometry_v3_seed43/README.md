# SignSync geometry-v3 model backup

Selected development checkpoint: `gru_p01_p02_train_p03_test_geometry_v3_seed43`.

- Training participants: P1 and P2; held-out development participant: P3.
- Training seed: 43; 400 test sequences, 20 classes.
- Test accuracy: 89.25%; macro F1: 0.875428; loss: 0.485716.
- Model input: `(batch, 40, 238)`, float32 standardized feature sequences.

This was the highest-accuracy individual run among the compared experiments. Its score is specific to this participant split; it is not a final estimate for new signers. It is full geometry v3, including repeated first-observed handshape/orientation features, not the no-start ablation.

## Contents

- `best_model.keras`: saved Keras checkpoint.
- `normalization.npz`: training-fitted `feature_mean` and `feature_std` only.
- `preprocessing.json`: ordered features, sequence length, feature definitions and resampling information.
- `labels.json`: label-to-index mapping.
- `evaluation_summary.json`: aggregate evaluation and per-class metrics, without sample IDs or local source paths.
- `environment.json`: installed package versions captured during backup.
- `source/`: a snapshot of relevant preprocessing/training code and collector normalization, captured during backup. The source scripts assume the original project/dataset directory layout and are references, not a standalone deployed predictor.
- `checksums.json`: SHA-256 integrity hashes for every other file in this backup.

## Restore and inference

Install compatible packages listed in `environment.json`, then load the checkpoint with `tf.keras.models.load_model(path, compile=False)`.

Reproduce the collector's 164 normalized landmark channels, the 26 handshape-v2 channels and the 48 geometry-v3 channels, in the recorded order. Preserve the saved resampling and missing-observation rules. Use the saved training mean and standard deviation: `(features - feature_mean) / feature_std`. Pass 40-frame sequences with 238 channels to the model, then map its 20 output probabilities using `labels.json`.

The model is for captured sequences. Its first-observed features depend on the capture-window definition; this archive does not implement continuous live segmentation.

Raw recordings, training/test tensors and sample-level manifests are intentionally not part of this model backup. Recreating training requires the separately retained dataset. Keep this directory immutable and create a new backup for a different checkpoint.
