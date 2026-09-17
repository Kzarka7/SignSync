import { useAsync } from '../../hooks/useAsync'
import { getPhrases } from '../../services/api/phrasesService'
import Card from '../shared/Card'
import PhraseChip from '../shared/PhraseChip'

export default function FrequentPhrases() {
  const { data: phrases } = useAsync(() => getPhrases(), [])

  return (
    <Card className="flex flex-col border-border p-4 shadow-sm sm:p-5">
      <h2 className="mb-1 text-xl font-bold text-ink">Frequently used phrases</h2>
      <p className="mb-4 text-base leading-relaxed text-text-2">Quick phrases available for your next conversation.</p>
      <div className="flex flex-wrap gap-2" aria-label="Frequently used phrases">
        {phrases?.map((p) => (
          <PhraseChip key={p.id} text={p.text} />
        ))}
      </div>
    </Card>
  )
}
