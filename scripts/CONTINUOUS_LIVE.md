# Continuous Live Conversation

Live Conversation now uses continuous gesture segmentation and confirmation.
Start the camera, keep shoulders visible, then start recognition (optionally with
a countdown). Confirmed signs enter the conversation automatically. Stop, camera
failure, navigation, and session completion cancel pending recognition work.
Speech and quick phrases continue using the normal conversation timeline.

The live path uses `useContinuousLiveRecognition`, the shared segmentation/session
services, and the P4 graph predictor. These modules retain diagnostic names because
they are also used by local development tools. The Recognition Lab page, route,
and sidebar entry are not part of this release.

The backend connection uses `model=p4-candidate&diagnostics=1`. It requires the
protocol-1 graph handshake and P4 ensemble identity. The backend loads the existing
nine P4 checkpoints and their saved scalers from
`experiments/sign_rest_idle_p4_signs_v1_2026_10_18` under `SIGNSYNC_DATASET_ROOT`
(or the sibling `SignSync Dataset` directory by default). Model files are not bundled in Git. Missing artifacts produce a
visible error; there is no silent fallback to a different recognition model.

Each gesture segment must independently confirm its prediction. A repeated label
may be accepted in a fresh segment; duplicate suppression applies within a segment.
REST/IDLE, uncertainty, visibility checks, stale-result rejection, and cancellation
remain in the shared recognition policy. This is heuristic segmentation; false
positives and incorrect gesture splits remain possible. Displayed confidence is
a model score, not measured accuracy.

Validation: run the frontend continuous recognition, segmentation, capture,
predictor, translation stream/socket, and panel tests, then `npm run build`.
Backend recognition and diagnostic endpoint tests exercise validation, model
routing, graph identity, parity checks, and visibility rejection with test models.
Actual camera accuracy and deployment checkpoint availability require separate
device/runtime verification.
