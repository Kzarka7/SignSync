# 2026-11-19 Recognition Lab Live Accuracy Plan

Diagnose missed signs, wrong labels, extra signs, and late or duplicate confirmations in **32 Signs (standalone v3)**. The user reports errors even when the gestures differ clearly in handshape, movement, or placement. Use the existing v2 and v3 seed-42 runs and a fresh annotated recording to separate classifier failures from camera, windowing, and confirmation failures. This work note records a source audit and offline tests. A fresh v3 Camera export from the reported session was unavailable in the inspected workspace and Downloads.

## Findings

| Finding | Evidence | Implication |
| --- | --- | --- |
| The v3 checkpoint layout and runtime path disagree in this workspace. | The backend constructs models/candidates/samples_32_signs_standalone_v3/samples_32_signs_standalone_v3/. The checkpoint and evaluation files are one level higher. The nested directory is missing. The checkpoint and preparation metadata hashes still match checkpoint_verification.json. The Dataset README also points to the old nested location. | A backend attached to this dataset root would fail to load that route. Verify the backend run ID for the user's trial, which may have used a different directory, build or model. This finding alone cannot account for emitted wrong labels. |
| The closing portion of a clip matters. | An offline replay of 194 current v3 test clips at a 0.75 score floor reproduced the saved scores within 0.000001. Full clips gave 191 correct accepts and zero wrong accepts. Removing the final quarter gave 179 correct accepts and nine wrong accepts. Removing the first quarter or keeping every other observation gave 191 and zero. | Inspect whether live windows reach the distinguishing end of a sign before adjusting confidence or retraining. These perturbations isolate changes to stored landmarks and do not reproduce real hand loss or camera scheduling. |
| Stored signs have more context than many camera windows. | 164/194 stored clips span more than 1,333 ms, with a median span of 1,720 ms. Camera uses a 1,333 ms lookback and resamples eligible windows to 40 points at 30 Hz. Short segments retain their native timing. Full stored spans can contain approach or withdrawal. | Compare the actual movement boundaries with the raw window and the tensor sent to the model. The stored duration alone does not establish that the sign itself takes longer than the window. |
| V3 is more likely to admit visible-hand non-sign footage. | At the common 0.78 floor, saved predictions accepted 0/51 background clips for v2 and 12/51 for v3. At 0.90 the counts were 0/51 and 8/51. The calibrated v3 diagnostic handler accepted 14/51 at 0.71. At 0.90 v3 also accepted 207/573 older-vocabulary probes, compared with 159/573 for v2. | No-hand IDLE covers absent hands. Hand-visible rest, incidental movements, and signs outside the 32-label vocabulary still need explicit rejection. These are clip-level counts before multi-window transcript confirmation. |
| Isolated-clip accuracy gives an incomplete picture of camera accuracy. | V3 ranked 192/194 correct on isolated test clips. All 66 recorded test batch IDs also appear in training. Signer ID is blank on 1,250/1,299 samples. Earlier v1 tests holding out a whole archive scored 31.88% and 36.09%, with different data and recipe. | Run an independent continuous test and report signer independence only when identities and grouping support it. The earlier holdouts quantify distribution shift for v1. |

[Backend registry and artifact loader](Backend/app/recognition.py) · [V3 evaluation](../SignSync%20Dataset/models/candidates/samples_32_signs_standalone_v3/diagnostic_evaluation.json) · [Previous 32-sign work](../SignSync%20Dataset/documentation/2026-11-15%20New%2032%20Signs%20Recognition%20Lab%20Retraining.md)

## Possible causes and how to separate them

