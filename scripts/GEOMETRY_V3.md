# Full geometry-v3 experiment scripts

This source checkpoint supports the full geometry-v3 batch: three participant holdouts, each with seeds 42, 43 and 44. It uses 238 input channels, including repeated first-observed handshape and orientation features. The no-start ablation is not registered in these working scripts.

The associated trained models and processed tensors remain locally under the sibling `SignSync Dataset` directory. They are not part of this source-code commit. Trained artifacts are separate from the scripts that prepare, train and evaluate them.

From the project root with the GRU Python environment active:

```powershell
# Prepare inputs only when the full-v3 processed folders do not already exist.
python .\scripts\prepare_geometry_experiments.py

# Train missing runs, reuse completed runs, and write the nine-run comparison.
python .\scripts\run_geometry_experiments.py

# Export predictions from the saved full-v3 models across all three seeds.
python .\scripts\export_predictions.py --all --feature-set geometry --seeds 42 43 44

# Run the source checks.
python -m unittest discover -s scripts -p "test_*.py"
```

Preparation preserves the existing handshape-v2 channels, splits and labels. It refuses to overwrite prepared experiments. Model lookup supports the grouped local model directories; new full-v3 runs use `models/gru_model_train_test_geometry_v3`. Completed models are preserved. Comparison reports are written to `models/geometry_v3_comparison`.

Source scripts belong in Git. Model checkpoints, NumPy tensors, virtual environments, secrets and local backup folders are excluded by `.gitignore`. Ignoring a file does not remove older committed copies from Git history.
