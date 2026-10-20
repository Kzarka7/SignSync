import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslationStream } from '../hooks/useTranslationStream'
import { useContinuousLiveRecognition } from '../hooks/useContinuousLiveRecognition'
import Button from '../components/shared/Button'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { useAvatarRenderer } from '../hooks/useAvatarRenderer'
import { useSessionSetupStore } from '../store/sessionSetupStore'
import { useSessionStore } from '../store/sessionStore'
import { saveSession } from '../services/sessionHistoryStorage'
import { SavedSession } from '../types/session'
import LiveTopbar from '../components/live/LiveTopbar'
import CameraPanel from '../components/live/CameraPanel'
import ConversationTimeline from '../components/live/ConversationTimeline'
import QuickPhraseRow from '../components/live/QuickPhraseRow'
import AvatarPanel from '../components/live/AvatarPanel'
import DetectionStatusPanel from '../components/live/DetectionStatusPanel'
import PlaybackPanel from '../components/live/PlaybackPanel'
import SpeechSubtitle from '../components/live/SpeechSubtitle'

export default function LiveConversationPage() {
  const navigate = useNavigate()
  const { isReadyToBegin, conversationType, sessionName, reset: resetSessionSetup } = useSessionSetupStore()
  
  useEffect(() => {
    if (!isReadyToBegin) {
      navigate('/setup', { replace: true })
    }
  }, [isReadyToBegin, navigate])

  const stream = useTranslationStream(true)
  const { messages, endSession, exportSession, submitSpeech, submitPhrase } = stream
  const lastMessage = messages[messages.length - 1]
  const lastSpokenOrPhraseMessage = [...messages].reverse().find((m) => m.source === 'speech' || m.source === 'phrase')
  const capture = useContinuousLiveRecognition(stream.appendConfirmedSign)
  const { feed } = capture
  const speech = useSpeechRecognition()
  const avatar = useAvatarRenderer()
  function handleEnd() {
    capture.stop()
    endSession()

    const { sessionId, startedAt, elapsedSeconds } = useSessionStore.getState()
    const now = Date.now()
    const startedAtMs = startedAt ?? now - elapsedSeconds * 1000
    const confidences = messages
      .map((m) => m.confidence)
      .filter((c): c is number => typeof c === 'number')
    const avgConfidence =
      confidences.length > 0
        ? Math.round(confidences.reduce((sum, c) => sum + c, 0) / confidences.length)
        : null

    const completedSession: SavedSession = {
      id: sessionId ?? `session-${now}`,
      sessionName: sessionName.trim() || 'Untitled session',
      conversationType,
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: new Date(now).toISOString(),
      durationSeconds: elapsedSeconds,
      messages,
      phrasesUsed: messages.filter((m) => m.source === 'phrase').map((m) => m.text),
      avgConfidence,
    }
    saveSession(completedSession)

    resetSessionSetup() 
    navigate(`/summary/${completedSession.id}`)
  }

  if (!isReadyToBegin) return null

  return (
    <div>
      <LiveTopbar onEnd={handleEnd} onExport={exportSession} />

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[5fr_3fr] gap-4 items-start">
          <div className="flex flex-col gap-4">
            <CameraPanel
              feed={feed}
              countdown={capture.countdown}
              isListening={speech.isListening}
              isInterpreting={avatar.isRendering}
              isPlaying={avatar.isPlaying}
            />
            <section className="rounded-xl border border-border bg-white p-4 space-y-3" aria-label="Sign recognition">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">Live sign recognition <span className="text-xs text-text-2">· P4 experimental</span></h2>
                <span className="text-sm" role="status">{capture.status}</span>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
              <Button data-sign-capture-control aria-keyshortcuts="Space Escape" variant={capture.running || capture.loading || capture.countdown!==null ? 'danger-solid' : 'primary'}
                disabled={!capture.running && !capture.loading && capture.countdown===null && (!feed.cameraReady || !feed.poseDetected)}
                onClick={capture.running || capture.loading || capture.countdown!==null ? capture.stop : capture.start}>
                {capture.loading || capture.countdown!==null ? 'Cancel' : capture.running ? 'Stop recognition' : 'Start recognition'}
              </Button>
              <span className="text-xs text-text-2"><kbd className="px-1 py-0.5 rounded border border-border bg-sky font-mono">Space</kbd> start/stop · <kbd className="px-1 py-0.5 rounded border border-border bg-sky font-mono">Esc</kbd> cancel</span>
              <div className="flex items-center gap-1.5 text-sm text-text-2" role="group" aria-label="Recognition start delay">
                <span>Delay:</span>
                {[1,3,5].map(seconds=><button key={seconds} type="button" aria-pressed={capture.countdownSeconds===seconds}
                  disabled={capture.running || capture.loading || capture.countdown!==null} onClick={()=>capture.setCountdownSeconds(capture.countdownSeconds===seconds ? 0 : seconds)}
                  className={`px-2 py-0.5 rounded-md text-xs font-medium border disabled:opacity-50 ${capture.countdownSeconds===seconds ? 'bg-signal text-white border-signal' : 'bg-white text-text-2 border-border hover:border-signal'}`}>{seconds}s</button>)}
              </div>
              </div>
              {feed.cameraReady && !feed.poseDetected && <p className="text-sm">Keep both shoulders in view.</p>}
              {capture.error && <p role="alert" className="text-sm text-danger">{capture.error}</p>}
            </section>
            <SpeechSubtitle message={lastMessage ?? null} />
            <QuickPhraseRow onSelectPhrase={submitPhrase} />
          </div>

          <div className="flex flex-col gap-4">
            <AvatarPanel
              onSubmitSpeech={submitSpeech}
              speech={speech}
              avatar={avatar}
              lastMessage={lastSpokenOrPhraseMessage}
            />
            <PlaybackPanel />
            <DetectionStatusPanel feed={feed} />
          </div>
        </div>

        <div className="col-span-2">
          <ConversationTimeline messages={messages} />
        </div>
      </div>
    </div>
  )
}
