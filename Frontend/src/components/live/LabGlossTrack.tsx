import { useState, type FormEvent } from 'react'
import Button from '../shared/Button'
import {
  containsGlossInterval, LAB_GLOSS_LEXICON, updateGlossAnnotations,
  type GlossAnnotation, type GlossSuggestion,
} from '../../services/landmarks/labGlosses'

const types: Record<GlossAnnotation['type'], string> = {
  LEXICAL: 'Lexical sign',
  NUMBER: 'Number',
  UNRESOLVED: 'Unresolved sign',
  REDUPLICATION: 'Reduplication',
  FINGERSPELLING: 'Fingerspelling',
}
const fieldClass = 'block min-h-10 w-full min-w-0 rounded-lg border border-border bg-white px-2.5 py-1 text-sm'
const seconds = (ms: number) => (ms / 1000).toFixed(3)

function notation(token: GlossAnnotation | GlossSuggestion) {
  switch (token.type) {
    case 'UNRESOLVED': return 'UNK'
    case 'REDUPLICATION': return 'REDUP' + (token.base ? ` · ${token.base.gloss}` : '') + (token.count ? ` ×${token.count}` : '')
    case 'FINGERSPELLING': return `FS:${token.letters.join('-')}`
    case 'NUMBER': return `${token.gloss} · ${token.value}`
    case 'LEXICAL': return token.gloss
  }
}

export function LabGlossSuggestions({ suggestions, onAnnotate }: {
  suggestions: readonly GlossSuggestion[]
  onAnnotate?: (suggestion: GlossSuggestion) => void
}) {
  return <div className="mt-3 space-y-1.5">
    <h4 className="text-xs font-semibold text-text-2">Gloss suggestions</h4>
    {suggestions.length ? <ol aria-label="Gloss suggestions" className="flex flex-wrap gap-1.5">
      {suggestions.map(token => <li key={token.id}>
        {onAnnotate
          ? <Button type="button" size="sm" aria-label={`Annotate ${notation(token)} at ${seconds(token.event.decisionMs)} seconds`}
            onClick={() => onAnnotate(token)}>{notation(token)}</Button>
          : <span className="inline-block rounded-md bg-sky px-2.5 py-1 text-sm">{notation(token)}</span>}
      </li>)}
    </ol> : <p className="text-sm text-text-2">No mapped signs yet.</p>}
  </div>
}

type Draft = {
  id?: string
  basedOn?: GlossAnnotation['basedOn']
  type: GlossAnnotation['type']
  start: string
  end: string
  glossId: string
  text: string
  count: string
  componentIds: string[]
}
const newDraft: Draft = { type: 'UNRESOLVED', start: '', end: '', glossId: '', text: '', count: '', componentIds: [] }

