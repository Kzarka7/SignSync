import { Target } from 'lucide-react'
import Card from '../shared/Card'
import Badge from '../shared/Badge'
import { ConfidenceBreakdown, ConfidenceCategory } from '../../types/message'
import { CONFIDENCE_CATEGORY_LABELS } from '../../utils/confidence'

interface ConfidenceCardProps {
  avgConfidence: number | null
  categoryAverages: ConfidenceBreakdown
  className?: string
}

// Overall confidence is the primary/highlighted metric here - a large
// figure, not just a small badge like the History list's row-level
// confidence - with the per-category breakdown (Sign recognition/Speech
// recognition/Translation) underneath.
export default function ConfidenceCard({ avgConfidence, categoryAverages, className }: ConfidenceCardProps) {
  return (
    <Card className={`border-border p-5 shadow-sm ${className ?? ''}`}>
      <div className='flex items-center gap-3'>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-success-light text-success-dark" aria-hidden="true"><Target size={20} /></span>
        <div className="text-sm font-bold uppercase tracking-wide text-text-2">Confidence</div>
      </div>
      {avgConfidence !== null ? (
        <>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold tracking-tight text-ink">{avgConfidence}</span>
            <span className="text-xl font-bold text-text-2 mr-2">%</span>
            <Badge tone={avgConfidence >= 90 ? 'ok' : 'med'}>Overall</Badge>
          </div>
          {Object.keys(categoryAverages).length > 0 && (
            <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
              {(Object.entries(categoryAverages) as [ConfidenceCategory, number][]).map(
                ([category, value]) => (
                  <div key={category} className="flex justify-between rounded-lg bg-sky px-2.5 py-2 text-sm text-text-2">
                    <span>{CONFIDENCE_CATEGORY_LABELS[category]}</span>
                    <span className="font-semibold text-ink">{value}%</span>
                  </div>
                ),
              )}
            </div>
          )}
        </>
      ) : (
        <div className="mt-2 text-base text-text-2">No confidence score was recorded.</div>
      )}
    </Card>
  )
}
