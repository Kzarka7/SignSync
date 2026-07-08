import { useAsync } from '../../hooks/useAsync'
import { getPhrases } from '../../services/api/phrasesService'
import Card from '../shared/Card'
import PhraseChip from '../shared/PhraseChip'

export default function FrequentPhrases() {
  const { data: phrases } = useAsync(() => getPhrases(), [])

  return (
    <Card>
      {phrases?.map((p) => (
        <PhraseChip key={p.id} text={p.text} />
      ))}
    </Card>
  )
}