export default function LabGlossTrack({ suggestions, annotations, onChange, durationMs, running, modelMode, readPlayhead }: {
  suggestions: readonly GlossSuggestion[]
  annotations: readonly GlossAnnotation[]
  onChange: (annotations: GlossAnnotation[]) => void
  durationMs: number
  running: boolean
  modelMode: string
  readPlayhead?: () => number | undefined
}) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const canEdit = !running && durationMs > 0

  function edit(next: Draft | null) {
    setDraft(next)
    setError('')
  }

  function open(token: GlossAnnotation) {
    edit({
      ...newDraft, id: token.id, type: token.type, start: seconds(token.startMs), end: seconds(token.endMs), basedOn: token.basedOn,
      glossId: 'glossId' in token ? token.glossId : token.type === 'REDUPLICATION' ? token.base?.glossId ?? '' : '',
      text: token.type === 'FINGERSPELLING' ? token.letters.join('') : token.type === 'UNRESOLVED' ? token.reason ?? '' : '',
      count: token.type === 'REDUPLICATION' ? token.count?.toString() ?? '' : '',
      componentIds: token.type === 'REDUPLICATION' ? token.componentIds : [],
    })
  }

  function annotateSuggestion(suggestion: GlossSuggestion) {
    const existing = annotations.find(token => token.basedOn?.requestId === suggestion.event.requestId
      && token.basedOn?.modelMode === modelMode && token.basedOn?.modelLabel === suggestion.modelLabel)
    if (existing) {
      open(existing)
      return
    }
    edit({
      ...newDraft, type: suggestion.type, glossId: suggestion.glossId,
      basedOn: { requestId: suggestion.event.requestId, modelMode, modelLabel: suggestion.modelLabel },
      start: suggestion.timing ? seconds(suggestion.timing.startMs) : '',
      end: suggestion.timing ? seconds(Math.min(durationMs, suggestion.timing.endMs)) : '',
    })
  }

  const interval = draft?.start && draft.end
    ? { startMs: Math.round(Number(draft.start) * 1000), endMs: Math.round(Number(draft.end) * 1000) }
    : null
  const components = interval ? annotations.filter(token => token.id !== draft?.id
    && token.type !== 'REDUPLICATION' && containsGlossInterval(interval, token)) : []

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft || !canEdit) return
    if (!interval || !Number.isSafeInteger(interval.startMs) || !Number.isSafeInteger(interval.endMs)
      || interval.startMs < 0 || interval.endMs <= interval.startMs || interval.endMs > durationMs) {
      setError('Enter a start and end within the recording. The end must be after the start.')
      return
    }
    const entry = LAB_GLOSS_LEXICON.find(entry => entry.glossId === draft.glossId)
    const base = entry && { gloss: entry.gloss, glossId: entry.glossId }
    const common = { id: draft.id ?? crypto.randomUUID(), ...interval, basedOn: draft.basedOn, reviewStatus: 'reviewed' as const }
    let token: GlossAnnotation
    switch (draft.type) {
      case 'LEXICAL':
      case 'NUMBER':
        if (!entry || !base || entry.type !== draft.type) {
          setError('Choose a gloss.')
          return
        }
        token = entry.type === 'NUMBER' ? { ...common, ...base, type: entry.type, value: entry.value }
          : { ...common, ...base, type: entry.type }
        break
      case 'UNRESOLVED':
        token = { ...common, type: draft.type, reviewStatus: 'unresolved', reason: draft.text.trim() || undefined }
        break
      case 'FINGERSPELLING': {
        const letters = draft.text.trim().toUpperCase().replace(/[\s-]/g, '')
        if (!/^[A-Z]+$/.test(letters)) {
          setError('Enter the letters in order, using A–Z.')
          return
        }
        token = { ...common, type: draft.type, letters: Array.from(letters) }
        break
      }
      case 'REDUPLICATION': {
        const count = draft.count === '' ? undefined : Number(draft.count)
        if (count !== undefined && (!Number.isSafeInteger(count) || count < 2)) {
          setError('Use a whole repeat count of at least two, or leave it blank.')
          return
        }
        token = { ...common, type: draft.type, base, count,
          componentIds: components.filter(component => draft.componentIds.includes(component.id)).map(component => component.id) }
        break
      }
    }
    onChange(updateGlossAnnotations(annotations, token.id, token))
    edit(null)
  }

  return <section aria-label="Sign gloss notation" className="space-y-3 rounded-lg border border-border p-3">
    <h3 className="text-sm font-semibold text-ink">Sign gloss notation</h3>
    <LabGlossSuggestions suggestions={suggestions} onAnnotate={canEdit ? annotateSuggestion : undefined} />
    {suggestions.length > 0 && <p className="text-xs text-text-2">Suggestions use model labels and recognition windows. Check the sign and adjust its boundaries when annotating.</p>}
    <h4 className="text-xs font-semibold text-text-2">Annotations</h4>
    {annotations.length > 0 && <ol aria-label="Gloss annotations" className="space-y-1.5">
      {annotations.map(token => <li key={token.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-sky p-2">
        <span className="min-w-0 break-words text-sm">
          <strong>{notation(token)}</strong>{' · '}{seconds(token.startMs)}–{seconds(token.endMs)} s
          {token.type === 'REDUPLICATION' && token.componentIds.length > 0 && ` · ${token.componentIds.length} linked`}
          {token.type === 'UNRESOLVED' && token.reason && ` · ${token.reason}`}
        </span>
        {canEdit && <Button type="button" size="sm" aria-label={`Edit ${notation(token)} at ${seconds(token.startMs)} seconds`}
          onClick={() => open(token)}>Edit</Button>}
      </li>)}
    </ol>}
    {canEdit && !draft && <Button type="button" size="sm" onClick={() => edit(newDraft)}>Add annotation</Button>}
    {canEdit && draft && <form onSubmit={save} className="space-y-3 border-t border-border pt-3">
      <p className="text-xs text-text-2">Annotate within 0–{seconds(durationMs)} s.</p>
      <label className="block text-sm">Token type
        <select className={fieldClass} value={draft.type} onChange={event => edit({
          ...newDraft, id: draft.id, basedOn: draft.basedOn,
          start: draft.start, end: draft.end, type: event.target.value as Draft['type'],
        })}>
          {Object.entries(types).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        {(['start', 'end'] as const).map(boundary => <div key={boundary} className="space-y-1">
          <label className="block text-sm">{boundary === 'start' ? 'Start (s)' : 'End (s)'}
            <input className={fieldClass} type="number" min="0" max={durationMs / 1000} step="0.001" required
              value={draft[boundary]} onChange={event => edit({ ...draft, [boundary]: event.target.value })} />
          </label>
          {readPlayhead && <Button type="button" size="sm" onClick={() => {
            const ms = readPlayhead()
            if (ms !== undefined) edit({ ...draft, [boundary]: seconds(Math.min(durationMs, ms)) })
          }}>Set {boundary} from video</Button>}
        </div>)}
      </div>
      {(draft.type === 'LEXICAL' || draft.type === 'NUMBER' || draft.type === 'REDUPLICATION') &&
        <label className="block text-sm">{draft.type === 'REDUPLICATION' ? 'Base gloss (optional)' : 'Gloss'}
          <select className={fieldClass} required={draft.type !== 'REDUPLICATION'} value={draft.glossId}
            onChange={event => edit({ ...draft, glossId: event.target.value })}>
            <option value="">Choose a gloss</option>
            {LAB_GLOSS_LEXICON.filter(entry => draft.type === 'REDUPLICATION' || entry.type === draft.type)
              .map(entry => <option key={entry.glossId} value={entry.glossId}>{entry.gloss}</option>)}
          </select>
        </label>}
      {(draft.type === 'FINGERSPELLING' || draft.type === 'UNRESOLVED') &&
        <label className="block text-sm">{draft.type === 'FINGERSPELLING' ? 'Letters' : 'Reason (optional)'}
          <input className={fieldClass} value={draft.text} required={draft.type === 'FINGERSPELLING'}
            onChange={event => edit({ ...draft, text: event.target.value })} />
        </label>}
      {draft.type === 'REDUPLICATION' && <>
        <label className="block text-sm">Repeat count (optional)
          <input className={fieldClass} type="number" min="2" step="1" value={draft.count}
            onChange={event => edit({ ...draft, count: event.target.value })} />
        </label>
        {components.length > 0 && <fieldset className="space-y-1">
          <legend className="text-sm">Link annotations within this span</legend>
          {components.map(token => <label key={token.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.componentIds.includes(token.id)}
              onChange={event => edit({ ...draft, componentIds: event.target.checked
                ? [...draft.componentIds, token.id] : draft.componentIds.filter(id => id !== token.id) })} />
            {notation(token)} · {seconds(token.startMs)}–{seconds(token.endMs)} s
          </label>)}
        </fieldset>}
      </>}
      {error && <p role="alert" className="text-sm text-[#a3372f]">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="primary">Save annotation</Button>
        <Button type="button" size="sm" onClick={() => edit(null)}>Cancel</Button>
        {draft.id && <Button type="button" size="sm" variant="danger" onClick={() => {
          onChange(updateGlossAnnotations(annotations, draft.id!))
          edit(null)
        }}>Remove annotation</Button>}
      </div>
    </form>}
  </section>
}
