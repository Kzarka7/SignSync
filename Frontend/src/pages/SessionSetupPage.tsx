import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CalendarClock, CheckCircle2, Info, Tag } from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import Card from '../components/shared/Card'
import Button from '../components/shared/Button'
import ConversationTypeSelector from '../components/session-setup/ConversationTypeSelector'
import DeviceReadinessCard from '../components/session-setup/DeviceReadinessCard'
import { useDeviceReadiness } from '../hooks/useDeviceReadiness'
import { useSessionSetupStore } from '../store/sessionSetupStore'
import { useSessionStore } from '../store/sessionStore'
import { CONVERSATION_TYPE_LABELS } from '../types/conversation'

// Sits between Dashboard and Live Conversation. Its job: confirm devices
// actually work and capture conversation context BEFORE any camera
// detection or speech recognition starts - that only begins once the
// user presses "Begin Conversation" here, on the Live Conversation page.
export default function SessionSetupPage() {
  const navigate = useNavigate()
  const readiness = useDeviceReadiness()
  const { conversationType, setConversationType, sessionName, setSessionName, beginConversation } =
    useSessionSetupStore()
  const startSession = useSessionStore((s) => s.startSession)

  // Captured once, when the page loads - not live-updating, since this
  // represents "when this session was set up", not a running clock.
  const [timestamp] = useState(() => new Date())

  const devicesBlocked = readiness.camera === 'error' || readiness.microphone === 'error'
  const devicesChecking = readiness.camera === 'checking' || readiness.microphone === 'checking'

  function handleBegin() {
    // Stamps a fresh session id + start time for this conversation, so
    // the elapsed timer and the eventual History record both start
    // counting from "Begin conversation", not from whenever the app
    // happened to load.
    startSession()
    beginConversation()
    navigate('/live')
  }

  return (
    <main className="mx-auto max-w-[1440px] px-3 py-4 sm:px-5 sm:py-6 lg:px-7">
      <PageHeader title="Session setup" description="Confirm your devices and conversation details before starting." />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)] xl:gap-6">
        <section className="flex min-w-0 flex-col gap-5" aria-label="Conversation details">
          <Card className="border-border p-4 shadow-sm sm:p-5">
            <div className="mb-4">
              <div className="flex justify-between">
                <h2 className="text-xl font-bold text-ink">Choose a conversation type</h2>
                <p className="text-base text-sm leading-relaxed text-text-3">select one category</p>
              </div>
              <p className="mt-1 text-base leading-relaxed text-text-2">This helps prepare the right phrases and context for your conversation.</p>
            </div>
            <ConversationTypeSelector value={conversationType} onChange={setConversationType} />
          </Card>

          <Card className="border-border p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-signal-light text-signal" aria-hidden="true"><Info size={20} /></span>
              <div>
                <h2 className="text-xl font-bold text-ink">Session details</h2>
                <p className="text-base text-text-2">Optional information for finding this session later.</p>
              </div>
            </div>
            <div className="flex flex-col gap-4 border-t border-border pt-4">
              <div>
                <label htmlFor="session-name" className="mb-1.5 block text-base font-bold text-ink">Session name <span className="font-normal text-text-3">(optional)</span></label>
                <input
                  id="session-name"
                  type="text"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  placeholder="e.g. Hospital reception, 2nd floor"
                  className="min-h-12 w-full rounded-lg border border-border bg-white px-3 text-base font-medium text-ink placeholder:text-text-3 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-signal"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col justify-center rounded-lg bg-sky px-3 py-3">
                  <span className="flex items-center gap-1.5 text-sm font-bold text-text-2"><CalendarClock size={16} aria-hidden="true" /> Started</span>
                  <span className="mt-1 block text-base font-bold text-ink">
                    {timestamp.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                </div>
                <div className="flex flex-col justify-center rounded-lg bg-sky px-3 py-3">
                  <span className="flex items-center gap-1.5 text-sm font-bold text-text-2"><Tag size={16} aria-hidden="true" /> Started</span>
                  <span className="mt-1 block text-base font-bold text-ink">{CONVERSATION_TYPE_LABELS[conversationType]}</span>
                </div>
              </div>
            </div>
          </Card>
        </section>

        <aside className="flex min-w-0 flex-col gap-5" aria-label="Device readiness and start">
          <DeviceReadinessCard readiness={readiness} />

          <Card className="border-border p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex items-start gap-3">
              <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${devicesBlocked ? 'bg-danger-light text-danger' : devicesChecking ? 'bg-amber-light text-amber-dark' : 'bg-success-light text-success-dark'}`} aria-hidden="true"><CheckCircle2 size={21} /></span>
              <div>
                <h2 className="text-xl font-bold text-ink">Ready to begin?</h2>
                <p className="mt-1 text-base leading-relaxed text-text-2">
              {devicesBlocked
                ? 'Camera and microphone access are required to begin a conversation. Please allow access and try again.'
                : devicesChecking
                ? 'We’re checking your camera and microphone. This only takes a moment.'
                : 'Once you begin, the camera starts watching for signs automatically. Speech recognition starts when you tap the microphone.'}
                </p>
              </div>
            </div>
            <Button
              variant="primary"
              className="min-h-13 w-full justify-center text-lg focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-signal active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={devicesBlocked || devicesChecking}
              onClick={handleBegin}
            >
              Begin conversation
              <ArrowRight size={20} />
            </Button>
            {devicesBlocked && (
              <button
                onClick={readiness.recheckDevices}
                className="mt-3 min-h-11 w-full rounded-lg text-base font-bold text-signal hover:bg-signal-light focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-signal active:scale-[0.97]"
              >
                Recheck devices
              </button>
            )}
          </Card>
        </aside>
      </div>
    </main>
  )
}
