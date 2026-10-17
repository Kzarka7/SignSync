import JSZip from 'jszip'
import type { LabeledSequence } from '../../types/dataset'
import { triggerDownload } from './datasetExport'
import { IDLE_VARIATIONS, IDLE_HANDS, IDLE_POSTURES } from './idleCollection'

const signs = ['WHICH', 'HOW', 'HELP', 'THANK_YOU', 'YES', 'NO', 'WAIT', 'WAVE_GREETING']
export const BOUNDARY_TASKS = [
  ...signs.flatMap(sign => ['normal', 'slower', 'faster'].map(speed => ({
    id: `${sign}-${speed}`, label: sign, title: `${sign} — ${speed}`,
    instruction: `Rest 2 seconds after the countdown, sign ${sign} at a ${speed} pace, then rest 2 seconds before stopping.`,
  }))),
  ...['THANK_YOU', 'YES', 'HELP', 'WAIT'].map(sign => ({
    id: `${sign}-hold`, label: sign, title: `${sign} — final hold`,
    instruction: `Rest 2 seconds, sign ${sign}, hold the final posture for 2 seconds, then rest 2 seconds. Do not alter the sign's internal movement.`,
  })),
  ...['WHICH', 'HOW', 'NO', 'WAVE_GREETING'].map(sign => ({
    id: `${sign}-repeat`, label: sign, title: `${sign} — repeat twice`,
    instruction: `Rest 2 seconds, sign ${sign}, rest 1–2 seconds, sign it again, then rest 2 seconds. Keep both signs in one recording.`,
  })),
  ...['Quiet rest', 'Relaxed visible hands', 'Adjust glasses or clothes', 'Shift in your chair'].map((action, i) => ({
    id: `no-sign-${i + 1}`, label: 'NO_SIGN', title: `No sign — ${action}`,
    instruction: `Record 20–30 seconds: ${action.toLowerCase()}. Do not intentionally sign.`,
  })),
  ...['Let a hand briefly leave the frame', 'Briefly obscure one hand with the other', 'Move shoulders partly outside the frame', 'Stop signing halfway and return to rest'].map((action, i) => ({
    id: `interruption-${i + 1}`, label: 'INTERRUPTION', title: `Interruption — ${action}`,
    instruction: `Rest 2 seconds, attempt HELP with this interruption: ${action.toLowerCase()}. Return to rest for 2 seconds. This is a deliberate quality test, not a correct sign example.`,
  })),
]

// Optional repeats/postures do not count toward the 40 required pilot tasks.
export const IDLE_CHECKLIST_POSTURES = [...IDLE_POSTURES,
  { value: 'in_front_open_palm', title: 'In front (open palm)', instruction: 'Rest in front of your lower abdomen with an open palm facing the camera. Keep your fingers relaxed.' },
]
export const EXTRA_IDLE_TASKS = IDLE_HANDS.flatMap(hand => IDLE_CHECKLIST_POSTURES
  .filter(posture => hand.value === 'both' || posture.value !== 'beside_torso')
  .map(posture => ({
    id: `no-sign-extra-idle_${hand.value}_${posture.value}`,
    label: 'NO_SIGN', title: `${hand.value === 'both' ? 'Two hands' : hand.title} — ${posture.title}`,
    hands: hand.value, posture: posture.value, target: 3,
    instruction: `${hand.instruction} ${posture.instruction} ${posture.value === 'in_front_open_palm' ? '' : 'Keep your palms naturally oriented. '}Do not intentionally sign.`,
  })))

export function getIdleChecklist(sequences: LabeledSequence[]) {
  return EXTRA_IDLE_TASKS.map(task => ({ ...task,
    count: sequences.filter(s => s.evaluation?.taskId === task.id).length,
  }))
}

// Called only after a successful save. Search forward, then wrap to earlier gaps.
export function getNextBoundaryTask(currentId: string, sequences: LabeledSequence[]) {
  const idle = currentId.startsWith('no-sign-extra-')
  const tasks = idle ? EXTRA_IDLE_TASKS : BOUNDARY_TASKS
  const index = tasks.findIndex(task => task.id === currentId)
  if (index < 0) return currentId
  const counts = new Map<string, number>()
  for (const sequence of sequences) {
    const id = sequence.evaluation?.taskId
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const target = idle ? 3 : 1
  if ((counts.get(currentId) ?? 0) < target) return currentId
  for (let offset = 1; offset < tasks.length; offset++) {
    const next = tasks[(index + offset) % tasks.length]
    if ((counts.get(next.id) ?? 0) < target) return next.id
  }
  return currentId
}

export function getEvaluationTaskTitle(taskId: string) {
  return [...BOUNDARY_TASKS, ...EXTRA_IDLE_TASKS].find(task => task.id === taskId)?.title
    ?? IDLE_VARIATIONS.find(v => `no-sign-extra-${v.id.toLowerCase()}` === taskId)?.title
    ?? taskId
}

export function getBoundaryProgress(sequences: LabeledSequence[], participantId?: string, sessionId?: string) {
  const session = sequences.filter(s => (participantId === undefined || s.evaluation?.participantId === participantId.trim())
    && (sessionId === undefined || s.evaluation?.sessionId === sessionId.trim()))
  return {
    completedTasks: new Set(session.filter(s => BOUNDARY_TASKS.some(t => t.id === s.evaluation?.taskId))
      .map(s => s.evaluation!.taskId)).size,
    extraIdleRecordings: session.filter(s => EXTRA_IDLE_TASKS.some(t => t.id === s.evaluation?.taskId)).length,
  }
}

export function buildEvaluationExport(sequences: LabeledSequence[]) {
  if (sequences.some(s => !s.evaluation)) throw new Error('Evaluation exports cannot contain training samples.')
  // Deliberately not the training schema: training loaders must not interpret
  // long, mixed-content recordings as isolated sign examples.
  return { format: 'signsync-boundary-evaluation', version: 1, purpose: 'evaluation-only',
    exportedAt: new Date().toISOString(), tasks: BOUNDARY_TASKS, optionalTasks: EXTRA_IDLE_TASKS, recordings: sequences }
}
const filename = () => `signsync-boundary-evaluation-${new Date().toISOString().replace(/[:.]/g, '-')}`
export function downloadEvaluation(sequences: LabeledSequence[]) {
  triggerDownload(new Blob([JSON.stringify(buildEvaluationExport(sequences), null, 2)], { type: 'application/json' }), `${filename()}.json`)
}
export async function buildEvaluationZip(sequences: LabeledSequence[]) {
  const zip = new JSZip()
  zip.file('evaluation.json', JSON.stringify(buildEvaluationExport(sequences), null, 2))
  zip.file('README.txt', 'Boundary evaluation only. Do not put this archive in training merge-input. Recordings contain timestamped raw landmarks, not video. Review video separately and annotate actual sign boundaries. NO_SIGN and INTERRUPTION are evaluation conditions, not training labels.')
  return { blob: await zip.generateAsync({ type: 'blob' }), filename: `${filename()}.zip` }
}
