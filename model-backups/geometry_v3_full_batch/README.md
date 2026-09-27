# Full geometry-v3 batch backup (before the no-start experiment)

This archive contains all nine full geometry-v3 checkpoints: three participant holdouts, each with training seeds 42, 43 and 44. It is the 238-channel model family including repeated first-observed handshape/orientation features. No no-start models are included.

The original full-v3 checkpoints remained intact after the no-start experiment; this archive copies those original checkpoints. It does not retrain or attempt to reverse an ablation model.

## Saved runs

| Training participants | Held-out participant | Seeds |
|---|---|---|
| P1 + P2 | P3 | 42, 43, 44 |
| P1 + P3 | P2 | 42, 43, 44 |
| P2 + P3 | P1 | 42, 43, 44 |

A run name without a seed suffix uses seed 42. Each directory under `models/` contains the exact saved `best_model.keras`, both original plots, and `evaluation_summary.json`. The summary preserves aggregate and per-class results without embedding local source paths or individual sample IDs.

The three directories under `preprocessing/` contain matching training-fitted normalization arrays, labels, and ordered feature definitions. Seeds within the same holdout share these inputs. `batch_manifest.json` links every checkpoint to its preprocessing directory and records its metrics and original model SHA-256.

`source/` contains the relevant feature-generation and training source snapshot from the previously archived full-v3 checkpoint. It is a reference snapshot, not a standalone live predictor or a historical Git checkout. The source can contain registration for other experiments; all archived tensors and checkpoints here are full-v3 with 238 channels. `environment.json` records the package versions. `checksums.json` covers every other archive file.

## Restore

1. Download this entire directory, not just one Keras file.
2. Select a run in `batch_manifest.json` and use its referenced preprocessing directory.
3. Reproduce the collector's 164 normalized channels, append the 26 handshape-v2 channels and the 48 geometry-v3 channels using the archived feature code and recorded ordering. Preserve missing-observation masks, resampling, and the first-observed configuration convention.
4. Standardize using that holdout's `normalization.npz`: `(features - feature_mean) / feature_std`. Do not fit new statistics for prediction.
5. Load `best_model.keras` with `tf.keras.models.load_model(path, compile=False)` and pass float32 arrays shaped `(batch, 40, 238)`. Use the matching `labels.json` for the 20 output probabilities.

This is a model-artifact backup, not a complete dataset backup. Raw recordings, train/test sample tensors, and manifests remain in the separately retained SignSync Dataset directory. Reproducing training from scratch requires that dataset. The reported results are development comparisons; they do not replace evaluation on a fresh participant.

All nine archived checkpoints were verified against the local held-out tensors before upload. See `verification.json` for the reproduced accuracy and macro F1. Keep this archive immutable and create a separate archive for future model batches.
