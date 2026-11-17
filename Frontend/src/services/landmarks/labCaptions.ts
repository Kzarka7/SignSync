import baseline from '../../../../scripts/fsl_sandbox/baseline.json'
import displayRules from '../../../../scripts/fsl_sandbox/display_rules.json'
import demoRules from '../../../../scripts/fsl_sandbox/demo_rules.json'
import template from '../../../../scripts/fsl_sandbox/experimental_template.json'

const vocabulary = new Set(baseline.labels)
const display: Readonly<Record<string, string | undefined>> = displayRules
const futureTime = new Set(template.tags.TIME)

export type LabCaptionMode = 'v1' | 'v2'

function matches(labels: readonly string[], pattern: readonly string[], start = 0) {
  return pattern.every((label, index) => labels[start + index] === label)
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function gloss(label: string) {
  return label.toLowerCase().replace(/_/g, ' ')
}

function sentence(parts: readonly string[]) {
  const text = capitalize(parts.join(' '))
  return /[.!?]$/.test(text) ? text : text + '.'
}

function previewCaption(labels: readonly string[], experimental: boolean) {
  if (!labels.length || labels.some(label => !vocabulary.has(label))) return null
  const fallback = experimental
    ? { caption: capitalize(labels.map(label => display[label] ?? gloss(label)).join(' · ')), kind: 'fallback' as const }
    : null
  const compounds = new Map<number, typeof demoRules.compounds[number]>()
  let previousEnd = 0
  for (let start = 0; start < labels.length; start++) {
    for (const rule of demoRules.compounds) {
      if (!matches(labels, rule.labels, start)) continue
      if (start < previousEnd) return fallback
      compounds.set(start, rule)
      previousEnd = start + rule.labels.length
    }
  }

  const units: { token: string; text: string; kind?: 'lexical' | 'compound' }[] = []
  for (let start = 0; start < labels.length;) {
    const compound = compounds.get(start)
    if (compound) {
      units.push({ token: compound.token, text: compound.text, kind: 'compound' })
      start += compound.labels.length
    } else {
      const label = labels[start++]
      const wording = display[label]
      units.push({ token: label, text: wording ?? gloss(label), kind: wording ? 'lexical' : undefined })
    }
  }

  const tokens = units.map(unit => unit.token)
  const syntax = demoRules.syntax.find(rule => rule.tokens.length === tokens.length && matches(tokens, rule.tokens))
  if (syntax) {
    return { caption: sentence(syntax.order.map(index => units[index].text)), kind: 'syntax' as const }
  }
  const taggedTokens = experimental ? tokens.map(token => futureTime.has(token) ? 'TIME' : token) : tokens
  if (experimental && template.tokens.length === taggedTokens.length && matches(taggedTokens, template.tokens)) {
    return { caption: sentence(template.order.map(index => units[index].text)), kind: 'template' as const }
  }
  if (units.length === 1 && units[0].kind) return { caption: capitalize(units[0].text), kind: units[0].kind }
  return fallback
}

export function previewLabCaption(labels: readonly string[]) {
  return previewCaption(labels, false)
}

export function previewLabCaptionV2(transcript: readonly { label: string; requestId?: string }[]) {
  const seen = new Map<string, Set<string>>()
  const labels: string[] = []
  for (const { label, requestId } of transcript) {
    // A repeated label can be intentional. Only remove a repeated event from the same request.
    if (requestId) {
      const requestLabels = seen.get(requestId) ?? new Set<string>()
      if (requestLabels.has(label)) continue
      requestLabels.add(label)
      seen.set(requestId, requestLabels)
    }
    labels.push(label)
  }
  return previewCaption(labels, true)
}
