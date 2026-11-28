"""Recognition Lab: combined 74 signs on recipe E (43 Similar Signs + 31 standalone v5 signs, REST/IDLE_MOVEMENT).

One recipe-E model (sign-motion-cues-v1 features, bidirectional GRU) with 76 outputs: the 43 Motion E signs,
the 31 standalone v5 signs without PARENTS, and the non-emitting REST and IDLE_MOVEMENT classes. PARENTS is
composed in the Lab from FATHER + MOTHER (COMPOSING_MODELS in the frontend). Every training clip was rebuilt
in the live hand-slot order, so frames are not swapped. Feature code, scalers, labels and checksums are
checked exactly as for Motion E (this class only points the Motion E loader at another checkpoint).

Replaceable candidate: to try a retrained combined model, write it with the same artifact layout
(SignSync Dataset/experiments/samples_74_signs_motion_e_v1/train_final74.py) and change MODEL_GROUP /
MODEL_NAME below. The label list is fixed here on purpose; a checkpoint with other outputs is refused.

Held-out-person estimate (seed 42, epochs by validation accuracy): 89.7% on the 43 signs (Motion E 91.3% on
the same clips), 76.9% on the 31 signs (recipe E alone 78.0%); 9/153 background clips accepted at 0.75.
It misses its promotion gates; it is a Lab candidate only. See
SignSync Dataset/experiments/samples_74_signs_motion_e_v1/REPORT.md.
"""
from app.sign_motion_e_recognition import LABELS as LABELS_43, SignMotionERecognizer

MODEL_GROUP = 'samples_74_signs_motion_e_v1'
MODEL_NAME = 'sign_motion_cues_v1_74_aug_all_clips_seed42'
LABELS_31 = ['AGAIN', 'BAD', 'CORRECT', 'DAY', 'DEAF', 'DONT_UNDERSTAND', 'DRINK', 'EAT', 'FAST', 'FATHER', 'FINE',
             'GOOD', 'GRANDFATHER', 'GRANDMOTHER', 'HAPPY', 'MAYBE', 'MONEY', 'MOTHER', 'PERSON', 'ROOM', 'SAD',
             'SCHOOL', 'SICK', 'SLOW', 'STUDENT', 'TEACHER', 'TIRED', 'UNDERSTAND', 'WATER', 'WEEK', 'WRONG']
BACKGROUND = ['IDLE_MOVEMENT', 'REST']
LABELS = sorted(LABELS_43 + LABELS_31) + BACKGROUND


class SignMotionE74Recognizer(SignMotionERecognizer):
    model_id = 'lab-signs74-motion-e-seed42-graph-diagnostics'
    model_location = ('candidates', MODEL_GROUP, MODEL_NAME)
    expected_labels = LABELS
    display_name = '74-sign combined motion E'


MODEL_GROUP_V2 = 'samples_74_signs_motion_e_v2'
MODEL_NAME_V2 = 'sign_motion_cues_v1_74_livecrop_all_clips_seed42'


class SignMotionE74V2Recognizer(SignMotionE74Recognizer):
    """Same features, network and labels as v1, plus 3 live-crop training views per clip (clips trimmed like the
    Lab segmenter). Held-out people on live-style crops: 88.4% (43 signs) / 80.3% (31 signs) vs v1 81.7% / 73.4%;
    429 recorded live segments: 75.8% vs v1 72.7%. TUESDAY still reads as FAST. Lab candidate kept beside v1.
    See SignSync Dataset/experiments/samples_74_signs_motion_e_v2/REPORT.md."""
    model_id = 'lab-signs74-motion-e-v2-seed42-graph-diagnostics'
    model_location = ('candidates', MODEL_GROUP_V2, MODEL_NAME_V2)
    display_name = '74-sign combined motion E v2 (live-crop)'


MODEL_GROUP_V4 = 'samples_74_signs_motion_e_v4'
MODEL_NAME_V4 = 'sign_motion_cues_v1_74_livecrop_v4_all_clips_seed42'


class SignMotionE74V4Recognizer(SignMotionE74Recognizer):
    """v2 recipe retrained with the refreshed TUESDAY/THURSDAY clips (75 each) and person-level folds for every clip.
    429 recorded live segments: 76.7% vs v2 75.8%, TUESDAY 6/7 vs 0/7. Held-out idle clips accepted as signs at .75:
    9 full / 11 crop of 153 vs v2 7 / 10, so it failed its background gate. Lab-only, kept beside v2.
    See SignSync Dataset/experiments/samples_74_signs_motion_e_v4/REPORT.md."""
    model_id = 'lab-signs74-motion-e-v4-seed42-graph-diagnostics'
    model_location = ('candidates', MODEL_GROUP_V4, MODEL_NAME_V4)
    display_name = '74-sign combined motion E v4 (refreshed TUESDAY/THURSDAY)'
