# 74-sign data audit

**What was asked**
Run a read-only audit of the 74-sign training data, after finding that most TUESDAY clips were signed palm-toward-camera while THURSDAY's same first gesture is sideways. It continues [[2026-11-26 74-sign live-crop v2 model]].

**What changed**
- New folder `SignSync Dataset/experiments/samples_74_signs_motion_e_v2/audit/`:
  - Scripts: `data_audit.py` (checks A–D), `group_review.py`.
  - Outputs: `flagged_clips.csv`, `review_blocks.csv` / `.json`, `audit_summary.json`, `DATA_AUDIT.md`.
- Results:
  - 1,758 of 5,887 sign clips flagged, 611 by two or more checks.
  - Flags group into 85 sign × person/batch blocks, ranked for video review.
- Main patterns:
  - **Batch `capture-date-20261101`:** GOOD_MORNING, GOOD_AFTERNOON and GOOD_EVENING show palm 90–122° off and the other hand in use. TOMORROW looks like YESTERDAY; TODAY looks like MAYBE.
  - **`participant_03`:** the other hand is in use in FAMILY, FRIEND, HELP, STAY, WHERE and WHICH, which look like HOW or WHICH.
  - **MAYBE / WHERE / GOOD / THANK_YOU cluster:** across P1–P3 and participants 01–02.
  - **Batch `capture-date-20261029`:** small hand movement on numbers and THURSDAY, likely a recording difference.
- Check D (same handshape, different palm) confirmed FAST–TUESDAY.

**Decisions and caveats**
- The audit cannot tell which side is right; the owner decides by video (OK / wrong / variant per block).
- No data, models or app code changed. Graph not updated (per request).

**Not done / open**
- Owner reviews `review_blocks.csv`.
- Then: exclude the wrong blocks, record correct TUESDAY (and any others), and retrain with the v2 recipe.
- Segmenter timing for THURSDAY, ROOM and TEN.
