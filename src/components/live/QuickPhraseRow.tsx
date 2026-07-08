import { useAsync } from '../../hooks/useAsync'
import { getPhrases } from '../../services/api/phrasesService'
import PhraseChip from '../shared/PhraseChip'

export default function QuickPhraseRow() {
  const { data: phrases } = useAsync(() => getPhrases('medical'), [])

  return (
    <div className="flex gap-2 mt-3.5 overflow-x-auto pb-1">
      <span className="text-[11px] font-semibold text-text-3 uppercase tracking-wide self-center mr-0.5 whitespace-nowrap">
        Medical
      </span>
      {phrases?.map((p) => (
        <PhraseChip key={p.id} text={p.text} />
      ))}
    </div>
  )
}
