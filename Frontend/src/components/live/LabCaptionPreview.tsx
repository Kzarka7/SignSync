import { previewLabCaption, previewLabCaptionV2, type LabCaptionMode } from '../../services/landmarks/labCaptions'
import type { LabTranscriptEntry } from '../../services/landmarks/recognitionDiagnostics'

const RULE_LABELS = {
  lexical: 'Lexicalization',
  compound: 'Compound demo',
  syntax: 'Syntax demo',
  template: 'Syntax template demo',
  fallback: 'Recognized words',
}

export default function LabCaptionPreview({ transcript, mode = 'v1' }: {
  transcript: readonly LabTranscriptEntry[]
  mode?: LabCaptionMode
}) {
  const result = mode === 'v2' ? previewLabCaptionV2(transcript) : previewLabCaption(transcript.map(entry => entry.label))
  return <div className="mt-3 space-y-1 border-t border-border pt-3" aria-live="polite">
    <h4 className="text-xs font-semibold text-text-2">English caption preview · {mode}</h4>
    {result ? <>
      <p className="break-words text-base font-semibold text-ink">{result.caption}</p>
      <p className="text-xs text-text-2">{RULE_LABELS[result.kind]}</p>
    </> : <p className="text-sm text-text-2">
      {transcript.length ? 'No caption rule matched these signs.' : 'Sign one phrase per run.'}
    </p>}
  </div>
}
