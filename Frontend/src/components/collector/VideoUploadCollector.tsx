import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import type { LabeledSequence, TrainingCollectionMetadata, VideoQualityWindow } from '../../types/dataset'
import { deleteSequence, hasSourceFingerprint, saveSequence } from '../../services/dataset/datasetStorage'
import { buildOriginalVideosZipExport, triggerDownload } from '../../services/dataset/datasetExport'
import { fingerprintVideo, IMPORT_FPS, processVideo, VIDEO_IMPORT_VERSION, BOUNDARY_IMPORT_VERSION } from '../../services/dataset/videoImport'
import { drawVideoLandmarks, previewFrame } from '../../services/dataset/videoPreview'
import { automaticSignInterval, reviewSignInterval, type ExpectedHands } from '../../services/dataset/videoDiagnostics'
import { assessVideoQuality, assessBoundaryVideoQuality } from '../../services/dataset/videoQuality'
import { bindVideoReplay } from '../../services/dataset/videoPlayback'
import { confirmInterval, intervalReviewMatches, isFullRecording, type IntervalReview } from '../../services/dataset/videoIntervalReview'
import VideoTrackingTimeline from './VideoTrackingTimeline'
import Button from '../shared/Button'
import Card from '../shared/Card'
import { Keyboard } from 'lucide-react'
import CollectorShortcutHelp from './CollectorShortcutHelp'
import LabelPicker from './LabelPicker'
import { adjustedIntervalTime, collectorShortcut } from '../../services/dataset/collectorShortcuts'

type Result = Awaited<ReturnType<typeof processVideo>> & { contextCandidate?: VideoQualityWindow }
type Take = {
  training?: TrainingCollectionMetadata
  id: string; file: File; label: string; fingerprint?: string
  status: 'Queued' | 'Processing' | 'Ready' | 'Retake' | 'Cancelled' | 'Duplicate' | 'Saved' | 'Saving'
  progress: number; message?: string; result?: Result; reviewed: boolean
  fullResult?: Result
  interval?: { start: number; end: number }
  draft?: { start: number; end: number }
  expectedHands?: ExpectedHands
  intervalReview?: IntervalReview
  origin?: 'uploaded-file' | 'camera-recording'
  autoTrim?: boolean
  qualityWindow?: VideoQualityWindow
  contextCandidate?: VideoQualityWindow
}
type RemovedTakes = { items: { take: Take; index: number }[]; selected: string | null }

function purposeOf(take: Pick<Take, 'training'>) {
  const category = take.training?.category
  return category === 'rest' || category === 'idle_movement' ? category : undefined
}
function qualityFor(take: Take, result: Result, expectedHands: ExpectedHands) {
  const purpose = purposeOf(take)
  const timing = result.sampling ? { endMs: (result.end - result.start) * 1000, fps: result.sampling.effectiveTargetFps } : undefined
  return purpose ? assessBoundaryVideoQuality(result.frames, purpose, expectedHands, timing)
    : assessVideoQuality(result.frames, expectedHands, timing, result.qualityWindow)
}

function hasPendingTrim(take: Take) {
  return !!take.result && !!take.draft && (take.draft.start !== take.result.start || take.draft.end !== take.result.end)
}

function canReview(take: Take) {
  return take.status === 'Ready' && !!take.result && take.result.quality.result !== 'Retake' && !hasPendingTrim(take) &&
    intervalReviewMatches(take.intervalReview, take.result.start, take.result.end, take.result.duration)
}

