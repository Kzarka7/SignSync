import { Circle, Square, Timer, Trash2, X } from 'lucide-react'
import type { useLiveSignCapture } from '../../hooks/useLiveSignCapture'
import type { useTranslationStream } from '../../hooks/useTranslationStream'
import Button from '../shared/Button'

export default function SignRecognitionPanel({ capture, stream }: {
  capture: ReturnType<typeof useLiveSignCapture>
  stream: ReturnType<typeof useTranslationStream>
}) {
  const prediction = stream.prediction
  const canStart = stream.connection === 'ready' && !stream.busy && capture.feed.cameraReady && capture.feed.poseDetected
  return (
    <section className="rounded-xl border border-border bg-white p-4 space-y-3" aria-label="Sign recognition">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Live sign recognition Â· v5</h2>
        <span className="text-sm" role="status">{stream.busy ? 'Recognizingâ€¦' : stream.connection === 'ready' ? 'Ready' : stream.connection === 'loading' ? 'Loading modelâ€¦' : 'Disconnected'}</span>
      </div>
      <p className="text-sm text-text-2">Start the camera, record one sign after the selected delay, then finish. Recording stops automatically after eight seconds. Review the result before adding it.</p>
      <div className="flex items-center gap-3 flex-wrap">
        {capture.phase === 'countdown' ? (
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
        )}
        {stream.connection === 'disconnected' && <Button variant="primary" onClick={stream.reconnect}>Reconnect</Button>}
      </div>
      {capture.feed.cameraReady && !capture.feed.poseDetected && <p className="text-sm">Keep both shoulders in view to enable recognition.</p>}
      {(stream.error || capture.error) && <p role="alert" className="text-sm text-danger">{stream.error || capture.error}</p>}
      {prediction && capture.phase === 'idle' && (
        <div className="space-y-2" aria-live="polite">
          <p className="font-semibold">{prediction.label.replace(/_/g, ' ')} Â· {(prediction.score * 100).toFixed(1)}% model score</p>
          <p className="text-xs text-text-2">{prediction.inferenceMs} ms inference Â· {prediction.frameCount} frames Â· nine-model ensemble</p>
          <p className="text-xs text-text-2">Top predictions: {prediction.top3.map(p => `${p.label.replace(/_/g, ' ')} ${(p.score * 100).toFixed(1)}%`).join(' Â· ')}</p>
          {prediction.accepted ? <Button variant='primary' onClick={stream.addPrediction}>Add sign to conversation</Button>
            : <p className="text-sm">Uncertain result. Please record the sign again.</p>}
        </div>
      )}
      <p className="text-xs text-text-2">Development test for 20 isolated signs. Model scores are not measured accuracy. Continuous sentence recognition and unseen-signer performance are still being evaluated.</p>
    </section>
  )
}