| Stage | Possible failures | What to inspect |
| --- | --- | --- |
| Deployment and vocabulary | Wrong endpoint, old backend or artifact layout, an unavailable v3 route, or the 43-sign default selected. A requested gesture might be outside v3's label map. | Export the selected run and recognizer ID. Verify the ready payload, schema, checkpoint, scaler, threshold, and labels together. Confirm the intended label exists before scoring a take. |
| Optics and framing | Motion blur, low light, small fingers after resize, fingers touching or occluding each other, hands out of frame, and cropped shoulders. | Inspect the original frames around each distinguishing movement and compare with both hand and pose observations. Compare Original with 640 px at a fixed camera angle and script. |
| Hand detection and assignment | The active hand drops briefly, one hand disappears during two-hand contact, left/right slots swap, an unrelated hand is detected, or a mirrored source differs from collection conventions. | Compare raw landmarks, presence flags, handedness and anatomical side over time. Check display-only overlay holds separately from the real landmarks sent to recognition. Verify the preset in the user's actual run. |
| Pose and placement | Stale or jittery shoulders alter the normalization origin and scale. Pose-wrist and hand-wrist positions disagree. Shoulder visibility, body rotation, viewpoint, aspect ratio and distance differ between devices and batches. | Measure pose refresh age, shoulder width variance and wrist disagreement on the same annotated takes. The live hook normally refreshes pose every fourth processed frame in paired mode. Measure a denser-pose variant with the same hand frames. |
| Camera timing and transport | Presented FPS hides skipped or unevenly spaced landmark observations. CPU/GPU contention, a slow delegate, browser throttling, or late WebSocket responses replace windows and break confirmation. | Record fresh hand updates per second, p95 hand update gap, gap location relative to the sign, inference and round-trip p95, replaced windows, and stale results. Lab Video decodes at 20 Hz and waits for each window. It controls input identity, while Camera exposes live timing. |
| Segmentation | A short or low-travel gesture never starts. A static handshape, finger-only change, onset, closing hold, withdrawal, or distinction late in the sign falls outside the window. Consecutive signs can merge, and a pause or occlusion can split one gesture. | Overlay manual start, end, and distinguishing interval on the first and final submitted windows. Count missing windows and inspect discard reasons such as gesture_too_short, camera_frame_gap, or unverified_hand_loss. Inspect repeats and transitions with hands still visible. |
| Resampling and preprocessing | The live fixed grid and full-clip training paths preserve different time spans. Gaps over 200 ms invalidate interpolation, and a hand absent at either end of an interpolated step is cleared. A change to wrist timing or scale can flatten or exaggerate velocity. | Rebuild exact request frames, compare real versus interpolated hand evidence, and score with unchanged weights. Compare source cadence and measured burst dropouts. Uniformly dropping half the saved observations preserved this offline score, leaving burst loss and missing landmarks open. |
| Model feature representation | Palm-relative joints emphasize shape. Position remains in body context, pose wrists and derived placement features, while the hand block centers the wrist. Placement, cross-hand contact, palm orientation, depth, tempo, repetition, or facial and head cues may be weakly represented or absent. | Inspect the 238 features on paired signs, especially at the discriminating frame. Test explicit hand-to-face or hand-to-body placement and cross-hand geometry only for pairs that fail with intact input. Non-manual cues beyond sparse upper-body landmarks require separate capture and review. |
| Sample labels and training distribution | Incorrectly signed, cut-off, mislabeled or variant clips, unbalanced signer/session/device coverage, and an association between labels and recording batches. Two-hand coverage can pass even when the sign is wrong. Shift and speed augmentation could distort the very contrast a pair needs. | Review confusion pairs against original videos with a fluent Deaf FSL reviewer. Track label, variant, dominant hand, source signer/session, placement and distinguishing movement. Check what augmentation does to each reviewed pair. |
| Confidence, non-sign rejection and transcript | V3 chooses among 32 classes for tracked hands and has a zero backend top-two margin. The browser adds a configurable floor and temporal agreement. It can confirm a consistent wrong prediction or miss a correct label that arrives once, too late, or below the floor. Segmentation and re-arm rules can suppress repeats. Caption rules can also change displayed wording after the gloss is recognized. | Compare backend top three and margins, browser decisions, confirmed glosses, and captions separately. Measure visible-hand negatives, inter-sign movement and older signs. Retain valid pose plus absent hands as the explicit IDLE test. |

