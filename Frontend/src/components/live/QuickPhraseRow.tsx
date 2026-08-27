import { useAsync } from "../../hooks/useAsync";
import { getPhrases } from "../../services/api/phrasesService";
import Card from "../shared/Card";
import PhraseChip from "../shared/PhraseChip";

export default function QuickPhraseRow() {
  const { data: phrases } = useAsync(() => getPhrases("medical"), []);

  return (
    <Card className="flex flex-col gap-2 px-5 py-2.5">
      <span className="text-md font-semibold text-text-2 uppercase tracking-wide">
        Common Phrases
      </span>
      <div className="flex gap-2 overflow-x-auto">
        {phrases?.map((p) => (
          <PhraseChip key={p.id} text={p.text} />
        ))}
      </div>
    </Card>
  );
}
