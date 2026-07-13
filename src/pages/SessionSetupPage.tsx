import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import Card from '../components/shared/Card'
import Button from '../components/shared/Button'
import ConversationTypeSelector from '../components/session-setup/ConversationTypeSelector'
import DeviceReadinessCard from '../components/session-setup/DeviceReadinessCard'
import { useDeviceReadiness } from '../hooks/useDeviceReadiness'
import { useSessionSetupStore } from '../store/sessionSetupStore'
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

  // Captured once, when the page loads - not live-updating, since this
  // represents "when this session was set up", not a running clock.
  const [timestamp] = useState(() => new Date())

  const devicesBlocked = readiness.camera === 'error' || readiness.microphone === 'error'
  const devicesChecking = readiness.camera === 'checking' || readiness.microphone === 'checking'

  function handleBegin() {
    beginConversation()
    navigate('/live')
  }

  return (
    <div>
      <PageHeader title="Session setup" description="Confirm your devices and conversation details before starting." />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4">
          <Card>
            <h3 className="text-sm uppercase tracking-wide text-text-2 font-semibold mb-3">Conversation type</h3>
            <ConversationTypeSelector value={conversationType} onChange={setConversationType} />
          </Card>

          <Card>
            <h3 className="text-sm uppercase tracking-wide text-text-2 font-semibold mb-3">Session information</h3>
            <div className="flex flex-col gap-3.5">
              <div>
                <label className="text-xs font-medium text-text-2 block mb-1.5">Session name (optional)</label>
                <input
                  type="text"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  placeholder="e.g. Hospital reception, 2nd floor"
                  className="w-full text-sm border border-border rounded-lg px-3 py-2.5"
                />
              </div>
              <div className="flex justify-between text-xs text-text-2 pt-3 border-t border-border">
                <span>Timestamp</span>
                <span className="font-mono">
                  {timestamp.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </div>
              <div className="flex justify-between text-xs text-text-2">
                <span>Conversation category</span>
                <span className="font-semibold text-ink">{CONVERSATION_TYPE_LABELS[conversationType]}</span>
              </div>
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <DeviceReadinessCard readiness={readiness} />

          <Card>
            <p className="text-xs text-text-2 leading-relaxed mb-3.5">
              {devicesBlocked
                ? 'Camera and microphone access are required to begin a conversation. Please allow access and try again.'
                : 'Once you begin, the camera starts watching for signs automatically. Speech recognition only starts when you press the microphone during the conversation.'}
            </p>
            <Button
              variant="primary"
              className="w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={devicesBlocked || devicesChecking}
              onClick={handleBegin}
            >
              Begin conversation
              <ArrowRight size={15} />
            </Button>
            {devicesBlocked && (
              <button
                onClick={readiness.recheckDevices}
                className="text-xs text-signal font-medium mt-2.5 w-full text-center hover:underline"
              >
                Recheck devices
              </button>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