[Camera hook](Frontend/src/hooks/useCameraFeed.ts) · [Landmark normalization](Frontend/src/services/landmarks/normalize.ts) · [Segmentation](Frontend/src/services/landmarks/gestureSegmentation.ts) · [Window resampling](Frontend/src/services/landmarks/windowResampling.ts) · [Shape and motion features](scripts/shape_motion_sequence.py) · [MediaPipe hand detection and tracking options](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)

## Ordered investigation

### 1. Establish the running model

Resolve the local artifact path mismatch in a deployment fix, then check a Ready response for samples_32_signs_standalone_v3 and the versioned recognizer ID. Check that the dataset README resolves to the actual files. Verify one expected label and one valid no-hands request through the running backend. Record model, branch/commit, endpoint, camera, input width, delegate, pose mode, confidence, and confirmation time from the test run.

### 2. Capture a reproducible failure set

Use one 60–90 second recorded session plus its Recognition Lab **Export recognition results** JSON. Keep pose visible and include 2–3 takes each of the user's worst pairs, a few familiar controls, and a repeated sign. Use BAD/GOOD, GRANDMOTHER/GRANDFATHER, PERSON/STUDENT, or MAYBE/AGAIN if they reproduce the issue. Include hands out of view, visible rest, incidental hand movements, and transitions with hands staying visible. Mark the intended label, start, end, and the moment that visually distinguishes each take. Add a separate signer or session for generalization once the first failure is reproducible.

For each take, use the same timestamps and checkpoint in three comparisons.

1. Score the manually bounded full gesture using the normalized frames from the export.
2. Score the Lab's actual windows from that same take. Track the first correct above-floor result, wrong above-floor windows, and whether any window contains the distinguishing movement.
3. Match requests and windows to confirmation events and the final gloss transcript. Compare Video replay on the same source and Camera behavior to locate drops or backend timing effects.

Use the exported source frames, window timestamps, request IDs, frame counts and outcomes to reconstruct inputs. The export strips frames from individual window rows. If a replay differs, add a diagnostic-only trace of the exact submitted timestamps, hand-presence flags and valid counts for the selected requests.

| Result | Next change to test |
| --- | --- |
| Handshape or placement is already wrong in the saved landmarks. | Fix hand assignment, pose cadence, input scale or tracking first. |
| Landmarks look valid but the complete segment remains wrong. | Review labels and signer coverage, then test the feature channels and a targeted training change. |
| Complete segment is correct and production windows are wrong or absent. | Change boundaries, lookback, window coverage, or completion timing. Keep weights fixed during that comparison. |
| Production windows are correct and the transcript is wrong, late or blank. | Fix confidence, agreement, stale-result handling, or repeat suppression. Keep frames and weights fixed. |
| Visible-hand background is frequently accepted. | Compare a dedicated sign/non-sign gate trained on reviewed negatives with the v2 background-aware comparator on the same inputs. Keep the absent-hand rule for IDLE. |

### 3. Apply the smallest measured fix

Run v2 and v3 offline against the same annotated inputs at both a common score floor and their production settings. Use the observed error mix to choose one change at a time. Prioritize capturing the distinguishing end of the gesture if the window test reproduces the offline tail sensitivity. If background insertions dominate, train or calibrate a separate sign/non-sign gate using hands-visible negatives, transition fragments and out-of-vocabulary signs. If valid full gestures remain wrong, fix the reviewed data and group splits before changing architecture. Match training augmentation to measured gaps and actual camera windows only after the input difference is confirmed.

### 4. Verify on independent continuous footage

Count one match per intended gesture. Report per-sign recall and precision, substitutions, misses, extra and duplicate glosses, false signs per minute in each negative condition, and median and p95 latency from the annotated end to confirmation. Track hand coverage and window coverage alongside accuracy. Compare the proposed fix with the baseline on the same footage, then repeat on a reserved signer/session. Require fewer errors in the reproduced failure mode with no new hands-absent emissions and review any trade-off between misses, insertions, and latency before rollout. If shared camera or segmentation code changes, replay a known 43-sign control as well.

