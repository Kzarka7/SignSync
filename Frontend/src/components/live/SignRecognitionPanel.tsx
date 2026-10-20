import { Circle, Square, Timer, Trash2, X } from 'lucide-react'
import type { useLiveSignCapture } from '../../hooks/useLiveSignCapture'
import type { useTranslationStream } from '../../hooks/useTranslationStream'
import Button from '../shared/Button'

export default function SignRecognitionPanel({ capture, stream }: {
  capture: ReturnType<typeof useLiveSignCapture>
  stream: ReturnType<typeof useTranslationStream>
}) {
  const prediction = stream.prediction
  const testing = stream.mode === 'p4-candidate'
  const noSign = prediction && ['REST', 'IDLE', 'IDLE_MOVEMENT'].includes(prediction.label)
  const handsBlocked = testing && prediction?.rejectionReason === 'insufficient_hand_visibility'
  const displayLabel = (label: string) => label === 'IDLE_MOVEMENT' ? 'IDLE' : label.replace(/_/g, ' ')
  const canStart = stream.connection === 'ready' && !stream.busy && capture.feed.cameraReady && capture.feed.poseDetected
  return (
    <section className="rounded-xl border border-border bg-white p-4 space-y-3" aria-label="Sign recognition">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{testing ? 'P4 candidate · Live testing' : 'Live sign recognition · v5'}</h2>
        <span className="text-sm" role="status">{stream.busy ? 'Recognizing…' : stream.connection === 'ready' ? 'Ready' : stream.connection === 'loading' ? 'Loading model…' : 'Disconnected'}</span>
      </div>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        Recognition model
        <select className="rounded-md border border-border bg-white px-3 py-2" value={stream.mode}
          disabled={capture.phase !== 'idle' || stream.busy || capture.continuous}
          onChange={event => { capture.cancel(); stream.selectMode(event.target.value as 'v5' | 'p4-candidate') }}>
          <option value="v5">Current live model (default)</option>
          <option value="p4-candidate">P4 sign / rest / idle candidate (testing)</option>
        </select>
      </label>
      <p className="text-sm text-text-2">{testing
        ? 'Start continuous testing. With both shoulders visible, lower your hands out of view to enter REST / IDLE, then bring them into view to sign. Lower them again and pause until ready for the next sign. You can also calibrate a still resting posture with hands visible. Accepted signs are added automatically with their model score.'
        : 'Start the camera, record one sign after the selected delay, then finish. Review the result before adding it.'}{!testing && ' Recording stops automatically after eight seconds.'}</p>
      <div className="flex items-center gap-3 flex-wrap">
        {testing && (
          <>
            <Button variant={capture.continuous ? 'danger-solid' : 'primary'}
              disabled={!capture.continuous && (!canStart || capture.phase !== 'idle')}
              onClick={capture.continuous ? capture.stopContinuous : capture.startContinuous}>
              {capture.continuous ? 'Stop continuous testing' : 'Start continuous testing'}
            </Button>
            {capture.continuous && <span className="text-sm" role="status">{
              capture.boundaryPhase === 'calibrating' ? 'Calibrating — stay relaxed and still'
                : capture.boundaryPhase === 'no-sign' ? 'REST / IDLE — no hands detected; ready for next sign'
                : capture.boundaryPhase === 'ready' ? 'Ready for next sign'
                : capture.boundaryPhase === 'recording' ? 'Capturing — finish and return to rest'
                : capture.boundaryPhase === 'rearming' ? 'Rest briefly before the next sign'
                : 'Movement detected'
            }{capture.queued > 0 ? ` · ${capture.queued} waiting for recognition` : ''}</span>}
          </>
        )}
        {!capture.continuous && (capture.phase === 'countdown' ? (
          <Button data-sign-capture-control aria-keyshortcuts="Escape" variant="default" onClick={capture.cancel}>
            <X size={14} /> Cancel
          </Button>
        ) : capture.phase === 'idle' ? (
          <>
            <Button data-sign-capture-control aria-keyshortcuts="Space" variant="primary" disabled={!canStart} onClick={capture.start}>
              <Circle size={14} className="fill-current" /> Start recording
            </Button>
            <span className="text-xs text-text-2">
              <kbd className="px-1 py-0.5 rounded border border-border bg-sky font-mono">Space</kbd> start/stop ·{' '}
              <kbd className="px-1 py-0.5 rounded border border-border bg-sky font-mono">Esc</kbd> discard
            </span>
            <div className="flex items-center gap-1.5 text-sm text-text-2">
              <Timer size={14} />
              <span id="live-recording-delay">Delay:</span>
              <div className="flex gap-1" role="group" aria-labelledby="live-recording-delay">
                {[1, 3, 5].map(seconds => (
                  <button
                    key={seconds}
                    type="button"
                    aria-pressed={capture.countdownSeconds === seconds}
                    onClick={() => capture.setCountdownSeconds(seconds)}
                    className={`px-2 py-0.5 rounded-md text-xs font-medium border transition-colors ${
                      capture.countdownSeconds === seconds
                        ? 'bg-signal text-white border-signal'
                        : 'bg-white text-text-2 border-border hover:border-signal'
                    }`}
                  >
                    {seconds}s
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <Button data-sign-capture-control aria-keyshortcuts="Space" variant="danger-solid" onClick={capture.finish}>
              <Square size={14} className="fill-current" /> Stop &amp; recognize
            </Button>
            <Button data-sign-capture-control aria-keyshortcuts="Escape" variant="default" onClick={capture.cancel}>
              <Trash2 size={14} /> Discard
            </Button>
            <span className="flex items-center gap-1.5 text-sm font-medium text-danger" role="status">
              <span className="w-2 h-2 rounded-full bg-danger" />
              Recording · {capture.count} frames
            </span>
          </>
        ))}
        {stream.connection === 'disconnected' && <Button variant="primary" onClick={stream.reconnect}>Reconnect</Button>}
      </div>
      {capture.feed.cameraReady && !capture.feed.poseDetected && <p className="text-sm">Keep both shoulders in view to enable recognition.</p>}
      {(stream.error || capture.error) && <p role="alert" className="text-sm text-danger">{stream.error || capture.error}</p>}
      {prediction && capture.phase === 'idle' && (
        <div className="space-y-2" aria-live="polite">
          {capture.continuous && <p className="text-xs text-text-2">Last completed capture</p>}
          <p className="font-semibold">{handsBlocked ? 'Sign blocked — insufficient hand visibility' : `${displayLabel(prediction.label)} · ${(prediction.score * 100).toFixed(1)}% model score`}</p>
          <p className="text-xs text-text-2">{prediction.inferenceMs} ms inference · {prediction.frameCount} frames · nine-model ensemble</p>
          <p className="text-xs text-text-2">Top predictions: {prediction.top3.map(p => `${displayLabel(p.label)} ${(p.score * 100).toFixed(1)}%`).join(' · ')}</p>
          {testing ? <p className="text-sm">{handsBlocked ? 'Keep at least one hand visible for at least half of the recording to accept a sign. REST and IDLE can still be recognized with hands out of view.' : noSign ? 'No sign detected — ' + displayLabel(prediction.label) : prediction.accepted ? 'Added to transcription automatically.' : 'Uncertain result. Try another capture.'}</p>
            : prediction.accepted ? <Button variant='primary' onClick={stream.addPrediction}>Add sign to conversation</Button>
            : <p className="text-sm">Uncertain result. Please record the sign again.</p>}
        </div>
      )}
      <p className="text-xs text-text-2">{testing ? 'Experimental automatic boundaries: rest between signs; back-to-back signing without rest is not supported. Held final postures are kept in one capture (up to eight seconds). Model scores are not measured accuracy. REST, IDLE, uncertain and blocked results are not transcribed.' : 'Development test for 20 isolated signs. Model scores are not measured accuracy. Continuous sentence recognition and unseen-signer performance are still being evaluated.'}</p>
    </section>
  )
}
