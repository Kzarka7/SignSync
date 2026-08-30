import Card from '../shared/Card'

interface PhrasesUsedCardProps {
  phrases: string[]
  className?: string
}

export default function PhrasesUsedCard({ phrases, className }: PhrasesUsedCardProps) {
  return (
    <Card className={className}>
      <h3 className="text-md uppercase tracking-wide text-text-2 font-semibold mb-3">Phrases used</h3>
      {phrases.length === 0 ? (
        <p className="text-sm text-text-2">No quick phrases were used in this session.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {phrases.map((phrase) => (
            <span
              key={phrase}
              className="inline-flex items-center bg-signal-light text-[#0c447c] rounded-md px-3.5 py-1.5 text-sm font-medium"
            >
              {phrase}
            </span>
          ))}
        </div>
      )}
    </Card>
  )
}
