"""Locate saved runs in flat or user-organized model folders."""
def find_model_folder(root, run):
    candidates = [p for p in root.rglob(run) if p.is_dir() and (p/'evaluation.json').is_file()]
    if len(candidates) != 1:
        raise ValueError(f'Expected one saved model for {run}, found {len(candidates)} under {root}')
    return candidates[0]


def no_start_folder(root, run):
    return root/'gru_model_train_test_geometry_v3_no_start'/run
