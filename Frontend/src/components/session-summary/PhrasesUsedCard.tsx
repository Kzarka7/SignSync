import Card from '../shared/Card'

interface PhrasesUsedCardProps {
  phrases: string[]
  className?: string
}

export default function PhrasesUsedCard({ phrases, className }: PhrasesUsedCardProps) {
  // A phrase may be selected more than once during a conversation, but the
  // summary is a recap of which quick phrases were used, not a usage log.
  // Normalize whitespace/casing for the comparison while preserving the
  // original phrase text for display.
  const uniquePhrases = Array.from(
    new Map(
      phrases.map((phrase) => [phrase.trim().toLocaleLowerCase(), phrase]),
    ).values(),
  )

  return (
    <Card className={`border-border p-5 shadow-sm ${className ?? ''}`}>
      <h2 className="text-xl font-bold text-ink">Phrases used</h2>
      <p className="mt-1 text-base text-text-2">Quick phrases used during this session.</p>
      {uniquePhrases.length === 0 ? (
        <p className="mt-4 rounded-lg bg-sky px-3 py-3 text-base text-text-2">No quick phrases were used in this session.</p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {uniquePhrases.map((phrase) => (
            <span
              key={phrase}
              className="inline-flex min-h-10 items-center rounded-lg bg-signal-light px-3.5 text-base font-semibold text-[#0c447c]"
            >
              {phrase}
            </span>
          ))}
        </div>
      )}
    </Card>
  )
}
