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


def orientation_ablation_folder(root, run):
    return root/'gru_model_train_test_geometry_v3_no_orientation'/run


def wrist_position_ablation_folder(root, run):
    return root/'gru_model_train_test_geometry_v3_no_wrist_position'/run


def finger_joint_model_folder(root, run):
    return root/'gru_model_train_test_geometry_v3_finger_joints'/run


def recordings_v2_model_folder(root, run):
    return root/'gru_model_train_test_geometry_v3_recordings_v2'/run


def recordings_v3_model_folder(root, run):
    return root/'gru_model_train_test_geometry_v3_recordings_v3'/run


def recordings_v4_model_folder(root, run):
    return root/'gru_model_train_test_geometry_v3_recordings_v4'/run


def recordings_v5_model_folder(root, run):
    return root/'gru_model_train_test_geometry_v3_recordings_v5'/run
