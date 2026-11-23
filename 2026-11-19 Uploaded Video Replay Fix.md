# 2026-11-19 Uploaded Video Replay Fix

Goal: fix the duration rejection shown in the uploaded-video queue. The screenshot maps to Recognition Lab, whose replay service currently rejects unknown/infinite HTML video durations as overlong clips. Preserve normal preview playback without requiring landmarks.

Files: Frontend/src/services/landmarks/videoReplay.ts; duration metadata helper; replay regression tests. Existing uncommitted queue work is preserved.

Verification: cover WebM-style infinite duration, real over-limit rejection, cancellation and cleanup; run frontend tests and production build. Actual supplied clips are unavailable, so their codec compatibility remains unverified.

Implemented packet-based duration fallback without a WebCodecs requirement. Split unknown-duration and decode errors from the genuine 120-second limit. Existing native preview controls allow playback before recognition. Four replay regression tests passed, including infinite-duration WebM metadata and true over-limit rejection. Production build passed. Actual user files and visual browser playback remain unverified.

Full frontend suite: 333 tests passed. Review confirmed the fallback runs only for missing/invalid duration, retains the 120-second cap, checks cancellation before tracker initialization, and disposes the metadata reader.
