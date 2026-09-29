"""Locate saved runs in flat or user-organized model folders."""
def find_model_folder(root, run):
    candidates = [p for p in root.rglob(run) if p.is_dir() and (p/'evaluation.json').is_file()]
    if len(candidates) != 1:
        raise ValueError(f'Expected one saved model for {run}, found {len(candidates)} under {root}')
    return candidates[0]


def geometry_model_folder(root, run):
    """Reuse a saved full-v3 run, or choose its grouped output location."""
    if any(p.is_dir() and (p/'evaluation.json').is_file() for p in root.rglob(run)):
        return find_model_folder(root, run)
    return root/'gru_model_train_test_geometry_v3'/run
