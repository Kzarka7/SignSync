import { useAsync } from '../../hooks/useAsync'
import { getPhrases } from '../../services/api/phrasesService'
import Card from '../shared/Card'
import PhraseChip from '../shared/PhraseChip'

export default function FrequentPhrases() {
  const { data: phrases } = useAsync(() => getPhrases(), [])

  return (
    <Card className="flex flex-col">
      <span className="text-md font-semibold text-text-2 uppercase tracking-wide mb-3 break-words">Frequently used phrases</span>
      <div className="flex flex-wrap gap-2.5">
        {phrases?.map((p) => (
          <PhraseChip key={p.id} text={p.text} />
        ))}
      </div>
    </Card>
  )
}
