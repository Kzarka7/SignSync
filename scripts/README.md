# SignSync scripts

Run commands from the SignSync project root with the GRU Python environment
active. The files at the top of this folder are the current dataset and model
workflow; older comparison runners are in `historical/`, and checks are in
`tests/`. The dataset and trained outputs stay in the sibling `SignSync Dataset`
folder.

| Task | Script |
|---|---|
| Merge reviewed recordings | `merge_dataset.py` |
| View samples and landmarks | `compare_landmarks.py` |
| Prepare and train the current v5 comparison | `run_recordings_v5_experiments.py` |
| Export per-sample predictions | `export_predictions.py` |
| Inspect saved model inputs | `inspect_model_inputs.py` |
| Build inputs directly | `preprocess_dataset.py`, `prepare_handshape_experiments.py`, `prepare_geometry_experiments.py` |
| Train one prepared experiment | `train_gru.py` |

`historical/` retains earlier recording comparisons and feature ablations for
reproducing research results. See [GEOMETRY_V3.md](GEOMETRY_V3.md) for their
commands and the current v5 comparison. One-time manifest scripts remain at the
top level because they have not been replaced by a general v5 manifest command;
do not rerun them against the current manifest without checking their target
dataset versions.

Run the checks with:

```powershell
python -m unittest discover -s scripts -p "test_*.py"
```

## Live conversation

See [LIVE_V5.md](LIVE_V5.md) for the v5 camera-to-conversation setup, artifact
requirements, model choice, development limitations, and integration checks.