function TakePreview({ locked = false, take, onTrim, onDraftChange, onHandsChange, onConfirmInterval }: {
  locked?: boolean; take: Take; onTrim: (start: number, end: number) => void; onDraftChange: (start: number, end: number) => void
  onHandsChange: (expected: ExpectedHands) => void
  onConfirmInterval: () => void
}) {
  const video = useRef<HTMLVideoElement>(null), canvas = useRef<HTMLCanvasElement>(null)
  const player = useRef<HTMLDivElement>(null)
  const [showOverlay, setShowOverlay] = useState(true)
  const [autoReplay, setAutoReplay] = useState(false)
  const [intervalPlayback, setIntervalPlayback] = useState(false)
  const wholePlayback = useRef(false)
  const [playRequest, setPlayRequest] = useState(0)
  const replayCheck = useRef<(seconds: number) => boolean>(() => false)
  const replayDispose = useRef<() => void>(() => {})
  const [url, setUrl] = useState('')
  const [start, setStart] = useState(take.draft?.start ?? take.result?.start ?? 0)
  const [end, setEnd] = useState(take.draft?.end ?? take.result?.end ?? 0)
  const [duration, setDuration] = useState(take.result?.duration ?? 0)
  const [previewError, setPreviewError] = useState('')
  const suggestion = useMemo(() => take.fullResult && !purposeOf(take) ? reviewSignInterval(take.fullResult.frames, take.fullResult.duration) : null, [take.fullResult, take.training])
  useEffect(() => {
    const objectUrl = URL.createObjectURL(take.file); setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [take.file])
  const validDraft = [start, end, duration].every(Number.isFinite) && start >= 0 && end > start && end <= duration
  const replayStart = validDraft ? start : take.result?.start ?? 0, replayEnd = validDraft ? end : take.result?.end ?? duration
  const stopIntervalPlayback = () => { setAutoReplay(false); setIntervalPlayback(false); video.current?.pause() }
  const updateDraft = (a: number, b: number) => { stopIntervalPlayback(); onDraftChange(a, b) }
  const canEdit = !locked && take.status === 'Ready'
  const toggleIntervalPlayback = () => {
    const v = video.current
    if (!v || !validDraft) return
    if (!v.paused && !wholePlayback.current) { v.pause(); setIntervalPlayback(false); return }
    wholePlayback.current = false
    setPreviewError(''); setIntervalPlayback(true); setPlayRequest(value => value + 1)
  }
  const toggleWholePlayback = () => {
    const v = video.current
    if (!v) return
    if (!v.paused && wholePlayback.current) { v.pause(); return }
    const switching = !wholePlayback.current
    wholePlayback.current = true; setIntervalPlayback(false)
    replayDispose.current()
    replayCheck.current = () => false
    if (switching || v.ended) v.currentTime = 0
    void v.play().catch(() => setPreviewError('Playback could not start. Try again.'))
  }
  const timeKey = (field: 'start' | 'end', event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!canEdit || event.isDefaultPrevented() || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === 'Enter') {
      event.preventDefault()
      if (!event.repeat && validDraft && end - start <= 120) onTrim(start, end)
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const value = field === 'start' ? start : end
      const next = adjustedIntervalTime(Number.isFinite(value) ? value : 0, event.key === 'ArrowUp' ? 1 : -1, event.shiftKey, duration)
      if (field === 'start') { setStart(next); updateDraft(next, end) }
      else { setEnd(next); updateDraft(start, next) }
    }
  }
  useEffect(() => {
    const v = video.current
    if (!intervalPlayback || !v || !url || !(replayEnd > replayStart)) return
    const replay = bindVideoReplay(v, replayStart, replayEnd, () => { setPreviewError('Playback could not start. Press Play selected interval to retry.'); setAutoReplay(false) },
      { loop: autoReplay, onComplete: () => setIntervalPlayback(false) })
    replayCheck.current = replay.check
    replayDispose.current = replay.dispose
    if (v.currentTime < replayStart || v.currentTime >= replayEnd) v.currentTime = replayStart
    replay.play()
    return () => { replay.dispose(); replayCheck.current = () => false }
  }, [autoReplay, intervalPlayback, playRequest, url, replayStart, replayEnd])
  useEffect(() => {
    let raf = 0, callback = 0
    const v = video.current
    if (!v) return
    const draw = (seconds = v.currentTime) => {
      if (replayCheck.current(seconds)) return
      const v = video.current, c = canvas.current
      if (v && c && v.videoWidth) {
        if (c.width !== v.videoWidth || c.height !== v.videoHeight) { c.width = v.videoWidth; c.height = v.videoHeight }
        const ctx = c.getContext('2d')!
        ctx.clearRect(0, 0, c.width, c.height)
        const result = take.result
        const frame = result && !v.seeking ? previewFrame(result.frames, seconds, result.start, result.end, result.sampling?.effectiveTargetFps ?? 20) : null
        if (frame && showOverlay) drawVideoLandmarks(ctx, frame.raw, c.width, c.height)
      }
    }
    const update = () => draw()
    const presented: VideoFrameRequestCallback = (_now, metadata) => { draw(metadata.mediaTime); callback = v.requestVideoFrameCallback(presented) }
    const fallback = () => { draw(); raf = requestAnimationFrame(fallback) }
    if (typeof v.requestVideoFrameCallback === 'function') callback = v.requestVideoFrameCallback(presented)
    else raf = requestAnimationFrame(fallback)
    const events = ['loadeddata', 'seeked', 'seeking', 'pause', 'ended'] as const
    events.forEach(event => v.addEventListener(event, update))
    draw()
    return () => { cancelAnimationFrame(raf); if (callback) v.cancelVideoFrameCallback(callback); events.forEach(event => v.removeEventListener(event, update)) }
  }, [take.result, showOverlay, url])
  const dirty = !!take.result && (start !== take.result.start || end !== take.result.end)
  const trimmed = take.result && !isFullRecording(take.result.start, take.result.end, take.result.duration)
  const intervalConfirmed = !!take.result && !dirty && intervalReviewMatches(take.intervalReview, take.result.start, take.result.end, take.result.duration)
  const findingSource = take.fullResult ?? take.result
  return <Card><div className="space-y-3">
    <div><h2 className="font-semibold text-lg mb-1">Preview</h2><h3 className="text-sm font-semibold break-all">{take.file.name} · {take.label}</h3>{take.training && <p className="text-xs text-text-2 mt-1">{take.training.taskTitle}</p>}</div>
    {take.result && <div className="border border-border rounded-lg bg-sky p-3 space-y-2" aria-label="Interval confirmation">
      <p className="font-semibold">{validDraft && isFullRecording(start, end, duration) ? 'Full recording selected' : 'Selected interval'} · {Number.isFinite(start) ? start.toFixed(2) : '—'}–{Number.isFinite(end) ? end.toFixed(2) : '—'}s</p>
      {dirty && <p className="text-sm text-text-2">Reprocess to apply your changes.</p>}
      <div className="flex gap-2 flex-wrap">
        {!intervalConfirmed && <Button size="sm" variant="primary" disabled={locked || take.status !== 'Ready' || dirty || !validDraft}
          onClick={onConfirmInterval}>{trimmed ? 'Use this interval' : 'Keep full recording'}</Button>}
        {trimmed && <Button size="sm" disabled={locked || take.status !== 'Ready'} onClick={() => onTrim(0, duration)}>Restore full recording</Button>}
      </div>
      {intervalConfirmed && <p className="text-xs font-semibold text-success-dark" role="status">{take.intervalReview?.choice === 'full-recording' ? 'Full recording confirmed' : 'Selected interval confirmed'}</p>}
    </div>}
    <div ref={player} className="mx-auto w-fit max-w-full bg-black flex items-center justify-center">
    <div className="relative w-fit max-w-full">
      <video ref={video} src={url} controls controlsList="nofullscreen" disablePictureInPicture playsInline className="block max-h-[480px] max-w-full" onError={() => setPreviewError('This browser cannot preview the video. Try a compatible MP4 export.')}
        onLoadedMetadata={event => {
          // Native video metadata may round a phone timestamp by a fraction of a
          // millisecond. Keep processed bounds on the decoder's canonical timeline.
          const d = take.result?.duration ?? event.currentTarget.duration
          if (Number.isFinite(d)) { setDuration(d); if (!end) setEnd(d) }
          const selectedStart = take.draft?.start ?? take.result?.start ?? 0
          if (Number.isFinite(selectedStart) && selectedStart >= 0 && selectedStart < d) event.currentTarget.currentTime = selectedStart
        }} />
      <canvas ref={canvas} aria-hidden="true" className="pointer-events-none absolute inset-0 w-full h-full" />
    </div>
    </div>
    <div className="flex gap-3 items-center flex-wrap text-sm">
      <label className="flex gap-2 items-center"><input type="checkbox" checked={showOverlay} onChange={e => setShowOverlay(e.target.checked)} />Show landmarks</label>
      <Button size="sm" data-collector-shortcut="play-interval" title="Play/pause selected interval (Space)" disabled={!take.result || !validDraft} onClick={toggleIntervalPlayback}>Play selected interval</Button>
      <Button size="sm" data-collector-shortcut="play-whole" disabled={!take.result} onClick={toggleWholePlayback}>Play/pause whole recording</Button>
      <Button size="sm" variant={autoReplay ? 'primary' : 'default'} aria-pressed={autoReplay} disabled={!take.result || !validDraft}
        data-collector-shortcut="loop" title="Repeat the selected interval. Whole-recording playback is unaffected."
        onClick={() => { setPreviewError(''); setAutoReplay(value => !value) }}>Auto replay {autoReplay ? 'on' : 'off'}</Button>
      <Button size="sm" onClick={() => { void player.current?.requestFullscreen?.().catch(() => setPreviewError('Fullscreen is unavailable in this browser.')) }} aria-label="Fullscreen with landmarks">Fullscreen</Button>
    </div>
    {take.result && <div aria-live="polite">
      <p className="font-semibold" aria-label="Tracking quality">{take.result.quality.result} &middot; {(take.result.quality.gesture ?? take.result.quality).usableFrames}/{(take.result.quality.gesture ?? take.result.quality).totalFrames} usable frames</p>
      {take.result.quality.result !== 'Pass' && <ul className="list-disc pl-5 text-sm">{take.result.quality.findings.map(finding => <li key={finding}>{finding}</li>)}</ul>}
      <p className="text-xs text-text-2">{purposeOf(take) ? 'Confirm the assigned non-sign task and interval before saving.' : 'Confirm the complete sign and label before saving.'}</p>
    </div>}
    {previewError && <p role="alert">{previewError}</p>}
    <details className="rounded-lg border border-border p-3 text-sm"><summary className="cursor-pointer font-semibold">Tracking timeline</summary><div className="mt-3 space-y-3">
    {findingSource && <VideoTrackingTimeline frames={findingSource.frames} start={findingSource.start} end={findingSource.end} selectedStart={replayStart} selectedEnd={replayEnd}
      onSeek={seconds => { stopIntervalPlayback(); if (video.current) video.current.currentTime = seconds }} />}
    </div></details>
    <details open={dirty || !intervalConfirmed} className="rounded-lg border border-border p-3 text-sm"><summary className="cursor-pointer font-semibold">Adjust interval</summary>
    <fieldset disabled={locked || take.status === 'Saving' || take.status === 'Processing' || take.status === 'Queued' || take.status === 'Saved' || take.status === 'Duplicate'} className="space-y-3 mt-3">
      {suggestion && <div className="border border-border rounded p-2 space-y-2 text-sm">
        <p>Suggested: {suggestion.start.toFixed(2)}–{suggestion.end.toFixed(2)}s</p>
        <p className="text-xs text-text-2">{suggestion.reason}</p>
        <Button size="sm" data-collector-shortcut="suggest" disabled={!canEdit} onClick={() => { setStart(suggestion.start); setEnd(suggestion.end); updateDraft(suggestion.start, suggestion.end); if (video.current) video.current.currentTime = suggestion.start }}>Use suggested interval</Button>
      </div>}
      <div className="flex gap-3 flex-wrap items-end">
        <label className="text-sm">{purposeOf(take) ? 'Interval start (seconds)' : 'Sign start (seconds)'}<input data-collector-shortcut="start" className="block border rounded p-2 w-28" type="number" min="0" max={duration} step="0.05" value={start} onKeyDown={event => timeKey('start', event)} onChange={e => { setStart(e.target.valueAsNumber); updateDraft(e.target.valueAsNumber, end) }} /></label>
        <label className="text-sm">{purposeOf(take) ? 'Interval end (seconds)' : 'Sign end (seconds)'}<input data-collector-shortcut="end" className="block border rounded p-2 w-28" type="number" min="0" max={duration} step="0.05" value={end} onKeyDown={event => timeKey('end', event)} onChange={e => { setEnd(e.target.valueAsNumber); updateDraft(start, e.target.valueAsNumber) }} /></label>
        <Button size="sm" onClick={() => { const t = video.current?.currentTime ?? 0; setStart(t); updateDraft(t, end) }}>Mark start here</Button>
        <Button size="sm" onClick={() => { const t = video.current?.currentTime ?? 0; setEnd(t); updateDraft(start, t) }}>Mark end here</Button>
        <Button size="sm" disabled={!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > duration || end - start > 120}
          onClick={() => onTrim(start, end)}>Reprocess interval</Button>
        <Button size="sm" onClick={() => { if (video.current) video.current.currentTime = Number.isFinite(start) ? start : 0 }}>Go to start</Button>
      </div>
      {purposeOf(take) !== 'idle_movement' && <label className="block text-sm">{purposeOf(take) ? 'Expected hand visibility' : 'Hands used'}<select aria-label="Expected hand coverage for this take" className="block border border-border rounded-lg p-2 mt-1 max-w-full" value={take.expectedHands ?? 'either'} onChange={event => onHandsChange(event.target.value as ExpectedHands)}>
        <option value="either">One or both hands</option><option value="both">Both hands</option>
      </select></label>}
    </fieldset></details>
  </div></Card>
}

