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
    <Card className={className}>
      <div className="text-sm text-text-2 mb-1">Confidence</div>
      {avgConfidence !== null ? (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-ink">{avgConfidence}%</span>
            <Badge tone={avgConfidence >= 90 ? 'ok' : 'med'}>Overall</Badge>
          </div>
          {Object.keys(categoryAverages).length > 0 && (
            <div className="flex flex-col gap-1.5 mt-3 pt-3 border-t border-border">
              {(Object.entries(categoryAverages) as [ConfidenceCategory, number][]).map(
                ([category, value]) => (
                  <div key={category} className="flex justify-between text-sm text-text-2">
                    <span>{CONFIDENCE_CATEGORY_LABELS[category]}</span>
                    <span className="font-semibold text-ink">{value}%</span>
                  </div>
                ),
              )}
            </div>
          )}
        </>
      ) : (
        <div className="text-sm text-text-2">Not available</div>
      )}
    </Card>
  )
}
