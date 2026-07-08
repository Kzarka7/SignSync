import { useAsync } from '../../hooks/useAsync'
import { getPhrases } from '../../services/api/phrasesService'
import Card from '../shared/Card'
import PhraseChip from '../shared/PhraseChip'

export default function QuickPhraseRow() {
  const { data: phrases } = useAsync(() => getPhrases('medical'), [])

  return (
    <Card className="flex gap-2 overflow-x-auto px-5 py-2.5">
      <span className="text-sm font-medium text-text-2 uppercase tracking-wide self-center mr-0.5 whitespace-nowrap">
        Common Phrases
      </span>
      {phrases?.map((p) => (
        <PhraseChip key={p.id} text={p.text} />
      ))}
    </Card>
  )
}
