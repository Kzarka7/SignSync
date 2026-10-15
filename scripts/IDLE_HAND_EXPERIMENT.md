# Idle-hand augmentation: first controlled experiment

Status: readiness audit. Retraining requires reviewed resting-hand donor recordings.

## Current collection workflow

The collector records all idle poses under one `IDLE` label, with no participant,
session or variation selector. New clips do not claim a hand configuration or
posture annotation. Keep participant identity with the submitted archive/folder
and add reviewed annotations before any participant-held-out training.

The current pilot recommendation is 33 three-second clips per participant:
left-only and right-only each have 3 beside-torso, 3 near-waist, and 6 in-front
clips (3 natural palm direction and 3 palm-visible). Both-hands idle has 3 clips
for each of those 3 positions, with natural palm direction. Total for P1-P4: 132.
This supersedes the original 27-clip collection plan below. Learning an `IDLE`
class is a separate training experiment from incidental-hand augmentation; neither
has been trained yet. Idle-only classification does not demonstrate robustness
while the other hand is signing.

The source files now live in the primary repository's `scripts/` directory.
The temporary idle-hand worktree has been removed after transferring its changes.

## The one change

Compare frozen v6 against the same architecture, 238 geometry-v3 features, 40-frame
resampling, original sample splits, training settings and seeds 42/43/44, with
training-only augmentation of the annotated incidental hand. Preserve signing-hand
and body-relative sign location. Preserve all two-hand variants. Do not introduce
cropping, activity weighting, motion channels, lead-in augmentation, or a no-sign
class in this comparison. Preserve first-observed geometry until a separate ablation.

The initial audit checks exact sequence IDs against the current variant manifest.
Potential donor frames must have the incidental hand detected below the shoulder
origin by more than one shoulder width, visible pose wrist/elbow, and hand/pose
wrist agreement within 0.25 shoulder widths. These are conservative screening
criteria, not a validated idle detector. Inspect recordings and temporal stability
before approving any donor. A screening failure does not prove a hand is not idle.

## Required recordings and annotations

1. Record 9 idle variations: left hand only, right hand only, and both hands, each
   beside the torso, near the waist, and relaxed in front. Capture 3 samples per
   variation, 3 seconds each: 27 per participant, 108 across P1-P4. Use a head-to-hip
   frame with the recorded hand(s), shoulders and elbows visible; the other hand
   stays comfortably outside the frame for one-hand clips. Keep palms naturally
   oriented. Save landmark exports and consented video for review. This original
   protocol is retained as background; use the current workflow above for collection.
2. Review each donor's hand role and quality. Identify its sequence ID, hand side,
   usable frame interval, tracking gaps, and whether the other hand is also idle.
   Do not use a stationary signing hand as a resting-hand donor.
3. Add exact-ID hand-variant annotations for P4 and any replaced samples that lack
   them. Existing annotations remain provisional; no completed FSL verification
   is established. Do not guess hand role from which hand moves less.
4. Keep donor acquisition separate from sign challenge collection. New donors
   may enter a training fold only when they belong to that fold's training
   participants. Validation and test IDs must never enter the donor pool.

## Challenge conditions

Use matched recordings within a session, 3 repetitions per applicable condition:
ordinary control; both hands idle for 0.5/1/2 seconds before signing; verified
one-hand signing with the other hand resting visibly; idle after signing;
two-hand signing with a meaningful stationary hand; idle-only clips.

Label sequence ID, sign, participant, session, signing/idle side, rest position,
idle duration, visual correctness, permitted variant, tracking gaps and FPS.
Pilot 3 reviewed one-hand signs, 2 two-hand signs involving a stationary hand,
and 1 sign with both hands moving. Expand to all 20 signs before candidate selection.
P1-P4 are development participants. Keep P5 untouched for independent testing.

## Experiment controls and evaluation

Prespecify augmentation probability, donor selection, pose consistency checks,
and training-only normalization before examining candidate test results. Recompute
all derived geometry from augmented source landmarks. Log recipient and donor IDs
and frame intervals; never modify baseline exports or tensors. Preserve original
training sample count/optimization budget where possible, or match it with an
unaugmented retrained control if augmentation expands the dataset.

Evaluate all 4 held-out participant folds and all 3 seeds. Report clean accuracy,
macro F1, per-sign recall and paired regressions, and condition-specific challenge
results with sample counts. Save probabilities and exact sequence IDs. Choose any
confidence threshold on validation data, and report coverage alongside accepted
accuracy. Report FPS/tracking subgroups and runtime. Idle-only clips diagnose false
acceptance; ordinary softmax classification does not establish a no-sign capability.

Proposed gate: challenge improvement across participants, standard mean accuracy
loss no greater than 1 percentage point, and review of every substantial per-sign
regression, particularly meaningful stationary-hand variants. A synthetic stress
test alone cannot establish natural-resting-hand robustness. Integrate a selected
candidate through pipeline → NF for live testing after independent evaluation.
