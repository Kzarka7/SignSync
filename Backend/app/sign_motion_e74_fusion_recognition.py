"""Recognition Lab: 74-sign v2 + Motion E fusion (no new training).

The 74-sign v2 model decides how much of the probability belongs to the 43 Similar Signs versus the 31 standalone
signs and the background classes. Inside the 43 signs, Motion E (the 43-sign recipe-E model, which reads live
MONDAY reliably) decides which sign it is:

    p(c) = p_v2(c)                                  for the 31 standalone signs, REST and IDLE_MOVEMENT
    p(c) = [sum of p_v2 over the 43 signs] * p_E(c) for the 43 Similar Signs

Both models read the same sign-motion-cues-v1 features, each with its own saved scalers. The output has the
same 76 labels as v2, so PARENTS composition and the Lab rules are unchanged. The acceptance threshold is v2's
saved one (0.61); the fused scores were not separately calibrated.

Measured on 445 labelled live Lab segments (2026-11-25 sessions + the 2026-11-26 MONDAY session, evaluation only):
v2 74.8% -> fusion 75.3%; MONDAY 12/23 -> 17/23, STAY 5/10 -> 7/10, GOOD_AFTERNOON 4/9 -> 6/9. TUESDAY (read as
FAST) and THANK_YOU (read as MAYBE/GOOD) are unchanged, because v2 already sends them outside the 43 signs.
"""
from pathlib import Path

import numpy as np

from app.sign_motion_e_recognition import SignMotionERecognizer
from app.sign_motion_e74_recognition import LABELS, SignMotionE74V2Recognizer


class SignMotionE74FusionRecognizer(SignMotionE74V2Recognizer):
    model_id = 'lab-signs74-motion-e-v2-fusion-seed42-graph-diagnostics'
    display_name = '74-sign v2 + Motion E fusion'

    def __init__(self, dataset_root: Path):
        super().__init__(dataset_root)          # v2: checksums, feature code, labels, scalers, threshold
        motion_e = SignMotionERecognizer(dataset_root)   # Motion E: same checks on its own checkpoint
        self.attach_motion_e(motion_e)

    def attach_motion_e(self, motion_e) -> None:
        """Wire Motion E in beside v2. predict() standardizes with v2's scalers, so the fused infer undoes that and
        applies Motion E's own scalers before asking Motion E."""
        index_43 = np.array([LABELS.index(label) for label in motion_e.labels])
        v2_infer, v2_mean, v2_std = self.infer, self.mean, self.std
        e_infer, e_mean, e_std = motion_e.infer, motion_e.mean, motion_e.std

        def fused(standardized):
            standardized = np.asarray(standardized, dtype=np.float32)
            p74 = np.asarray(v2_infer(standardized), dtype=np.float64)
            raw = standardized.astype(np.float64) * v2_std + v2_mean
            p43 = np.asarray(e_infer(((raw - e_mean) / e_std).astype(np.float32)), dtype=np.float64)
            out = p74.copy()
            out[:, index_43] = p74[:, index_43].sum(axis=1, keepdims=True) * p43
            return (out / out.sum(axis=1, keepdims=True)).astype(np.float32)

        self.infer = fused
        self.motion_e_index = index_43
        self.members = self.members + motion_e.members
