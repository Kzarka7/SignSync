# Collector video imports

Open Sign Language Collector → Upload videos. Choose the label,
then select one or more prerecorded videos containing one complete sign each.
Labels are captured when files enter the queue. Changing the
selector only affects subsequent uploads.

Processing is sequential, local to the browser, and independent of the recognition
model. Tracking models are downloaded using the same runtime as camera collection.
The browser must support the file's codec; an MP4 extension alone does not guarantee
support (for example, a phone may record HEVC). Browser-decoded rotation is preserved
when drawing frames for tracking. Source-time sampling is 20 Hz, with the longest
image dimension limited to 640 pixels. This rate is a resampling rate, not a claim
about the original file's frame rate. Intervals are limited to 120 seconds.

Review the video and landmark overlay. Optional start/end times must be reprocessed
before approval. Use the checkbox at the far right of each queue row to confirm
the reviewed take matches its label. Save checked takes only saves confirmed
takes. Retake results and pending trim changes cannot be approved or saved.

Saving adds the take to Recorded samples and changes its Save action to Undo save.
Undo save removes the recorded copy, keeps the processed take in the queue, and
preserves its review checkbox. The status below the filename changes from Review
to Reviewed when checked, to Saved after saving, and back to Reviewed after Undo.
Saved takes cannot be removed from the queue until
unsaved. Checked, unsaved takes can be removed. Deleting a sample (or clearing all)
from Recorded samples also returns matching queue items to their unsaved state.

Quality version 1 uses these conservative heuristics:

- Retake: fewer than 8 usable frames or less than 400 ms of sampled duration;
  processing/decoding failures are also presented as Retake with the specific error.
- A usable frame has a valid, finite normalization vector, shoulders with at least
  0.5 visibility, and at least one complete finite hand track.
- Review: below 90% usable frames, tracking gaps of at least 250 ms, hands within
  2% of image edges, missing tracking or noticeable wrist movement at interval
  boundaries, or takes longer than 8 seconds.
- Pass: no technical concerns found. Human review is still required. Neither Pass
  nor Review certifies the sign, and extra movement cannot be reliably classified
  by these heuristics. A second moving hand is never required.

Saved sequences use the existing raw landmark and normalized export schemas.
The optional `videoImport` property identifies imported samples and retains the
original filename, SHA-256 file fingerprint, source duration,
displayed dimensions, trim boundaries, sampling rate, processing version, quality
findings, and review time. Timestamps within the sample start at zero; add
`trimStartMs` to recover the source-time position. JSON and per-sample ZIP exports
retain this metadata. SHA-256 duplicates are blocked across the current queue and
saved samples regardless of filename or label. Differently re-encoded copies are
not detected as duplicates. Delete a saved sample before replacing its trim.

Original video files are not persisted. Keep them for later video review; the
queue lasts only for the mounted collector session. Saved landmarks use existing
browser storage and can exceed its quota; failed saves remain reviewable/retryable
in the queue. Switching between camera and upload mode preserves the queue.

## Verification

Automated: `node --test tests/videoImport.test.cjs tests/videoUploadQueue.test.cjs tests/collectorFps.test.cjs`
from Frontend. Covers one-handed signs, gaps, poor body visibility, clipping,
duplicate saves, metadata in JSON and ZIP, source-time trimming, cancellation
cleanup, invalid intervals, row review controls, save/undo/re-save, recorded-list
deletion synchronization, removal guards, and failed undo. `npm run build` also passes.

The October 20 development evaluation uses the two supplied THANK YOU folders.
Its per-video raw results, SHA256 identifiers, contact sheets and aggregate report
are in the sibling dataset folder under `experiments/video_collector_20261020`.
This is a local Edge evaluation, not general device/codec acceptance. Remaining
release checks include:

1. Phone portrait and landscape recordings, including rotation metadata: confirm
   upright playback and aligned landmarks, and check exported width/height.
2. 24/30/60 fps and variable-frame-rate recordings: compare sign timing, trim
   boundaries, and exported source-relative timestamps.
3. Left-only, right-only and two-handed signs, sitting and standing: confirm
   useful takes can be reviewed, without requiring both hands or visible legs.
