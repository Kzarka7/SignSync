import type { useLiveSignCapture } from '../../hooks/useLiveSignCapture'
import type { useTranslationStream } from '../../hooks/useTranslationStream'

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
      <p className="text-sm text-text-2">Start the camera, record one sign after the two-second preparation, then finish. Recording stops automatically after eight seconds. Review the result before adding it.</p>
      <div className="flex flex-wrap items-center gap-2">
        {capture.phase === 'idle' ? (
          <button className="rounded-lg bg-trust px-4 py-2 text-white disabled:opacity-40" disabled={!canStart} onClick={capture.start}>Record sign</button>
        ) : (
          <>
            <button className="rounded-lg bg-trust px-4 py-2 text-white disabled:opacity-40" disabled={capture.phase !== 'recording'} onClick={capture.finish}>{capture.phase === 'countdown' ? 'Get readyâ€¦' : 'Finish sign'}</button>
            <button className="rounded-lg border px-3 py-2" onClick={capture.cancel}>Cancel</button>
            <span className="text-sm" role="status">{capture.phase === 'recording' ? `Recording Â· ${capture.count} frames` : 'Recording begins in two seconds'}</span>
          </>
        )}
        {stream.connection === 'disconnected' && <button className="rounded-lg border px-3 py-2" onClick={stream.reconnect}>Reconnect</button>}
      </div>
      {capture.feed.cameraReady && !capture.feed.poseDetected && <p className="text-sm">Keep both shoulders in view to enable recognition.</p>}
      {(stream.error || capture.error) && <p role="alert" className="text-sm text-danger">{stream.error || capture.error}</p>}
      {prediction && capture.phase === 'idle' && (
        <div className="space-y-2" aria-live="polite">
          <p className="font-semibold">{prediction.label.replace(/_/g, ' ')} Â· {(prediction.score * 100).toFixed(1)}% model score</p>
          <p className="text-xs text-text-2">{prediction.inferenceMs} ms inference Â· {prediction.frameCount} frames Â· nine-model ensemble</p>
          <p className="text-xs text-text-2">Top predictions: {prediction.top3.map(p => `${p.label.replace(/_/g, ' ')} ${(p.score * 100).toFixed(1)}%`).join(' Â· ')}</p>
          {prediction.accepted ? <button className="rounded-lg bg-trust px-4 py-2 text-white" onClick={stream.addPrediction}>Add sign to conversation</button>
            : <p className="text-sm">Uncertain result. Please record the sign again.</p>}
        </div>
      )}
      <p className="text-xs text-text-2">Development test for 20 isolated signs. Model scores are not measured accuracy. Continuous sentence recognition and unseen-signer performance are still being evaluated.</p>
    </section>
  )
}
