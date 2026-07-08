import { useDeviceStatus } from '../../hooks/useDeviceStatus'
import Card from '../shared/Card'
import StatusPill from '../shared/StatusPill'

const rows: { key: keyof NonNullable<ReturnType<typeof useDeviceStatus>>; label: string }[] = [
  { key: 'camera', label: 'Camera' },
  { key: 'hands', label: 'Hands' },
  { key: 'face', label: 'Face' },
  { key: 'lightLevel', label: 'Light' },
  { key: 'microphone', label: 'Microphone' },
  { key: 'speaker', label: 'Speaker' },
]

export default function DetectionStatusPanel() {
  const status = useDeviceStatus()

  return (
    <Card>
      <h3 className="text-[12.5px] uppercase tracking-wide text-text-2 font-semibold mb-2.5">Detection status</h3>
      <div className="flex flex-col gap-2.5">
        {status &&
          rows.map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2.5 text-[13px] font-medium">
              <StatusPill label={label} state={status[key]} />
              <span className="ml-auto text-[11.5px] text-text-2 font-normal capitalize">{status[key]}</span>
            </div>
          ))}
      </div>
    </Card>
  )
}