4. Occlusions, hand exits, cut beginnings/endings, repeated signs and setup motion:
   inspect specific findings, trim, reprocess and reconfirm before saving.
5. Cancel during loading and tracking, cancel queued takes, retry, and leave the
   page: verify no cancelled or partial sample is saved and processing stops.
6. Corrupt files and unsupported codecs: confirm the failure is visible, review
   saving is disabled, and later queued files still run.
7. Change the label during processing; verify queued assignments stay
   unchanged. Re-upload identical bytes under a different filename and label.
8. Review only some takes and save the batch; verify only those are saved. Export
   JSON/ZIP and inspect provenance. Simulate full storage and retry after freeing
   space; successful earlier batch saves must remain intact.

## Interval review and preview (v2)

HandLandmarker points can carry `visibility: 0`; this field is not used to hide
detected hands. The visibility threshold applies to pose points only.
The preview draws connected finger and upper-body landmarks from the stored
sample nearest the presented video timestamp. The left/right hand indicators
describe detections, not whether the gesture requires two hands. The overlay
does not invent missing hand points. It clears outside the processed interval
and across timestamp gaps. Fullscreen uses the video-and-canvas wrapper.

Use **Mark start here** and **Mark end here**, or the numeric inputs, to select
the complete sign with preparation/completion margins. **Reprocess interval**
extracts that interval again. Changes invalidate review until reprocessing.
The quality panel reports per-hand coverage and source-time intervals without
hand detections. It separates the selected interval from excluded frames, without
automatically classifying those excluded frames as rest. Originals remain intact.

Exports retain the selected frames and interval quality, with optional
`fullClipQuality`, actual `inputWidth`/`inputHeight`, the `maxDimension` cap and
processing version `video-import-v2-mp0.10.35-20fps`. Existing sample formats and
old exports remain readable. Default processing remains capped at 640 pixels,
20 samples/second; the development harness can compare 960 and 1280 caps without
changing live recognition settings.

Measurement harness (from Frontend):
`node scripts/assessVideoCollection.cjs <datasetRoot> <outputFolder> <playwrightModulePath> [640|960|1280] [visible|rest] [clipLimit]`
uses local cached MediaPipe assets from the earlier development experiment.
`VIDEO_UI_SMOKE=1` additionally exercises the collector in an isolated browser
context. `summarizeVideoCollection.cjs <datasetRoot> <experimentFolder>` verifies
earlier manual interval annotations by source hash before comparing coverage.
Those interval comparisons slice baseline detections; they are not fresh trimmed
inference, and their contact-sheet boundaries have approximately ±300 ms uncertainty.

## Training review and packages (v3)

Uploads now include a tracking timeline for each hand, shoulders, movement and
edge proximity. The seek slider uses source time. The suggested interval covers
all detected hand activity with 250 ms margins; it is advisory and never labels
missing hands as REST or certifies a complete gesture. Applying it changes the
draft only. Reprocess before approval. A stationary sign is allowed.

Choose whether the intended take requires both hands. The default allows one or
both. This affects quality findings, not a recognition-model prediction. Existing
technical minimums remain: 8 usable frames and at least 400 ms of sampled span.
There is no newly imposed training coverage cutoff: Review findings require the
user's explicit acceptance, while Retake blocks approval. Suggestions were checked
against the same 40 originals; all 20 reference suggestions contain the earlier
manual sign intervals (whose own uncertainty is about ±300 ms).

The far-right Reviewed checkbox confirms the label, complete sign, expected hand
coverage and accepted quality findings. Save records a versioned approval bound
to the label, interval, hand expectation and processing version. Trim changes,
reprocessing, hand-expectation changes and deletion from Recorded samples clear
approval. Undo save still retains the checked review. Originals remain unchanged.

Recorded samples uses **Export as ZIP**: click once to prepare the archive,
then again when ready to download one JSON file per saved sample. **Clear all**
sits beside the export button. Saved samples appear in save order, first saved
at the top. Merged JSON and the separate training-package action have been
removed from the collector. Review and save
samples before exporting, then use the manifest-based preparation workflow in
[SAMPLE_TRAINING.md](SAMPLE_TRAINING.md). No participant input is added.

