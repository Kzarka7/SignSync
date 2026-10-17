import type { LabeledSequence, TrainingCategory } from '../../types/dataset'
import { EXTRA_IDLE_TASKS } from './boundaryEvaluation'

export const TRAINING_SIGNS = ['HELLO', 'WAVE_GREETING', 'THANK_YOU', 'PLEASE', 'SORRY', 'YES', 'NO', 'HELP', 'WELCOME', 'FRIEND', 'FAMILY', 'STAY', 'WAIT', 'WHAT', 'WHY', 'WHERE', 'WHEN', 'WHO', 'WHICH', 'HOW']
export interface TrainingBatch {
  id: string
  participantId: string
  createdAt: string
  variants: Record<string, number>
}
export interface TrainingTask {
  id: string
  title: string
  label: string
  category: TrainingCategory
  target: number | null
  instruction: string
  durationMs?: number
  variantId?: string
  pace?: string
}
const batchKey = 'signsync:training-batches-v1'
export function getTrainingBatches(): TrainingBatch[] {
  const raw = localStorage.getItem(batchKey)
  if (!raw) return []
  const batches = JSON.parse(raw)
  if (!Array.isArray(batches)) throw new Error('Saved batch information is invalid.')
  return batches
}
export function createTrainingBatch(participantId: string, variants: Record<string, number>): TrainingBatch {
  if (!participantId.trim()) throw new Error('Enter a participant code before starting a batch.')
  const configuration = Object.fromEntries(TRAINING_SIGNS.map(sign => {
    const count = variants[sign] ?? 1
    if (!Number.isInteger(count) || count < 1 || count > 5) throw new Error('Choose 1–5 variants per sign.')
    return [sign, count]
  }))
  const batch = { id: crypto.randomUUID(), participantId: participantId.trim(), createdAt: new Date().toISOString(), variants: configuration }
  localStorage.setItem(batchKey, JSON.stringify([batch, ...getTrainingBatches()]))
  return batch
}
export function getTrainingTasks(batch: TrainingBatch | undefined, category: TrainingCategory): TrainingTask[] {
  if (category === 'sign') return TRAINING_SIGNS.flatMap(sign =>
    Array.from({ length: batch?.variants[sign] ?? 1 }, (_, index) => ['normal', 'slower', 'faster'].map(pace => ({
      id: `sign-${sign}-v${index + 1}-${pace}`, title: `${sign} · Variant ${index + 1} · ${pace}`,
      category, label: sign, target: 1, variantId: `v${index + 1}`, pace,
      instruction: `Perform one complete ${sign}, variant ${index + 1}, at a comfortable ${pace} pace. Keep its natural ending and internal repetitions. Stop manually after the sign; no deliberate rest padding is needed.`,
    }))).flat())
  if (category === 'rest') return EXTRA_IDLE_TASKS.map(task => ({
    id: task.id.replace('no-sign-extra-', 'rest-'), title: task.title, label: 'REST', category, target: 3,
    durationMs: 3000, instruction: `${task.instruction} Hold this relaxed posture throughout the recording.`,
  }))
  return [
    ['hair', 'Touch or adjust hair', 'Touch or adjust your hair naturally.'],
    ['clothes', 'Adjust clothing', 'Adjust your sleeve, collar or shirt naturally.'],
    ['scratch', 'Scratch face', 'Gently scratch your cheek or face as you normally would.'],
    ['chair', 'Shift in chair', 'Shift your sitting position naturally.'],
    ['reach', 'Reach for an object', 'Reach for an everyday object and put it back.'],
    ['lap', 'Hands onto / off lap', 'Move your hands onto your lap and back into view.'],
    ['arms', 'Reposition arms', 'Casually reposition your arms without intentionally signing.'],
    ['general', 'General idle', 'Do varied, natural everyday movements without intentionally signing. Mix activities and hand positions across takes.'],
  ].map(([id, title, instruction]) => ({ id: `idle-movement-${id}`, title, instruction: `${instruction} Do not intentionally sign.`, category, label: 'IDLE_MOVEMENT', target: id === 'general' ? null : 3, durationMs: 5000 }))
}
export function trainingTaskCount(sequences: LabeledSequence[], batchId: string | undefined, taskId: string) {
  return sequences.filter(s => (batchId === undefined || s.training?.batchId === batchId) && s.training?.taskId === taskId).length
}
export function nextTrainingTask(tasks: TrainingTask[], sequences: LabeledSequence[], batchId: string | undefined, currentId: string) {
  const current = tasks.findIndex(task => task.id === currentId)
  if (current < 0) return currentId
  if (tasks[current].target === null) return currentId
  for (let offset = 0; offset < tasks.length; offset++) {
    const task = tasks[(current + offset) % tasks.length]
    if (task.target !== null && trainingTaskCount(sequences, batchId, task.id) < task.target) return task.id
  }
  return currentId
}
