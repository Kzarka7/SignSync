# Video collector checks

Use Chrome or Edge on localhost or HTTPS. Select THANK_YOU before adding recordings; each queued file keeps its assigned label.

On desktop, Upload recordings and Preview share the left column; label/source,
Review queue and collapsible Recorded samples share the right. Narrow screens stack
the sections. Recorded samples starts expanded and can be minimized from its heading.

## Upload, review and save

1. Choose Upload videos. Leave Auto-trim videos and Use trimmed intervals automatically checked. Upload reference clips `0.MOV` and `7.MOV` from `raw/105 FSL SIGNS REFERENCE-20261018T051635Z-1-001/clips/THANK YOU`.
2. Wait for processing, then open Preview / review. Check the complete gesture, landmarks, assigned label and quality findings. Automatic trimming selects boundaries without approving or saving a take.
3. Expand Tracking timeline to inspect coverage and seek through the recording. Expand Adjust interval to change boundaries or Hands used. Reprocess changed boundaries and confirm the selected interval before review.
4. Check the far-right Reviewed checkbox. Save must remain disabled before this check. The top checkbox checks/unchecks eligible unsaved takes; Save checked takes saves explicitly.
5. Save adds the take to Recorded samples and protects it from queue removal. Undo save removes that recorded sample while leaving Reviewed checked. Individual recorded-sample deletion remains available.
6. Use Download original video in the queue before leaving the page. Queue actions are shown directly. Originals are held for the session and are separate from landmark exports.

With Auto replay on, Play selected interval restarts the interval and keeps looping. With Auto replay off, it plays once and stops at the selected end.

The collector targets 30 landmark FPS automatically. Lower-rate recordings retain available observations without fabricated frames. Processing metadata records actual source timing and extracted sampling in exports; FPS controls are no longer displayed.

## Trimming and fallback

- Disable automatic use before a new upload: processing should still suggest a trim, but boundary confirmation remains manual.
- Disable auto-trim before a new upload: the full interval requires an explicit boundary choice.
- Try reference `19.MOV`: unclear activity or movement at the boundary keeps the full recording for manual review.
- Restore full recording or reprocess manual boundaries: previous approval and automatic context window clear. Review the new result before saving.
- Review quality checks tracking; it does not certify that the intended sign is correct. Missing hands during preparation/completion are assessed separately only when a reliable automatic gesture window is available.

## Camera and failures

1. Choose Camera and Preserve video, process afterward. Start camera, then Start recording. Delay/duration, the large countdown and Space/Escape shortcuts work in both camera methods. Preserved recording shows elapsed time and Stop & save video; live recording shows detection frames/FPS and Stop & save. Hands/Pose badges apply only to live tracking.
2. Stop & save video (or duration auto-stop) adds an original to Recorded samples with Waiting to process status and keeps the camera open. There is no separate Recorded videos container. The heading counts pending originals plus saved landmark samples. Record a second take, optionally changing its label or rest/idle task first. No landmark processing or upload-tab switch should occur. Pending originals retain their assigned labels/tasks.
3. Download or remove pending originals as needed inside Recorded samples. Process all must remain disabled during capture/countdown. When ready, click Process all once: the pending batch transfers to the upload/review queue at the 30 FPS target. It is no longer pending on the camera screen. Review and save landmark samples separately. JSON/ZIP and Training package exports include only saved landmark samples; clearing saved samples does not remove pending videos.
4. Discard a recording: no original should enter the pending queue. Switching to uploads manually must not submit pending recordings. Cancel processing: no unfinished sample should be saved.
5. Pending originals are held for this browser session; download them before leaving, refreshing or changing collectors.
6. Try unsupported files and duplicate uploads: errors/duplicates remain unsaved.
7. Check portrait/landscape, one-handed signs and rest-to-sign-to-rest footage. Test on physical phones for codec, orientation, keyboard and touch behavior; browser-width and simulated-camera checks do not replace device testing.

## Rest and Idle uploads

1. Open Rest and Idle Collector, choose Resting postures or Idle movements, then select a Collection task and Upload videos.
2. Add one or multiple recordings. Each queued file retains the label, category and task selected when it was added. Camera offers the same preserved-video and live-landmark methods as the sign collector.
3. Review playback, Tracking timeline and quality findings. Full intervals are retained by default: sign-motion auto-trimming would discard useful non-sign content. Keep full recording, or use Adjust interval and reprocess, then confirm the interval.
4. Check reviewed takes and Save or Save checked takes. Undo retains the review check; saved takes cannot be removed from the queue. Download originals before leaving.
5. Change categories: Recorded samples and its exports/Clear all show only that category. Queued saved takes stay protected across category switches. Task checklist counts include imported samples; task metadata remains frozen even when the next task is selected.
6. Export the category's reviewed Training package and run the validator below. Rest/idle processing uses `video-import-v6-mp0.10.35-boundary`, retaining real timestamps and raw missing-hand flags. Body coverage is required; missing hands alone do not force Retake for idle. Limited hand visibility still flags resting-posture samples for review. Manual review confirms task correctness.

## Validate a training package

Prepare and download the Training package from Recorded samples. Other exports and Clear all are under Sample exports and storage. Retain ordinary sample exports for archival use.

From the project root:

```powershell
.venv-gru/Scripts/python.exe scripts/validate_video_training_package.py 'C:/absolute/path/to/training-package.zip'
```

Expect a successful compatibility report with base shape `[sample count, 40, 164]` and geometry shape `[sample count, 40, 238]`. Keep copies of the same source recording together in dataset splits.
