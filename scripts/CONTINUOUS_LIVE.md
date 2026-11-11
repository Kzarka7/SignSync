# Continuous Live Conversation

Live Conversation now uses continuous gesture segmentation and confirmation.
Start the camera, keep shoulders visible, then start recognition (optionally with
a countdown). Confirmed signs enter the conversation automatically. Stop, camera
failure, navigation, and session completion cancel pending recognition work.
Speech and quick phrases continue using the normal conversation timeline.

Signs mode uses 43 Similar Signs. Fingerspelling uses Alphabet A–Z and sends the draft
after 1.2 seconds of observed hands-free tracking. Both modes use the saved recognition
settings and verify the backend checkpoint identity before starting a run.

43 Similar Signs uses its model and scaler packages under `models/current` and
`processed/current`. The v5 and P4 artifacts are available under the corresponding
`baseline` folders. Alphabet A–Z reads its checkpoint and scalers from the existing
alphabet candidate package. These files are under `SIGNSYNC_DATASET_ROOT` or the sibling
`SignSync Dataset` folder.

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
