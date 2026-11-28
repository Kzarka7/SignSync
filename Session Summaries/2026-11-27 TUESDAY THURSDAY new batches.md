# TUESDAY / THURSDAY new batches

**What was asked**
Process the new TUESDAY and THURSDAY uploads in `SignSync Dataset/raw/processed-samples/DAYS/`. There are two new 20-take batches per sign. Five takes were deleted from each 2026-10-26 batch, which is now `-15x-`.

**What changed**
- Extracted 80 JSONs byte-for-byte into `samples/TUESDAY/` and `samples/THURSDAY/`. Each sign now has 115 samples.
- Refreshed `manifests/training-samples.csv` with `generate_manifests.py`. This dropped the 10 rows for deleted takes. Manifest backups are in `manifests/backups/20261126T171532686643Z/` and `...171815504778Z-pre-tuesday-thursday-review/`.
- Set `collection_batch = collector-zip:<zip sha256>` on the 80 new rows and approved them with review notes.
- Added intake records in `SignSync Dataset/documentation/tuesday-thursday-intake-20261127/` (extraction checksums, deleted rows, landmark QA).
- Added the work note `documentation/2026-11-27 TUESDAY and THURSDAY New Batches.md`, linked from `Dataset Guide.md`.

**Decisions and caveats**
- Both new TUESDAY batches are palm-sideways (0/20 palm toward camera each), matching THURSDAY and FAST. This was the fix the [[2026-11-27 74-sign data audit]] called for.
- Old TUESDAY batches `capture-date-20261029` and `20261031` are 20/20 palm toward camera, and `20261028` is 10/20. They are still approved.
- The new THURSDAY 11-26 WEBM batch has 6/20 clips with the palm toward the camera.
- The signer of the new batches was not recorded. FSL review is pending.

**Not done / open**
- No new prepared candidate and no retraining. The live model is unchanged.
- The user still has to decide whether to exclude the old palm-to-camera TUESDAY batches.

## Follow-up: removed non-raw batches
- Removed the 40 samples per sign with no ZIP in `raw/` (`capture-date-20261029` and `20261031`) from `samples/TUESDAY` and `samples/THURSDAY`. They are archived, byte-verified, in `SignSync Dataset/raw/superseded-samples/<SIGN>-capture-date-20261029-20261031-superseded-2026-11-27.zip`.
- Refreshed the manifest. Each sign now has 75 approved samples.
