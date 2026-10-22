const NUMBER_LABELS: Record<string, string> = {
  '1': 'ONE', '2': 'TWO', '3': 'THREE', '4': 'FOUR', '5': 'FIVE',
  '6': 'SIX', '7': 'SEVEN', '8': 'EIGHT', '9': 'NINE', '10': 'TEN',
}

function normalize(value: string): string {
  return value.trim().toUpperCase().replace(/[\s_-]+/g, '')
}

export function findSignLabels(labels: string[], query: string): string[] {
  const term = normalize(query)
  if (!term) return []
  const exact = labels.filter(label => normalize(label) === term || label === NUMBER_LABELS[term])
  return exact.length ? exact : labels.filter(label => normalize(label).includes(term))
}