The following package specification documents older exports for reproducibility;
the legacy builder and validator remain available for those artifacts.

The package contains:

- `dataset.json`: existing schemaVersion 1, 164 features in the existing order,
  raw observations, relative 20 Hz timestamps and missing-hand flags.
- `manifest.json`: processing conventions and source groups keyed by SHA256.
- `acceptance-report.json`: included/excluded counts, reasons and warnings.
- `README.md` and SHA256 `checksums.json` for the four payload files.

Validation checks source intervals, exclusive endpoint frame counts, frame timing,
finite raw/features, detected hand lengths, processing dimensions, preprocessing
provenance, current quality, review binding and duplicates. Duplicate source files
or identical landmark sequences are excluded after the first approved occurrence.
Quality Review is not silently upgraded to Pass. It remains in the report even
when accepted by the reviewer. No missing-hand points or long gaps are filled.

Processing version is `video-import-v3-mp0.10.35-20fps`. Coordinates preserve the
browser-displayed source orientation and source mirroring, use MediaPipe handedness
assignments, and share camera collection's normalization and feature order. Already
mirrored source pixels are not automatically detected or unmirrored. Review the
recording's handedness when relevant. Extraction defaults stay at 640 pixels/20 Hz.

Run `python scripts/validate_video_training_package.py <package.zip>` to verify
checksums, review binding, timestamps, feature order and reconstructed raw/normalized
consistency. It invokes the existing loaders and checks finite 40×164 and 40×238
tensors without training. `--split-file assignments.json` accepts a complete mapping
from sample IDs to `training`, `validation`, or `test` and rejects source overlap.
`preprocess_dataset.py` also checks source isolation before writing prepared tensors.
Existing loader interpolation remains its versioned training policy, separate from
the observations retained in the export.

Source groups do not establish signer independence: separate files may contain the
same signer or near-identical takes. The package explicitly records unknown signer
identity. Review related recordings before splitting; do not infer unseen-signer
performance from filename/source separation alone. No split is auto-assigned.

Verification includes `tests/trainingPackage.test.cjs`, existing import/queue/export
tests, and `scripts/test_validate_video_training_package.py`. To run the Python
fixture tests, set `TRAINING_PACKAGE_FIXTURE` to the ZIP written by the frontend
test with that same environment variable. `assessVideoSuggestions.cjs` writes
reproducible suggestion comparisons from the earlier 40-video baseline.

## Queue clearing and replay

**Remove all from queue** cancels active processing and removes every unsaved take,
including checked takes and queued files. It clears the removed preview and source
fingerprint ownership so those files can be uploaded again. Saved takes remain
protected until **Undo save**; recorded samples are not deleted by queue clearing.
The button is disabled when every remaining take is saved.

**Auto replay** is an opt-in preview toggle. Enabling it starts playback and repeats
the selected interval, using frame presentation times with media-event fallback.
It follows valid draft bounds while the user previews edits. Pause stops
playback; turning replay off restores ordinary playback without changing review,
trims or saved data. Replay listeners are released when disabled or the preview closes.

## Explicit interval choice and focused review

Every new take requires **Keep full recording** or **Use this interval** in its
preview before the far-right Reviewed checkbox becomes available. A full recording
remains a valid deliberate choice. No interval is confirmed automatically after
processing or after applying a suggestion. Changed boundaries must be reprocessed
and confirmed again. Reprocessing clears the decision even if the bounds are the
same. Undo save preserves both the checked review and the confirmed interval.

**Play selected interval** starts at the selected start and pauses at its exclusive
end. **Auto replay** loops those same bounds. Both work on valid draft boundaries
before reprocessing; landmarks and quality still describe the processed interval.
Editing boundaries or jumping to a finding stops interval playback. These controls
do not approve a take, reprocess data or change saved samples.

The full-recording tracking timeline displays start/end markers for the selection.
**Jump to tracking gaps and clipping** opens source-time buttons marked Inside,
Outside or Crosses interval boundary. They use stored detections and pause/seek the
video without treating missing hands as proof of rest.

