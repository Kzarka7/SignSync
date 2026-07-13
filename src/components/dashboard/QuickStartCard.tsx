import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import Button from '../shared/Button'
import ConversationTypeSelector from '../session-setup/ConversationTypeSelector'
import { useSessionSetupStore } from '../../store/sessionSetupStore'

export default function QuickStartCard() {
  const navigate = useNavigate()
  const { conversationType, setConversationType } = useSessionSetupStore()

  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-trust to-[#153A50] rounded-xl2 px-7 py-6 text-white">
      <h2 className="text-xl font-display font-bold mb-1.5">Start a conversation</h2>
      <p className="text-sm text-[#B9D3E4] max-w-md leading-relaxed mb-4">
        One session, both directions. Daloy listens and watches at the same time, so no one has to switch
        modes mid-sentence.
      </p>

      <p className="text-xs font-semibold text-[#B9D3E4] uppercase tracking-wide mb-2">Conversation type</p>
      <div className="mb-4">
        <ConversationTypeSelector value={conversationType} onChange={setConversationType} />
      </div>

      <Button
        variant="primary"
        className="!bg-white hover:!bg-white/90 !text-trust !border-none"
        onClick={() => navigate('/session-setup')}
      >
        Start Conversation
        <ArrowRight size={15} />
      </Button>
    </div>
  )
}
