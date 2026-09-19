import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import Card from '../components/shared/Card'
import PageHeader from '../components/layout/PageHeader'
import ConversationTypeSelector from '../components/session-setup/ConversationTypeSelector'
import DeviceReadinessCard from '../components/session-setup/DeviceReadinessCard'
import SessionDetails from '../components/session-setup/SessionDetails'
import SessionReadyCard from '../components/session-setup/SessionReadyCard'
import { useDeviceReadiness } from '../hooks/useDeviceReadiness'
import { useSessionSetupStore } from '../store/sessionSetupStore'
import { useSessionStore } from '../store/sessionStore'

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
      <PageHeader 
        title="Session setup" 
        description="Confirm your devices and conversation details before starting."
        actions={
          <div className="flex items-center gap-2">
            <span className="bg-signal-light text-signal font-bold rounded-full px-4 py-1">Step 1: Session Setup</span>
            <ChevronRight className="text-text-3"/>
            <span className="text-text-3 font-bold">Step 2: Live Conversation</span>
          </div>
        }
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)] xl:gap-4">
        <section className="flex min-w-0 flex-col gap-4" aria-label="Conversation details">
          <Card className="border-border p-4 shadow-sm sm:p-5">
            <div className="mb-4 grid grid-cols-[1fr_20fr] items-center border-b border-border pb-4 gap-3">
              <span className="flex h-10 w-10 items-center justify-center font-bold text-xl rounded-full bg-signal-light text-signal">1</span>
              <div>
                <div className="flex justify-between">
                  <h2 className="text-xl font-bold text-ink">Choose a conversation type</h2>
                  <p className="text-base text-sm leading-relaxed text-text-3">select one category</p>
                </div>
                <p className="text-base text-text-2">This helps prepare the right phrases and context for your conversation.</p>
              </div>
            </div>
            <ConversationTypeSelector value={conversationType} onChange={setConversationType} />
          </Card>
          <SessionDetails
            sessionName={sessionName}
            onSessionNameChange={setSessionName}
            timestamp={timestamp}
            conversationType={conversationType}
          />
        </section>

        <aside className="flex min-w-0 flex-col gap-4" aria-label="Device readiness and start">
          <DeviceReadinessCard readiness={readiness} />
          <SessionReadyCard
            devicesBlocked={devicesBlocked}
            devicesChecking={devicesChecking}
            onBegin={handleBegin}
            onRecheckDevices={readiness.recheckDevices}
          />
        </aside>
      </div>
    </main>
  )
}