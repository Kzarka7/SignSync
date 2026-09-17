import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import Button from '../shared/Button'
import ConversationTypeSelector from '../session-setup/ConversationTypeSelector'
import { useSessionSetupStore } from '../../store/sessionSetupStore'

export default function QuickStartCard() {
  const navigate = useNavigate()
  const { conversationType, setConversationType } = useSessionSetupStore()

  return (
    <section className="relative overflow-hidden rounded-xl2 bg-gradient-to-br from-trust to-[#153A50] px-5 py-5 text-white shadow-sm sm:px-7 sm:py-6" aria-labelledby="quick-start-title">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full border border-white/10" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-28 right-20 h-48 w-48 rounded-full bg-signal/15" aria-hidden="true" />
      <div className="relative">
      <h2 id="quick-start-title" className="mb-1.5 font-display text-2xl font-bold">Start a conversation</h2>
      <p className="mb-5 max-w-xl text-base leading-relaxed text-[#D4E5F0]">
        One session, both directions. SignSync listens and watches at the same time, so no one has to switch
        modes mid-sentence.
      </p>

      <p className="mb-2 text-sm font-bold uppercase tracking-wide text-[#D4E5F0]">Choose a conversation type</p>
      <div className="mb-5">
        <ConversationTypeSelector value={conversationType} onChange={setConversationType} />
      </div>

      <Button
        variant="primary"
        className="min-h-12 !rounded-xl !border-none !bg-white !px-5 !text-base !text-trust transition-transform duration-150 ease-out hover:!bg-white/90 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.97]"
        onClick={() => navigate('/session-setup')}
      >
        Start Conversation
        <ArrowRight size={18} />
      </Button>
      </div>
    </section>
  )
}