export default function VideoUploadCollector({ label, knownLabels = [], sequences, onSaved, onBusy, incoming, onIncomingConsumed, controls, recordedSamples, training, onSampleSaved }: {
  knownLabels?: string[]
  training?: TrainingCollectionMetadata; onSampleSaved?: (sample: LabeledSequence) => void
  controls?: ReactNode; recordedSamples?: ReactNode
  label: string; sequences: LabeledSequence[]; onSaved: () => void; onBusy: (busy: boolean) => void
  incoming?: { id: string; file: File; label: string; fps: number; training?: TrainingCollectionMetadata }[]
  onIncomingConsumed?: (ids: string[]) => void
}) {
  const [takes, setTakes] = useState<Take[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [removedTake, setRemovedTake] = useState<RemovedTakes | null>(null)
  const [removedAll, setRemovedAll] = useState<RemovedTakes | null>(null)
  const [saveError, setSaveError] = useState('')
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const downloading = useRef(false)
  const downloadAll = async () => {
    if (downloading.current || !takes.length) return
    downloading.current = true
    setIsDownloading(true)
    setDownloadError('')
    try {
      const { blob, filename } = await buildOriginalVideosZipExport(takes.map(take => ({ label: take.label, file: take.file })))
      triggerDownload(blob, filename)
    } catch (error) {
      setDownloadError(`Could not download videos: ${error instanceof Error ? error.message : 'Please try again.'}`)
    } finally {
      downloading.current = false
      setIsDownloading(false)
    }
  }
  const [relabelOpen, setRelabelOpen] = useState(false)
  const [replacementLabel, setReplacementLabel] = useState('')
  const [relabelScope, setRelabelScope] = useState<'current' | 'checked' | 'all'>('checked')
  const [relabelMessage, setRelabelMessage] = useState('')
  const workspace = useRef<HTMLDivElement>(null)
  const reviewQueue = useRef<HTMLUListElement>(null)
  const [shortcutHelp, setShortcutHelp] = useState(false)
  const saving = useRef(false)
  const [isSaving, setIsSaving] = useState(false)
  const [autoTrim, setAutoTrim] = useState(true)
  const boundary = !!purposeOf({ training })
  const allPreviewsCheckbox = useRef<HTMLInputElement>(null)
  const eligibleTakes = takes.filter(canReview)
  const allPreviewsChecked = eligibleTakes.length > 0 && eligibleTakes.every(take => take.reviewed)
  const somePreviewsChecked = eligibleTakes.some(take => take.reviewed)
  useEffect(() => {
    if (allPreviewsCheckbox.current) allPreviewsCheckbox.current.indeterminate = somePreviewsChecked && !allPreviewsChecked
  }, [somePreviewsChecked, allPreviewsChecked, takes.length])
  const seenIncoming = useRef(new Set<string>())
  const active = useRef<{ id: string; controller: AbortController } | null>(null)
  const fingerprints = useRef(new Map<string, string>())
  const processingRuns = useRef(new Map<string, symbol>())
  const alive = useRef(true)
  const patch = (id: string, changes: Partial<Take>) => setTakes(previous => previous.map(take => take.id === id ? { ...take, ...changes } : take))
  const busy = isSaving || takes.some(take => take.status === 'Queued' || take.status === 'Processing')
  useEffect(() => {
    const added = (incoming ?? []).filter(item => !seenIncoming.current.has(item.id))
    if (!added.length) return
    added.forEach(item => seenIncoming.current.add(item.id))
    setTakes(previous => [...previous, ...added.map(item => ({ id: item.id, file: item.file, label: item.label,
      training: item.training ? { ...item.training } : undefined,
      expectedHands: item.training?.category === 'rest' && item.training.taskId.includes('_both_') ? 'both' as const : 'either' as const,
      autoTrim: !purposeOf(item) && autoTrim, origin: 'camera-recording' as const, status: 'Queued' as const, progress: 0, reviewed: false }))])
    setSelected(added[added.length - 1].id); onIncomingConsumed?.(added.map(item => item.id))
  }, [incoming, onIncomingConsumed])
  // Recorded-sample deletion (including Clear all) also releases its queue item.
  useEffect(() => {
    const savedIds = new Set(sequences.map(sequence => sequence.id))
    setTakes(previous => previous.some(take => take.status === 'Saved' && !savedIds.has(take.id))
      ? previous.map(take => take.status === 'Saved' && !savedIds.has(take.id)
        ? { ...take, status: 'Ready', reviewed: false, intervalReview: undefined } : take)
      : previous)
  }, [sequences])
  useEffect(() => { onBusy(busy); return () => onBusy(false) }, [busy, onBusy])
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; active.current?.controller.abort() }
  }, [])
  useEffect(() => {
    if (active.current) return
    const take = takes.find(t => t.status === 'Queued')
    if (!take) return
    const controller = new AbortController()
    const run = Symbol()
    processingRuns.current.set(take.id, run)
    const update = (changes: Partial<Take>) => { if (processingRuns.current.get(take.id) === run) patch(take.id, changes) }
    active.current = { id: take.id, controller }
    update({ status: 'Processing', progress: 0, message: undefined })
    void (async () => {
      try {
        const fingerprint = take.fingerprint ?? await fingerprintVideo(take.file)
        controller.signal.throwIfAborted()
        const alreadySaved = await hasSourceFingerprint(fingerprint)
        controller.signal.throwIfAborted()
        const owner = fingerprints.current.get(fingerprint)
        if ((owner && owner !== take.id) || alreadySaved) {
          update({ status: 'Duplicate', fingerprint, message: 'This source file is already queued or saved, even if its filename or label differs.' })
          return
        }
        fingerprints.current.set(fingerprint, take.id)
        update({ fingerprint })
        let result: Result = await processVideo(take.file, controller.signal, progress => {
          if (alive.current) update({ progress: !take.interval && take.autoTrim ? Math.round(progress * .5) : progress })
        }, take.interval, { targetFps: IMPORT_FPS, qualityWindow: take.qualityWindow, samplePurpose: purposeOf(take) })
        result.contextCandidate = take.contextCandidate
        controller.signal.throwIfAborted()
        const fullResult = isFullRecording(result.start, result.end, result.duration) ? result : take.fullResult
        let message: string | undefined, intervalReview: IntervalReview | undefined
        if (!take.interval && take.autoTrim) {
          const suggested = automaticSignInterval(result.frames, result.duration)
          if (suggested) {
            update({ progress: 50, message: 'Auto-trimming and reprocessing the suggested interval…' })
            try {
              const qualityWindow: VideoQualityWindow = { protocol: 'gesture-context-v1', basis: 'automatic-hand-activity',
                startMs: suggested.activityStartMs - suggested.start * 1000, endMs: suggested.activityEndMs - suggested.start * 1000 }
              const trimmed = await processVideo(take.file, controller.signal, progress => {
                if (alive.current) update({ progress: 50 + Math.round(progress * .49) })
              }, { start: suggested.start, end: suggested.end }, { targetFps: IMPORT_FPS, qualityWindow })
              controller.signal.throwIfAborted()
              if (trimmed.quality.result === 'Retake') message = 'Automatic trim had too little usable data. Full recording retained; adjust boundaries manually.'
              else {
                result = { ...trimmed, contextCandidate: qualityWindow }
                message = 'Automatically trimmed and reprocessed. Preview one complete sign before checking Reviewed.'
              }
            } catch (error) {
              controller.signal.throwIfAborted()
              message = 'Automatic reprocessing failed. Full recording retained; retry with manual boundaries.'
            }
          } else message = 'No clear automatic trim found. Full recording selected. Preview and adjust manually if needed.'
        }
        controller.signal.throwIfAborted()
        if (purposeOf(take) || take.expectedHands === 'both') result.quality = qualityFor(take, result, take.expectedHands ?? 'either')
        if (!purposeOf(take)) intervalReview = confirmInterval(result.start, result.end, result.duration, take.interval ? 'manual' : 'automatic')
        if (alive.current) update({ status: 'Ready', progress: 100, result,
          fullResult, interval: isFullRecording(result.start, result.end, result.duration) ? take.interval : { start: result.start, end: result.end },
          qualityWindow: result.qualityWindow, contextCandidate: result.contextCandidate,
          message, draft: undefined, reviewed: false, intervalReview })
      } catch (error) {
        if (alive.current) update({ status: controller.signal.aborted ? 'Cancelled' : 'Retake',
          message: controller.signal.aborted ? 'Processing cancelled. Retry when ready.' : String(error instanceof Error ? error.message : error), reviewed: false })
      } finally {
        active.current = null
        // Trigger the next item even when cancellation happened during a pending load.
        if (alive.current) setTakes(previous => [...previous])
      }
    })()
  }, [takes])

  const save = async (items: Take[]) => {
    if (saving.current) return
    saving.current = true; setIsSaving(true)
    setSaveError('')
    for (const take of items) {
      if (!canReview(take) || !take.reviewed || !take.result || !take.fingerprint) continue
      const result = take.result
      const now = new Date().toISOString()
      const samplePurpose = purposeOf(take)
      const processingVersion = samplePurpose ? BOUNDARY_IMPORT_VERSION : VIDEO_IMPORT_VERSION
      const sequence: LabeledSequence = {
        ...(take.training ? { training: { ...take.training } } : {}),
        id: take.id, label: take.label, createdAt: now, frames: result.frames,
        durationMs: result.frames[result.frames.length - 1].timestamp - result.frames[0].timestamp,
        videoImport: { kind: 'video-upload', filename: take.file.name,
          fingerprint: take.fingerprint, trimStartMs: result.start * 1000, trimEndMs: result.end * 1000,
          sourceDurationMs: result.duration * 1000, width: result.width, height: result.height,
          samplePurpose, sampleFps: result.sampling?.achievedFps ?? IMPORT_FPS, sampling: result.sampling, origin: take.origin ?? 'uploaded-file', processingVersion, quality: result.quality, reviewedAt: now,
          inputWidth: result.inputWidth, inputHeight: result.inputHeight, maxDimension: result.maxDimension,
          fullClipQuality: take.fullResult?.quality, expectedHands: take.expectedHands ?? 'either',
          qualityWindow: result.qualityWindow,
          intervalReview: take.intervalReview,
          review: { protocol: 'video-training-review-v1', label: take.label, trimStartMs: result.start * 1000, trimEndMs: result.end * 1000,
            processingVersion, expectedHands: take.expectedHands ?? 'either', qualityWindow: result.qualityWindow,
            ...(samplePurpose ? { samplePurpose, training: { ...take.training! }, completeSample: true as const } : { completeSign: true as const }), qualityFindingsAccepted: true },
          preprocessing: { orientation: 'source-display-transform', mirroring: 'source-unchanged', handedness: 'mediapipe-assignment', missingHands: 'null-with-presence-flags', interpolation: 'none' } },
      }
      patch(take.id, { status: 'Saving' })
      try { await saveSequence(sequence) }
      catch (error) { patch(take.id, { status: 'Ready' }); setSaveError(`Could not save ${take.file.name}: ${error instanceof Error ? error.message : 'browser storage may be full'}. Export saved samples and free space if needed; this take remains in the queue.`); break }
      patch(take.id, { status: 'Saved' })
      onSampleSaved?.(sequence)
    }
    try { await onSaved() }
    finally { saving.current = false; setIsSaving(false) }
  }
  const undoMany = async (items: Take[]) => {
    if (saving.current || !items.some(take => take.status === 'Saved')) return
    saving.current = true; setIsSaving(true)
    setSaveError('')
    try {
      for (const take of items) {
        if (take.status !== 'Saved') continue
        try { await deleteSequence(take.id) }
        catch { setSaveError(`Could not undo ${take.file.name}. The sample is still saved; please try again.`); break }
        patch(take.id, { status: 'Ready' })
      }
      await onSaved()
    } catch {
      setSaveError('Could not refresh recorded samples. Reload the saved list before continuing.')
    } finally { saving.current = false; setIsSaving(false) }
  }
  const undo = (take: Take) => undoMany([take])
  const removeTakes = (all: boolean, id?: string) => {
    if (saving.current) return
    const items = takes.map((take, index) => ({ take, index })).filter(({ take }) => take.status !== 'Saved' && (all || take.id === id))
    if (!items.length) return
    const snapshot = { items, selected }
    if (all) setRemovedAll(snapshot); else setRemovedTake(snapshot)
    const ids = new Set(items.map(({ take }) => take.id))
    for (const { take } of items) {
      processingRuns.current.delete(take.id)
      if (active.current?.id === take.id) active.current.controller.abort()
      if (take.fingerprint && fingerprints.current.get(take.fingerprint) === take.id) fingerprints.current.delete(take.fingerprint)
    }
    setTakes(previous => previous.filter(take => !ids.has(take.id)))
    if (selected && ids.has(selected)) setSelected(null)
  }
  const restoreTakes = (snapshot: RemovedTakes | null, all: boolean) => {
    if (saving.current || !snapshot) return
    const restored = [...takes]
    for (const { take, index } of snapshot.items) {
      if (restored.some(item => item.id === take.id)) continue
      const owner = take.fingerprint && fingerprints.current.get(take.fingerprint)
      const duplicate = take.fingerprint && ((owner && owner !== take.id) || sequences.some(sample => sample.videoImport?.fingerprint === take.fingerprint))
      const wasProcessing = take.status === 'Processing'
      const item: Take = duplicate ? { ...take, status: 'Duplicate', reviewed: false, message: 'This source video is already queued or saved.' }
        : wasProcessing ? { ...take, status: 'Queued', progress: 0, reviewed: false } : take
      restored.splice(Math.min(index, restored.length), 0, item)
      if (take.fingerprint && !duplicate) fingerprints.current.set(take.fingerprint, take.id)
    }
    setTakes(restored)
    setSelected(snapshot.selected && restored.some(take => take.id === snapshot.selected) ? snapshot.selected : snapshot.items[0]?.take.id ?? null)
    if (all) setRemovedAll(null); else setRemovedTake(null)
  }
  const current = takes.find(take => take.id === selected)
  const relabelable = (take: Take) => !take.training && take.status !== 'Saved' && take.status !== 'Saving'
  const relabelTargets = takes.filter(take => relabelable(take) && take.label !== replacementLabel &&
    (relabelScope === 'all' || relabelScope === 'current' && take.id === selected || relabelScope === 'checked' && take.reviewed))
  const applyLabel = () => {
    if (saving.current || boundary || !knownLabels.includes(replacementLabel) || !relabelTargets.length) return
    const ids = new Set(relabelTargets.map(take => take.id))
    setTakes(previous => previous.map(take => ids.has(take.id) && relabelable(take)
      ? { ...take, label: replacementLabel } : take))
    setRelabelMessage(`Changed ${ids.size} ${ids.size === 1 ? 'take' : 'takes'} to ${replacementLabel}. Processing, intervals and review checks kept.`)
  }
  const processed = takes.filter(take => take.result)
  const fullCount = processed.filter(take => isFullRecording(take.result!.start, take.result!.end, take.result!.duration)).length
  const needIntervalReview = processed.filter(take => hasPendingTrim(take) || !intervalReviewMatches(take.intervalReview, take.result!.start, take.result!.end, take.result!.duration)).length
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onKey = (event: KeyboardEvent) => {
      if (workspace.current?.closest('[hidden]')) return
      const action = collectorShortcut(event)
      if (!action) return
      if (action === 'help') { event.preventDefault(); setShortcutHelp(value => !value); return }
      if (shortcutHelp) return
      if (['previous', 'next'].includes(action)) {
        if (!takes.length || isSaving) return
        event.preventDefault()
        const index = takes.findIndex(take => take.id === selected)
        const next = index < 0 ? 0 : Math.min(takes.length - 1, Math.max(0, index + (action === 'next' ? 1 : -1)))
        setSelected(takes[next].id)
        // Only Q/E center rows. Change this scroll container alone so the page
        // stays in place and manual scrolling is never corrected on re-render.
        const queue = reviewQueue.current
        const row = queue?.children.item(next) as HTMLElement | null
        if (queue && row) {
          const bounds = queue.getBoundingClientRect(), item = row.getBoundingClientRect()
          const top = bounds.top + queue.clientTop
          const centered = queue.scrollTop + item.top + item.height / 2 - top - queue.clientHeight / 2
          queue.scrollTop = Math.max(0, Math.min(queue.scrollHeight - queue.clientHeight, centered))
        }
        return
      }
      if (isSaving) return
      if (action === 'remove' || action === 'remove-all') {
        event.preventDefault()
        if (action === 'remove-all') {
          if (removedAll) restoreTakes(removedAll, true)
          else removeTakes(true)
        } else if (!current && removedTake) restoreTakes(removedTake, false)
        else if (current) removeTakes(false, current.id)
      } else if (action === 'review' || action === 'review-all') {
        event.preventDefault()
        setTakes(previous => {
          const eligible = previous.filter(canReview)
          const checked = !eligible.every(take => take.reviewed)
          return previous.map(take => canReview(take) && (action === 'review-all' || take.id === selected)
            ? { ...take, reviewed: action === 'review-all' ? checked : !take.reviewed } : take)
        })
      } else if (action === 'save' || action === 'save-all') {
        event.preventDefault()
        const candidates = action === 'save-all' ? takes : current ? [current] : []
        const items = candidates.filter(take => take.reviewed && canReview(take))
        if (items.length) void save(items)
        else void undoMany(candidates.filter(take => take.status === 'Saved'))
      } else {
        const control = workspace.current?.querySelector<HTMLInputElement | HTMLButtonElement>(`[data-collector-shortcut="${action}"]`)
        if (!control || control.matches(':disabled')) return
        event.preventDefault()
        if (action === 'start' || action === 'end') {
          const details = control.closest('details')
          if (details) details.open = true
          control.focus(); (control as HTMLInputElement).select()
        } else control.click()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return <div ref={workspace} data-collector-workspace className={controls ? 'grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)] gap-4 items-start' : 'space-y-4'}>
    <div className={controls ? 'contents xl:block xl:col-start-1 xl:row-start-1 xl:space-y-4' : 'space-y-4'}>
    <Card className={controls ? 'min-w-0 order-2 xl:order-none' : ''}><div data-collector-upload className="space-y-4">
      <div><h2 className="font-semibold text-lg">Upload recordings</h2>
        <p className="text-sm text-text-2 mt-1">{boundary ? 'One selected non-sign task per file' : 'One complete sign per file'} · Up to 2 minutes</p></div>
      <div data-upload-file-container className="grid gap-4 rounded-lg border border-border bg-sky p-4">
      <label className="block min-w-0 text-sm font-semibold">Videos for {label || 'your selected label'}<input className="block w-full min-w-0 mt-3 text-sm font-normal text-text-2 file:mr-3 file:rounded-lg file:border-0 file:bg-signal file:px-4 file:py-2.5 file:font-semibold file:text-white file:cursor-pointer disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal" type="file" accept="video/*,.mp4,.mov,.webm,.m4v,.avi,.mkv" multiple disabled={!label.trim()}
        onChange={event => {
          const added: Take[] = Array.from(event.target.files ?? []).map(file => ({ id: crypto.randomUUID(), file,
            label: label.trim(), training: training ? { ...training } : undefined,
            expectedHands: training?.category === 'rest' && training.taskId.includes('_both_') ? 'both' : 'either',
            autoTrim: !boundary && autoTrim, origin: 'uploaded-file', status: 'Queued', progress: 0, reviewed: false }))
          setTakes(previous => [...previous, ...added]); if (!selected && added.length) setSelected(added[0].id)
          event.target.value = ''
        }} /></label>
      {!boundary && <div className="space-y-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" aria-label="Auto-trim and reprocess new recordings" className="w-4 h-4 accent-signal" checked={autoTrim} onChange={event => setAutoTrim(event.target.checked)} />Auto-trim videos</label>
        <p className="text-xs text-text-2">Intervals are used automatically. Auto-trim removes leading idle or selects the first usable sign between clear pauses; otherwise the full recording is kept. Preview before saving and adjust repeated signs manually.</p>
      </div>}
      {boundary && <p className="text-xs text-text-2">Full intervals are kept. Trim manually if needed.</p>}
      </div>
      <p className="text-xs text-text-2">Download originals before leaving this page.</p>
      <p className="flex items-center gap-2 text-xs text-text-2"><Keyboard size={15} aria-hidden="true" />Press <kbd className="rounded border border-border bg-sky px-1.5 py-0.5 font-sans font-semibold">?</kbd> for keyboard shortcuts</p>
    </div></Card>
    <div data-collector-preview className={controls ? 'min-w-0 order-3 xl:order-none' : ''}>
    {!current && controls && <Card><h2 className="font-semibold text-lg">Preview</h2><div className="aspect-video mt-3 rounded-lg border border-dashed border-border bg-sky flex items-center justify-center p-5 text-sm text-text-2 text-center">Add a recording to preview it here.</div></Card>}
    {current && <TakePreview key={`${current.id}-${current.result?.start}-${current.result?.end}-${current.status === 'Ready'}`} take={current} locked={isSaving}
      onConfirmInterval={() => {
        if (current.status === 'Ready' && current.result && !hasPendingTrim(current)) patch(current.id, {
          intervalReview: confirmInterval(current.result.start, current.result.end, current.result.duration), reviewed: false })
      }}
      onHandsChange={expectedHands => patch(current.id, { expectedHands, reviewed: false,
        ...(current.result ? { result: { ...current.result, quality: qualityFor(current, current.result, expectedHands) } } : {}) })}
      onDraftChange={(start, end) => patch(current.id, { draft: { start, end }, reviewed: false, intervalReview: undefined })}
      onTrim={(start, end) => patch(current.id, { interval: { start, end }, qualityWindow: undefined, contextCandidate: undefined, draft: undefined, status: 'Queued', result: undefined, reviewed: false, intervalReview: undefined })} />}
    </div>
    </div>
    <div className={controls ? 'contents xl:block xl:col-start-2 xl:row-start-1 xl:space-y-4' : ''}>
    {controls && <div data-collector-controls className="min-w-0 order-1 xl:order-none">{controls}</div>}
    <div data-collector-review className={controls ? 'min-w-0 space-y-4 order-4 xl:order-none' : 'space-y-4'}>
    {(removedTake || removedAll) && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-sky p-3 text-sm" role="status">
      <span>Removed takes can be restored until you leave or refresh.</span>
      {removedTake && <Button size="sm" disabled={isSaving} onClick={() => restoreTakes(removedTake, false)}>Undo remove (R)</Button>}
      {removedAll && <Button size="sm" disabled={isSaving} onClick={() => restoreTakes(removedAll, true)}>Undo remove all (Shift + R)</Button>}
    </div>}
    {takes.length === 0 && controls && <Card><h2 className="font-semibold text-lg">Review queue</h2><p className="text-sm text-text-2 mt-3">No recordings added yet.</p></Card>}
    {takes.length > 0 && <Card><div className="space-y-3">
      <div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-lg">Review queue <span className="text-text-2 font-normal">({takes.length})</span></h2>
        <div className="flex flex-wrap items-center justify-end gap-3"><Button size="sm" disabled={isDownloading} title="Download all original videos in one ZIP" onClick={downloadAll}>{isDownloading ? 'Preparing download...' : 'Download all'}</Button><span className="text-xs text-text-2 tabular-nums">{takes.filter(take => take.status === 'Saved').length} saved · {takes.filter(take => take.reviewed && canReview(take)).length} checked</span></div></div>
      {downloadError && <p role="alert" className="text-sm text-danger">{downloadError}</p>}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 text-xs text-text-2 tabular-nums">
          <span>{processed.length}/{takes.length} samples processed</span>
          <span>{Math.round(processed.length / takes.length * 100)}%</span>
        </div>
        <progress aria-label="Total sample processing progress" value={processed.length} max={takes.length}
          className="block h-2 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-border [&::-webkit-progress-value]:bg-signal [&::-moz-progress-bar]:bg-signal" />
      </div>
      {!boundary && knownLabels.length > 0 && <div className="space-y-3">
        <Button size="sm" disabled={isSaving || !takes.some(relabelable)} aria-expanded={relabelOpen}
          onClick={() => { setRelabelOpen(value => !value); setRelabelMessage('') }}>Change label</Button>
        {relabelOpen && <section aria-label="Correct queued sign labels" className="space-y-3 rounded-lg border border-border bg-sky p-3">
          <p className="text-sm text-text-2">Correct existing queue labels without processing the videos again. Saved samples are excluded. Existing review checks are preserved when labels change.</p>
          <LabelPicker knownLabels={knownLabels} selectedLabel={replacementLabel} labelText="New sign label"
            disabled={isSaving} onSelectLabel={value => { setReplacementLabel(value); setRelabelMessage('') }} />
          <label className="block text-sm font-semibold text-text-2">Apply to
            <select aria-label="Takes to relabel" className="mt-2 block w-full rounded-lg border border-border bg-white p-2 text-ink" disabled={isSaving}
              value={relabelScope} onChange={event => { setRelabelScope(event.target.value as typeof relabelScope); setRelabelMessage('') }}>
              <option value="checked">Checked unsaved takes</option><option value="current">Current take</option><option value="all">All unsaved takes</option>
            </select>
          </label>
          {knownLabels.includes(replacementLabel) && <p aria-label="Label change summary" className="text-sm font-semibold">
            Change {relabelTargets.length} {relabelTargets.length === 1 ? 'take' : 'takes'}{relabelTargets.length > 0 ? ` from ${Array.from(new Set(relabelTargets.map(take => take.label))).join(', ')}` : ''} to {replacementLabel}.
          </p>}
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="primary" disabled={isSaving || !knownLabels.includes(replacementLabel) || !relabelTargets.length} onClick={applyLabel}>Apply label</Button>
            <Button size="sm" onClick={() => setRelabelOpen(false)}>Close label correction</Button></div>
        </section>}
        {relabelMessage && <p role="status" className="text-sm text-success-dark">{relabelMessage}</p>}
      </div>}
      <div className="flex gap-3 items-center border border-transparent p-3 overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
      <div className="flex-1 min-w-0 flex gap-2 flex-wrap">
        <Button size="sm" variant="primary" className="disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-signal" disabled={isSaving || !takes.some(t => t.reviewed && canReview(t))} onClick={() => save(takes)}>Save checked takes</Button>
        <Button size="sm" disabled={!busy} onClick={() => {
          active.current?.controller.abort()
          setTakes(previous => previous.map(t => t.status === 'Queued' ? { ...t, status: 'Cancelled' } : t))
        }}>Cancel remaining</Button>
        <Button size="sm" variant="danger" disabled={isSaving || !takes.some(take => take.status !== 'Saved')}
          title="Remove all unsaved videos, including reviewed takes; cancel processing. Saved takes stay until you undo their save."
          onClick={() => removeTakes(true)}>Remove all from queue</Button>
      </div>
      <label className="shrink-0 flex items-center justify-center min-w-12 min-h-12 p-2 cursor-pointer"
        title="Check or uncheck all eligible previews. Checking confirms their labels, tasks and acceptable quality findings; saving is separate.">
        <input ref={allPreviewsCheckbox} type="checkbox" className="w-6 h-6 accent-signal disabled:cursor-not-allowed"
          aria-label="Check or uncheck all previews" aria-describedby="video-review-instructions"
          checked={allPreviewsChecked} disabled={isSaving || !eligibleTakes.length}
          onChange={event => { const checked = event.target.checked; setTakes(previous => previous.map(take => canReview(take) ? { ...take, reviewed: checked } : take)) }} />
      </label>
      </div>
      <p className="text-xs text-text-2" aria-label="Queue interval summary">{processed.length - fullCount} trimmed · {fullCount} full recordings · {needIntervalReview} need interval confirmation</p>
      <p id="video-review-instructions" className="text-xs text-text-2">Review each take, then check it to enable saving.</p>
      <ul ref={reviewQueue} aria-label="Review queue takes" className="space-y-2 max-h-96 overflow-auto overscroll-contain" style={{ scrollbarGutter: 'stable' }}>{takes.map(take => <li key={take.id} data-auto-trimmed={!!take.contextCandidate} className={`border rounded-lg p-3 relative ${selected === take.id ? 'border-signal bg-signal-light' : 'border-border'}`}>
        <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm truncate font-semibold pr-14" title={`${take.file.name} · ${take.label}`}>{take.file.name} · {take.label}</p>
        {take.training && <p className="text-xs text-text-2 pr-14">{take.training.taskTitle}</p>}
        <p className={`text-xs font-semibold pr-14 ${take.status === 'Saved' || take.reviewed ? 'text-success-dark' : take.status === 'Retake' || take.result?.quality.result === 'Retake' ? 'text-danger' : take.status === 'Processing' ? 'text-signal' : 'text-text-2'}`} role="status">{take.status === 'Ready'
          ? take.result?.quality.result === 'Retake' ? 'Retake' : take.reviewed ? 'Reviewed' : 'Review'
          : take.status}{take.status === 'Processing' && ` · ${take.progress}%`}</p>
        {take.result && <p className="text-xs text-text-2 pr-14">Tracking: {take.result.quality.result} · {take.result.start.toFixed(2)}–{take.result.end.toFixed(2)}s</p>}
        {take.status === 'Processing' && <progress className="w-full" aria-label={`Processing ${take.file.name}`} value={take.progress} max="100" />}
        {take.message && !take.message.startsWith('Automatically trimmed') && <p className="text-xs text-text-2 line-clamp-1" title={take.message}>{take.message}</p>}
        <div data-queue-actions className="flex flex-wrap gap-x-6 gap-y-4">
          <div className="flex gap-2">
          <Button size="sm" aria-label="Preview / review" aria-pressed={selected === take.id} onClick={() => setSelected(take.id)}>Preview</Button>
          <Button size="sm" aria-label="Download original video" title="Download original video" onClick={() => triggerDownload(take.file, take.file.name)}>Download</Button>
          </div>
          <div className="flex flex-wrap gap-2">
          {take.status === 'Ready' && <Button size="sm" variant="primary" className="disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-signal" disabled={isSaving || !take.reviewed || !canReview(take)} onClick={() => save([take])}>Save</Button>}
          {take.status === 'Saved' && <Button size="sm" onClick={() => undo(take)}>Undo save</Button>}
          {['Retake', 'Cancelled'].includes(take.status) && <Button size="sm" onClick={() => patch(take.id, { status: 'Queued', result: undefined, reviewed: false })}>Retry</Button>}
          {['Queued', 'Processing'].includes(take.status) && <Button size="sm" onClick={() => {
            if (active.current?.id === take.id) active.current.controller.abort()
            else patch(take.id, { status: 'Cancelled' })
          }}>Cancel</Button>}
          {!['Queued', 'Processing'].includes(take.status) && <Button size="sm" variant="danger" aria-label="Remove from queue" className="disabled:opacity-40 disabled:cursor-not-allowed" disabled={isSaving || take.status === 'Saved'} title={take.status === 'Saved' ? 'Undo save before removing this video from the queue' : 'Remove this video from the queue'} onClick={() => removeTakes(false, take.id)}>Remove</Button>}
          </div>
        </div>
        {hasPendingTrim(take) && <p className="text-sm text-text-2">Reprocess the changed interval before checking this take.</p>}
        {take.status === 'Ready' && take.result && !hasPendingTrim(take) && !intervalReviewMatches(take.intervalReview, take.result.start, take.result.end, take.result.duration) &&
          <p className="text-sm text-text-2">Confirm the interval in Preview / review.</p>}
        </div>
        <label className="absolute top-3 right-3 flex items-center justify-center min-w-12 min-h-12 p-2 cursor-pointer">
          <input type="checkbox" className="w-6 h-6 accent-signal disabled:cursor-not-allowed"
            aria-label={`Reviewed ${take.file.name} as ${take.label}`} aria-describedby="video-review-instructions"
            checked={take.reviewed} disabled={isSaving || !canReview(take)}
            onChange={event => { if (canReview(take)) patch(take.id, { reviewed: event.target.checked }) }} />
        </label>
      </li>)}</ul>
      {isSaving && <p role="status">Saving changes... Keep this page open.</p>}
      {saveError && <p role="alert" className="text-sm text-danger">{saveError}</p>}
    </div></Card>}
    {recordedSamples}
    <CollectorShortcutHelp open={shortcutHelp} onClose={() => setShortcutHelp(false)} />
    </div>
    </div>
  </div>
}
