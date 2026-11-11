import SecondsInput from '../components/shared/SecondsInput'
import { useEffect, useRef, useState } from 'react'
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
  const { messages, endSession, exportSession, submitSpeech, submitPhrase, submitFingerspelling } = stream
  const [recognitionMode, setRecognitionMode] = useState<'signs' | 'fingerspelling'>('signs')
  const [draft, setDraft] = useState('')
  const currentDraft = useRef<{ text: string; letterScores: number[] }>({ text: '', letterScores: [] })
  function updateDraft(text: string, letterScores = currentDraft.current.letterScores) {
    currentDraft.current = { text, letterScores: text.trim() ? letterScores : [] }
    setDraft(text)
  }
  function sendDraft() {
    const { text, letterScores } = currentDraft.current
    if (submitFingerspelling(text, letterScores)) updateDraft('')
  }
  const fingerspelling = recognitionMode === 'fingerspelling'
  const lastMessage = messages[messages.length - 1]
  const lastSpokenOrPhraseMessage = [...messages].reverse().find((m) => m.source === 'speech' || m.source === 'phrase')
  const capture = useContinuousLiveRecognition(entry => {
    if (!fingerspelling) stream.appendConfirmedSign(entry)
    else if (/^[A-Z]$/.test(entry.label)) {
      const { text, letterScores } = currentDraft.current
      updateDraft(text + entry.label, [...letterScores, entry.score])
    }
  }, {
    mode: recognitionMode,
    onWordBoundary: sendDraft,
  })
  const { feed } = capture
  const captureActive = capture.running || capture.loading || capture.countdown !== null
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
              topRightContent={fingerspelling && draft.length > 0 && <form className="relative max-w-full rounded-lg bg-black/80 text-base font-semibold" onSubmit={event => {
                event.preventDefault()
                sendDraft()
              }}>
                <span aria-hidden="true" className="invisible block min-h-10 overflow-hidden whitespace-pre px-2.5">{draft}</span>
                <input aria-label="Fingerspelling draft" value={draft} onChange={event => updateDraft(event.currentTarget.value)}
                  autoComplete="off" spellCheck={false}
                  className="absolute inset-0 w-full rounded-lg bg-transparent px-2.5 text-right text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal" />
              </form>}
            />
            <section className="rounded-xl border border-border bg-white p-4 space-y-3" aria-label="Sign recognition">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">Live sign recognition
                  {!fingerspelling && <span className="text-xs text-text-2"> · 43 Similar Signs</span>}
                </h2>
                <span className="text-sm" role="status">{capture.status}</span>
              </div>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Recognition mode">
                {(['signs', 'fingerspelling'] as const).map(mode => <Button key={mode} type="button" size="sm"
                  aria-pressed={recognitionMode === mode}
                  variant={recognitionMode === mode ? 'primary-ghost' : 'default'}
                  onClick={() => {
                    if (recognitionMode === mode) return
                    if (captureActive) capture.stop()
                    setRecognitionMode(mode)
                  }}>
                  {mode === 'signs' ? 'Signs' : 'Fingerspelling'}
                </Button>)}
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
                <SecondsInput label="Recognition start delay (seconds)" value={capture.countdownSeconds}
                  disabled={capture.running || capture.loading || capture.countdown !== null} onChange={capture.setCountdownSeconds} />
                <span className="text-xs">seconds (0 = none)</span>
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
