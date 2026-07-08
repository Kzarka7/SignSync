import { Play } from 'lucide-react'
import Card from '../shared/Card'

// Placeholder transport control for replaying the avatar's last spoken
// output. Wire the progress bar to real audio-element `timeupdate` events
// once speech playback is implemented.
export default function PlaybackPanel() {
  return (
    <Card>
      <h3 className="text-sm uppercase tracking-wide text-text-2 font-semibold mb-2.5">Playback</h3>
      <div className="flex items-center gap-2">
        <button className="w-9 h-9 rounded-lg border border-border flex items-center justify-center flex-shrink-0">
          <Play size={13} />
        </button>
        <div className="flex-1 h-1 bg-[#EAF0F6] rounded">
          <span className="block w-2/5 h-full bg-signal rounded" />
        </div>
        <span className="font-mono text-xs text-text-2">0:03</span>
      </div>
    </Card>
  )
}
