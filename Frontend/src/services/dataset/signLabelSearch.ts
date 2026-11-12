export const SIGN_LABEL_GROUPS = [
  { title: 'Greetings and courtesy', labels: [
    'HELLO', 'WAVE_GREETING', 'THANK_YOU', 'PLEASE', 'SORRY', 'WELCOME',
    'GOOD_MORNING', 'GOOD_AFTERNOON', 'GOOD_EVENING',
  ] },
  { title: 'Conversation and feedback', labels: [
    'YES', 'NO', 'MAYBE', 'AGAIN', 'UNDERSTAND', 'DONT_UNDERSTAND', 'CORRECT', 'WRONG', 'FINE',
  ] },
  { title: 'Questions', labels: ['WHAT', 'WHY', 'WHERE', 'WHEN', 'WHO', 'WHICH', 'HOW'] },
  { title: 'People and family', labels: [
    'PERSON', 'FRIEND', 'FAMILY', 'MOTHER', 'FATHER', 'PARENTS', 'GRANDMOTHER', 'GRANDFATHER', 'DEAF',
  ] },
  { title: 'School and places', labels: ['SCHOOL', 'TEACHER', 'STUDENT', 'ROOM', 'BATHROOM'] },
  { title: 'Daily needs and actions', labels: ['HELP', 'STAY', 'WAIT', 'EAT', 'DRINK', 'WATER', 'SLEEP', 'MONEY'] },
  { title: 'Feelings and health', labels: ['HAPPY', 'SAD', 'TIRED', 'SICK', 'GOOD', 'BAD'] },
  { title: 'Numbers', labels: ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'] },
  { title: 'Days and time', labels: [
    'YESTERDAY', 'TODAY', 'TOMORROW', 'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY',
  ] },
  { title: 'Alphabet', labels: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'] },
]

export const DEFAULT_SIGN_LABELS = SIGN_LABEL_GROUPS.flatMap(group => group.labels)

export const MONTH_LABELS = new Set([
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST',
  'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
])

const NUMBER_LABELS: Record<string, string> = {
  '1': 'ONE', '2': 'TWO', '3': 'THREE', '4': 'FOUR', '5': 'FIVE',
  '6': 'SIX', '7': 'SEVEN', '8': 'EIGHT', '9': 'NINE', '10': 'TEN',
}

function normalize(value: string): string {
  return value.trim().toUpperCase().replace(/[\s_'’-]+/g, '')
}

export function findSignLabels(labels: string[], query: string): string[] {
  const term = normalize(query)
  if (!term) return []
  const exact = labels.filter(label => normalize(label) === term || label === NUMBER_LABELS[term])
  return exact.length ? exact : labels.filter(label => normalize(label).includes(term))
}
