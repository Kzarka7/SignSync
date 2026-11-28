# SignSync Project Home

SignSync is a Filipino Sign Language conversation assistant. `Frontend/` contains the React app. `Backend/` contains the FastAPI API and the live translation WebSocket.

## Start here

- [[README|SignSync README]] — local setup, frontend and backend configuration, and remote testing.
- [SignSync Dataset README](obsidian://open?vault=SignSync%20Dataset&file=README) — maps each Recognition Lab option to its prepared data, trained model, and evaluation.
- [Dataset Guide](obsidian://open?vault=SignSync%20Dataset&file=Dataset%20Guide) — how to trace and validate dataset or model changes.

## When working on recognition

1. Identify where the behavior occurs. Check whether it is in the live conversation flow or a specific Recognition Lab option.
2. Trace the frontend request or WebSocket message to the backend handler. Find where the backend selects the model and resolves its files.
3. Match the selected model to the run in the Dataset README. Verify the checkpoint, label order, and any scaler or preprocessing used at inference.
4. If switching models, check that the model and its supporting files belong to the same run. Test the affected app flow and record which model and test input you used.
5. If the app and README point to different runs, record both paths and what you verified.

## Where to record changes

Update the SignSync README when setup or runtime configuration changes. Use this note for open recognition issues, current priorities, and decisions that affect both vaults.

## Work notes

- [[2026-11-19 Recognition Lab Video Queue]] — multi-video replay, per-clip results, and sequential decoding.

- [[2026-11-19 Recognition Lab Live Accuracy Plan]] — model identity, live-window diagnosis, dataset review, and continuous evaluation.

- [2026-11-18 BAD and Grandparent Retraining Preparation](obsidian://open?vault=SignSync%20Dataset&file=documentation%2F2026-11-18%20BAD%20and%20Grandparent%20Retraining%20Preparation) — refreshed samples, standalone v2 retraining, and Recognition Lab rollout.

- [[2026-11-18 Collector Live Landmark FPS]] — shared live camera settings, recording progress, and sample parity.

- [[2026-11-17 Landmark Viewer Playback]] — rendering performance and playback timing in the landmark comparison script.

- [[2026-11-17 Recognition Lab FPS Plan]] — MediaPipe pipeline, camera benchmark, optimization order, and later rollout checks.

- [2026-11-14 Recognition Lab Baseline Audit](obsidian://open?vault=SignSync%20Dataset&file=documentation%2F2026-11-14%20Recognition%20Lab%20Baseline%20Audit)

- [[2026-11-14 FSL Lexicalization and Syntax Plan]] — implementation order and validation for FSL captions, including the [[2026-11-14 FSL Lexicalization and Syntax Plan#V2 experiment · 2026-11-14|v2 experiment and Lab comparison]].

- [[2026-11-14 FSL Lexicalization and Syntax Plan#Sign gloss notation pilot · 2026-11-14|Sign gloss notation pilot]] — model-label mapping, timed annotations and signer review.


- [[2026-11-14 FSL Lexicalization and Syntax Plan#Recognition Lab gloss implementation · 2026-11-14|Recognition Lab gloss implementation]] — manual annotation and versioned exports.

- [[2026-11-15 Possessive Collector Labels]] — Collector prompts and the raw collection folder.

- [2026-11-15 New 32 Signs Recognition Lab Retraining](obsidian://open?vault=SignSync%20Dataset&file=documentation%2F2026-11-15%20New%2032%20Signs%20Recognition%20Lab%20Retraining)

- [[2026-11-15 Sign Language Recognition Research References]] — five published systems compared with SignSync’s recognition, segmentation, and captions.

- [[2026-11-19 Uploaded Video Replay Fix]] — uploaded WebM duration validation and replay.


- [[Graph Index]] — knowledge graph of the code and docs (graphify).