Queue and training export summaries count full recordings, trimmed takes, pending
interval decisions and accepted tracking warnings. The acceptance report includes
an `intervalSummary`. New saves persist `videoImport.intervalReview` with protocol
`video-interval-review-v1`, choice, source start/end and confirmation time. Both the
browser and Python validator reject a present decision that mismatches its sample.
For these interval-review changes, existing export formats and landmark values remain unchanged.
Older saved samples without that field remain readable and exportable, but receive
a visible warning that explicit boundary confirmation was not recorded.

## Source-aware extraction and preserved recordings (v4)

The v4 release introduced `video-import-v4-mp0.10.35-source-frames`, default 30 FPS,
and offers 60 FPS and a 20 FPS comparison setting. It decodes actual source
frames through WebCodecs, selects distinct presentation timestamps at the target
cadence, and never manufactures extra observations for a lower-rate source.
Sources averaging within 2% of the target or below it retain their full cadence;
this avoids dropping real camera observations because of timestamp jitter.
Source display transforms are applied before tracking. Source timestamps stay
on the native video's media timeline, including phone files whose first frame
starts after time zero. Trimmed sample timestamps are relative to trim start.

The decoder is loaded separately using [Mediabunny's local media sinks](https://mediabunny.dev/guide/media-sinks).
Chrome or Edge with WebCodecs on localhost/HTTPS is required. Codec support is
browser-dependent; an unsupported codec produces a decode error.

The preview distinguishes measured source FPS, requested FPS, achieved landmark
FPS and processing speed. Inference may take longer than the video duration
while still retaining 30/60 source observations per second of video. v4 stores
`videoImport.sampling`, per-frame `sourceTimestampMs` and `sourceDurationMs`, and
an origin of `uploaded-file` or `camera-recording`. Quality duration checks use
timestamps rather than assuming 50 ms per frame. Landmark features remain 164
values; the training loader's existing resampling policy is unchanged.

Camera collection defaults to **Preserve video, process afterward**. MediaRecorder
captures without live landmark inference, freezes the label/rate at record start,
and keeps each original pending until **Process all** transfers the batch into
the upload/review queue. **Download
original video** preserves the source separately: it is session-only in the app
and is not bundled into landmark exports. Legacy live landmark recording remains
available. Camera frame-rate requests are preferences; verify the measured result.

Existing v3 20 FPS exports remain supported and unchanged. Training validators
apply their original fixed-grid checks to v3 and source-provenance checks to v4.
See [the manual test guide](VIDEO_COLLECTOR_TESTING.md) for the full workflow.

## Automatic trimming and batch approval

New uploads and preserved camera recordings capture two enabled-by-default options:
**Auto-trim and reprocess new recordings** and **Automatically use trimmed intervals**.
The first runs a full pass, then reprocesses one clear suggestion with 250 ms margins.
Automatic candidates must have margins inside both source boundaries, at least
400 ms span, movement evidence and no internal detected-activity gap over 750 ms.
These are conservative tracking heuristics, not recognition or certified gesture boundaries.
Unclear candidates retain the full result for manual interval selection. An unusable
or failed second pass also falls back to the full result; cancellation never approves a result.

Automatic use records `intervalReview.selectionMethod: automatic` for a successful
trim. It does not check Reviewed or save. Manual confirmation records `manual`;
older metadata without selectionMethod remains supported. The full-pass quality
and timeline remain available. **Restore full recording** explicitly reprocesses
the original interval, clears approval and prevents immediately reapplying auto-trim.

The far-right **Check or uncheck all previews** checkbox is an explicit human batch approval action for eligible
unsaved takes with selected, processed boundaries and acceptable technical quality.
It skips pending trims, unconfirmed intervals, active/failed/duplicate takes and
saved takes. Clearing the checkbox clears eligible unsaved checks. Saving remains
a separate action; saved takes retain their protection until Undo save.

## Gesture/context quality (v5)

New processing is versioned `video-import-v5-mp0.10.35-gesture-context`. Decoding,
timestamps, feature order and retained observations use the v4 source-frame policy.
Existing v3/v4 quality and export validation remain unchanged.

For a clear automatic trim, the first/last detected activity before adding the
250 ms padding supplies a provisional gesture assessment window. Metadata
`qualityWindow` uses protocol `gesture-context-v1`, relative start/end milliseconds
and basis `automatic-hand-activity`. Each margin is limited to 350 ms and the
gesture window must span at least 400 ms. Arbitrary internal missing-hand gaps
cannot become context. Unclear/full recordings do not gain this exemption.

Quality counts for the complete selected interval remain intact. `quality.gesture`
records assessment-frame counts and gesture gap duration; `quality.context` records
before/after counts, missing-hand counts and informational findings. Minimum usable
duration, weak coverage and missing-hand warnings assess the gesture window.
Clipping anywhere and motion at the actual saved boundaries still require review.
The candidate window does not classify context as idle or certify a complete sign.

The preview automatically separates gesture quality from preparation/completion
context on eligible automatically trimmed takes. Manual boundary reprocessing or
restoring full footage clears the automatic window. Training approval
binds the chosen window as well as label, trim, expected hands and processing version.
Browser and Python validators reject stale window approval and invalid provenance;
Python additionally verifies gesture/context counts against the saved observations.

## Simplified collector controls (October 21)

Uploads and preserved camera recordings target 30 landmark FPS automatically.
Lower-rate footage retains its available observations without creating frames.
Internal processing options still support other rates for diagnostic comparisons;
the collector no longer exposes FPS selectors. Earlier UI instructions describing
rate controls apply to older builds.

The preview retains playback, actionable quality findings, **Tracking timeline**
and **Adjust interval**. The timeline remains seekable; the separate gap/clipping
jump list and explanatory diagnostic panels have been removed. Hand coverage
selection is inside Adjust interval. Saved processing and quality metadata remain
available in exports.

## Rest/idle video policy (v6)

Rest and Idle Collector reuses the upload queue, preview, playback, manual trimming,
30 FPS source sampling, duplicate checks, review/save/undo and export workflow.
Camera capture also supports preserved originals through the same queue.

Queue entries freeze `training` metadata (category, task ID/title, optional batch
fields) when the file is added or captured. Saving preserves that metadata;
category-scoped recorded samples and checklist progress include imported takes.
Queue ownership is reconciled against all training storage so switching categories
does not release saved entries or permit their removal.

Non-sign footage keeps its full interval until an explicit human boundary choice.
No sign-activity trim or gesture/context exemption is applied. Version
`video-import-v6-mp0.10.35-boundary` records `samplePurpose` as `rest` or
`idle_movement`. Quality requires at least 0.4 seconds of usable body observations
and sampled span, reports weak body tracking and clipping, and retains null hands.
Resting tasks additionally flag limited hand visibility; idle does not require
visible hands. No movements are automatically certified as non-sign content.

Review binds `completeSample`, sample purpose and a snapshot of the training task,
as well as label, interval, expected hands and processing version. Sign approval
continues to use `completeSign` and its existing quality policy. Browser and Python
package validators reject stale task/category approval and policy mismatches. The
164-feature schema remains unchanged. Training preparation still needs deliberate
splits and review; these exports do not train a model.

## Deferred preserved-camera batches

Both collectors retain finished camera originals inside Recorded samples, with
Waiting to process status and Process all. There is no separate video container;
the heading counts pending originals and saved landmark samples. Pending originals
are excluded from JSON/ZIP/training exports and saved-sample Clear all.
Stop & save video and duration auto-stop keep the camera stream open;
recording multiple takes does not run inference or change collection source.
Pending entries freeze label and optional rest/idle task metadata per take.
They can be downloaded or removed before processing. They are browser-session
Files, not persistent storage or approved landmark samples.

Process all is an explicit batch handoff, disabled while capturing/counting down.
It drains pending entries once into the existing upload/review queue and opens that
workspace. Uploads keep their existing immediate processing behavior. Originals
remain downloadable from the processing queue. Live landmark save behavior is
unchanged; processing and human approval remain distinct actions.