The first live accuracy diagnosis requires an annotated export from the reported failure or a fresh recording that reproduces it.

## Standalone v3 load failure

The live traceback confirmed that the backend could not find evaluation.json at the nested run path. Resolve standalone runs through the existing model folder finder so it locates the single evaluated run in either the packaged or training layout. Verify both layouts with temporary folders and exercise the diagnostic handler using the current v3 artifacts.

The backend now resolves the packaged v3 run at models/candidates/samples_32_signs_standalone_v3/. All six model-path tests passed. The diagnostic handler loaded the real checkpoint and matching preparation in-process, returned Ready for standalone v3, recognized a held-out BAD clip, and returned non-emitting IDLE for a valid window with both hand channels cleared. The local network probe failed with a sandbox permission error. The dataset links now point to the packaged report.

## User live test and DEAF/UNDERSTAND archive check

The user reported approximately 80% for BAD and occasional DEAF → UNDERSTAND substitutions. They reported FATHER, MOTHER, GRANDFATHER, GRANDMOTHER, SAD, SCHOOL, and WRONG as OK. These are observations from the user's live trial with no attempt counts available. The remaining labels have no individual outcomes in this report.

### Offline checks

On the frozen v3 test split, BAD was 7/8 correct by top-1 prediction, including one BAD → WEEK output at 0.458. All eight other labels named in the live report were 6/6. The older isolated result therefore gave DEAF a perfect score across six clips from represented batches.

Scored the complete DEAF and UNDERSTAND exports from the unused P1 and P4 archives with the v3 checkpoint and matching shape-motion features and scaler. Checked sequence IDs, timestamped landmark content hashes, and available recording fingerprints against the frozen v3 sample inventory. None of those four archives matched the inventory. Participant labels follow the recorded archive mapping. Reported accuracy uses the stored labels, which still need independent FSL review. Acceptance below refers to the offline score floor of 0.75, before live segmentation or confirmation.

| Label and archive | Correct top-1 on complete clips | Main substitutions |
| --- | ---: | --- |
| DEAF, P1 WEBM, Nov 13 01:25:50 | 6/20 | All 14 wrong clips ranked UNDERSTAND first. Twelve cleared the score floor, some above 0.99. |
| DEAF, P4 MOV, Nov 12 19:53:48 | 15/21 | Four ranked FAST first and two ranked UNDERSTAND first. All six wrong scores were below 0.75. |
| UNDERSTAND, P1 WEBM, Nov 13 01:38:53 | 20/20 | All 20 cleared the score floor. |
| UNDERSTAND, P4 MOV, Nov 12 21:05:59 | 0/20 | Ten ranked DEAF first, eight FAST, and two DONT_UNDERSTAND. Nine wrong scores cleared the floor. |

The P1 DEAF confusion reproduced with the entire exported interval. Keeping only the last 1,300 ms increased DEAF → UNDERSTAND from 14 to 18 of 20, with 16 above the score floor. In P4 DEAF, trimming the final quarter increased DEAF → UNDERSTAND from two to ten of 21, with nine above the floor. These simulated crops preserve stored observations and do not simulate live detector gaps, interpolation, or confirmation. The two DEAF archives and two UNDERSTAND archives were marked complete in the Collector. The P1 DEAF source filenames carry DEAF prefixes. Metadata alone cannot separate valid variants, incorrect performance, tracking errors in the original extraction, and the model learning a batch-specific representation.

This evidence puts held-out archive generalization and label/landmark agreement ahead of further live threshold tuning for this pair. Window timing can worsen the same substitution. The background false-accept regression remains a separate explanation for inserted glosses. The live observations give useful reference signs, with seven reported OK and two partially reliable. They do not establish whether any particular unlisted sign was attempted.

[Participant mapping](../SignSync%20Dataset/documentation/2026-11-17%20Participant%20mapping%20for%20the%2032%20signs.md) · [V3 test artifacts](../SignSync%20Dataset/models/candidates/samples_32_signs_standalone_v3/)
