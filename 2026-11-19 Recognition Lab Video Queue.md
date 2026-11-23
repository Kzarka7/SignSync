# 2026-11-19 Recognition Lab Video Queue

Allow multiple local videos in Recognition Lab and replay them in upload order. Keep separate recognition results and annotations for each clip. Replace per-frame seeking with sequential decoding where the browser supports it while retaining the 20 Hz source-time sampling and waiting for each recognition window. Check queue order, per-clip results, stop handling, and playback fallback. Compare the two replay paths on the same clip or quantify their operations if browser timing is unavailable.

## Result

- The Video picker accepts multiple files and appends later selections. Replay queue processes the full list in upload order for the current model. Each clip gets a fresh recognition session and connection. Select a row to review or export its results. Decode failures are recorded per clip, and stopping cancels the active decoder and leaves subsequent entries queued.
- The WebCodecs path decodes frames forward at the same 20 Hz source timestamps. The browser seek path supports codecs or browsers that cannot open the sequential decoder. Preview and status updates now run at a lower rate than inference. The report includes decoder method, processed frame count, and elapsed processing time.
- All 331 frontend tests and the production build passed. The queue test covered append order, a failed clip, the correct per-file report, and stopping before the next file. On the two-second decoder fixture, both paths supplied 40 observations at identical timestamps. The sequential path made zero video seeks and the fallback made 39 after the first frame. Headless Edge did not finish starting in this environment, so real browser wall-clock acceleration is unmeasured.

[Recognition Lab page](Frontend/src/pages/RecognitionLabPage.tsx) · [Replay service](Frontend/src/services/landmarks/videoReplay.ts) · [Decoder tests](Frontend/tests/videoReplay.test.cjs)

## Continuous 1× playback

The user requested normal video playback during replay. Use the browser player's 1× clock and sample presented frames for recognition. Keep one recognition session per queued clip. Test that video playback proceeds while inference is pending, completion waits for recognition results, and Stop cancels playback and queue advancement.

The preview now plays each clip natively at 1×. Recognition samples actual presented timestamps at up to 20 observations per source second and processes them in order. The queue waits for the final results before advancing. The playback fixture verified no seeks, continued playback while recognition was blocked, ordered result completion, and cancellation. All 331 frontend tests and the production build passed. Physical browser playback was unverified.

## Confirmed signs in queue
Each row now displays its confirmed transcript immediately before its status, in recognition order separated by arrows. Empty transcripts show an em dash; long transcripts truncate with the full text in a tooltip. Uses the selected model's stored per-video result and the live snapshot during replay. Queue regression tests passed.

## Continue replay
Add Continue replay next to Replay queue. Resume only queued and stopped clips for the selected model, restarting a stopped clip from its beginning. Preserve completed results; leave failed clips for a full replay retry. Disable while running or when nothing remains. Verify append-and-continue skips completed/failed entries, and continuation after Stop processes the remaining entries.

## Queue pause and selected replay
Replace the two controls with a stateful queue button (Replay queue / Pause queue / Continue replay / Replay again) and Replay for only the selected row. Pause must retain the active player, model session and position; gate startup and queue advancement while paused. Verify button transitions, single-video scope, and native playback pause/resume.

Implemented the queue label transitions and true player pause/resume without aborting the active session. Replay runs only the selected item and preserves other results. Seven focused tests passed, including unchanged playback timestamps/tracker lifetime across pause, single-video scope, queue transitions and completion. Production build passed. Physical browser playback remains unverified.

## Stop unlocks editing and queue column alignment
Replace retained-session pause with Stop replay that aborts the run and unlocks model selection, row selection, uploads and single replay. Continue only unfinished videos for the selected model, restarting interrupted clips. Align #, Video queue, video count and clear-all trash action with row columns. Verify stop unlocks controls, continuation skips completed clips, single replay scope and clearing the queue.

Implemented Stop replay in place of retained-session pause. Stopped state unlocks all editing controls; Continue replay processes only unfinished clips for the chosen model, while Replay reruns just the selected row. Queue header/rows share fixed number, status and action column widths; the sticky header includes # and an accessible Delete all videos trash button. Regression checks cover abort on stop, model/upload/row unlock, single replay, continuation skipping completed clips, and clearing all rows. These changes supersede the prior pause/resume behavior.

Validation: all 333 frontend tests passed; focused queue regression passed again after consolidating Stop replay on the primary button. Final production build passed. Header alignment is implemented with shared grids; visual browser verification remains pending.

## Q/E navigation and unconfirmed prediction fallback
Add previous/next selection using Q/E with the same boundary and editable-field safeguards as Collector review. Disable during replay. For clips without confirmed transcript entries, count each prediction window's top label once, even if below confirmation thresholds; show the plurality label without a checkmark. Confirmed transcripts get a leading checkmark. This is window voting because the model does not emit independent per-frame predictions. Ties keep the earliest label. Verify voting, confirmation precedence, keyboard guards and queue navigation.

Implemented Q/E through the shared Collector shortcut mapper, with boundary clamping, editable-field/modifier safeguards, and selected-row scrolling. Row text now prioritizes confirmed transcripts (leading ✓); otherwise it displays the most frequent top prediction with an unconfirmed tooltip/accessibility label. No transcript, captions, confidence thresholds or model behavior changed. Nine focused tests passed, covering navigation, shared keyboard safeguards, low-confidence window voting and deterministic ties. Actual browser interaction remains unverified.

Final production build passed after navigation scrolling was added.

## Whole queue JSON export
Add Export results for a single JSON containing every current queue clip in order for the selected recognition model. Match each row's displayed signs and distinguish confirmed transcript labels from unconfirmed plurality predictions and empty results. Include filename, metadata, queue status, counts, duration, errors and per-clip run settings where available. Disable during active replay to export a consistent stopped snapshot. Verify full queue coverage and displayed-sign parity.

Implemented Export results beside Replay. The versioned single-file JSON includes all clips in queue order for the selected model, exact displayedText and raw labels, confirmed flag and result source, confirmed transcript entries, per-label prediction-window counts, file metadata, replay/observed duration, settings, backend identity and errors. Export is disabled during replay and for an empty queue. Shared queue/export summary prevents display drift. Six focused tests passed, covering full-queue JSON download (including queued clips), repeated confirmed signs, unconfirmed vote results, empty results and voting ties.

Production build passed for the queue export. Real-browser download interaction remains unverified; the integration fixture verified the generated JSON download payload.
