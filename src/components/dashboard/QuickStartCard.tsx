import { useNavigate } from 'react-router-dom'
import { Play } from 'lucide-react'
import Button from '../shared/Button'

export default function QuickStartCard() {
  const navigate = useNavigate()
  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-trust to-[#153A50] rounded-xl2 px-7 py-6 text-white flex items-center justify-between">
      <div>
        <h2 className="text-xl font-display font-bold mb-1.5">Start a conversation</h2>
        <p className="text-sm text-[#B9D3E4] max-w-xs leading-relaxed">
          One session, both directions. Daloy listens and watches at the same time, so no one has to
          switch modes mid-sentence.
        </p>
        <Button variant="primary" className="mt-4 !bg-white hover:!bg-white/90 !text-trust !border-none" onClick={() => navigate('/live')}>
          <Play size={15} />
          Start conversation
        </Button>
      </div>
    </div>
  )
}
