import baseline from '../../../../scripts/fsl_sandbox/baseline.json'
import type { LabTranscriptEntry } from './recognitionDiagnostics'

export const GLOSS_SCHEMA_VERSION = 1
export const GLOSS_MAPPING_VERSION = '43-similar-signs-v1:draft-1'

const numerals = new Map(['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN']
  .map((label, index) => [label, index + 1]))

type LexiconEntry = {
  glossId: string
  gloss: string
  modelLabel: string
} & ({ type: 'LEXICAL' } | { type: 'NUMBER'; value: number })

// Use IDs scoped to the frozen label set. Changes to a display gloss do not change its ID.
export const LAB_GLOSS_LEXICON: readonly LexiconEntry[] = baseline.labels.map((modelLabel, index) => {
  const entry = { glossId: `ss43-${index + 1}`, gloss: modelLabel.replace(/_/g, '-'), modelLabel }
  const value = numerals.get(modelLabel)
  return value === undefined ? { ...entry, type: 'LEXICAL' } : { ...entry, type: 'NUMBER', value }
})
const byLabel = new Map(LAB_GLOSS_LEXICON.map(entry => [entry.modelLabel, entry]))

type Interval = { startMs: number; endMs: number }
type GlossReference = Pick<LexiconEntry, 'glossId' | 'gloss'>

export type GlossSuggestion = LexiconEntry & {
  id: string
  reviewStatus: 'pending'
  timing: Interval | null
  event: Pick<LabTranscriptEntry, 'requestId' | 'score' | 'decisionMs'>
}

export type GlossAnnotation = Interval & {
  id: string
  reviewStatus: 'reviewed' | 'unresolved'
  basedOn?: { requestId: string; modelMode: string; modelLabel: string }
} & (
  | (({ type: 'LEXICAL' } | { type: 'NUMBER'; value: number }) & GlossReference)
  | { type: 'FINGERSPELLING'; letters: string[] }
  | { type: 'UNRESOLVED'; reason?: string }
  | { type: 'REDUPLICATION'; base?: GlossReference; count?: number; componentIds: string[] }
)

type RecognitionWindow = Interval & { requestId: string | null }

export function suggestLabGlosses(
  transcript: readonly LabTranscriptEntry[],
  windows: readonly RecognitionWindow[],
): GlossSuggestion[] {
  if (!transcript.length) return []
  const windowsByRequest = new Map(windows.map(window => [window.requestId, window]))
  const seen = new Set<string>()
  const suggestions: GlossSuggestion[] = []
  for (const { label, requestId, score, decisionMs } of transcript) {
    const entry = byLabel.get(label)
    const id = JSON.stringify([requestId, label])
    if (!entry || seen.has(id)) continue
    seen.add(id)
    const window = windowsByRequest.get(requestId)
    suggestions.push({
      ...entry, id, reviewStatus: 'pending', event: { requestId, score, decisionMs },
      timing: window ? { startMs: window.startMs, endMs: window.endMs } : null,
    })
  }
  return suggestions
}

export function containsGlossInterval(span: Interval, token: Interval) {
  return span.startMs <= token.startMs && token.endMs <= span.endMs
}

export function updateGlossAnnotations(
  annotations: readonly GlossAnnotation[], id: string, replacement?: GlossAnnotation,
) {
  const next = annotations.filter(token => token.id !== id)
  if (replacement) next.push(replacement)
  const byId = new Map(next.map(token => [token.id, token]))
  return next.map(token => {
    if (token.type !== 'REDUPLICATION') return token
    return {
      ...token, componentIds: token.componentIds.filter(id => {
        const component = byId.get(id)
        return component && component.type !== 'REDUPLICATION' && containsGlossInterval(token, component)
      }),
    }
  }).sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
}

export function labGlossReport(
  source: 'video' | 'camera',
  durationMs: number,
  suggestions: readonly GlossSuggestion[],
  annotations: readonly GlossAnnotation[],
) {
  return {
    schemaVersion: GLOSS_SCHEMA_VERSION,
    mappingVersion: GLOSS_MAPPING_VERSION,
    timeBase: source === 'video' ? 'video-ms' : 'camera-run-ms',
    durationMs,
    suggestions,
    annotations,
  }
}
