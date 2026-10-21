import JSZip from 'jszip'
import type { LabeledSequence } from '../../types/dataset'
import { UPPER_BODY_POSE_LANDMARK_NAMES } from '../../types/landmarks'
import { buildDatasetExport } from './datasetExport'
import { assessVideoQuality, assessBoundaryVideoQuality, validQualityWindow } from './videoQuality'
import { detectedHand } from './videoDiagnostics'
import { buildFeatureSchema, toFeatureVector } from '../landmarks/normalize'
import { intervalReviewMatches, isFullRecording } from './videoIntervalReview'

export const TRAINING_PACKAGE_VERSION = 'video-training-package-v1'
export type TrainingAssessment = {
  id: string; label: string; state: 'Ready for training' | 'Needs review' | 'Retake'
  reasons: string[]; warnings: string[]; sourceGroup: string | null
}
const stableJson = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)

export function assessTrainingSample(sample: LabeledSequence): TrainingAssessment {
  const reasons: string[] = [], warnings: string[] = []
  const metadata = sample.videoImport
  const purpose = metadata?.samplePurpose
  let retake = false
  if (sample.evaluation) reasons.push('Reserved for evaluation; cannot enter a training package.')
  if (typeof sample.id !== 'string' || !sample.id.trim() || typeof sample.label !== 'string' || !sample.label.trim() || sample.label !== sample.label.trim()) reasons.push('A sample ID and a clean, non-empty label are required.')
  if (!metadata) reasons.push('No video training review. Existing camera samples remain available through the regular exports.')
  else {
    const sourceFrames = ['video-import-v4-mp0.10.35-source-frames', 'video-import-v5-mp0.10.35-gesture-context', 'video-import-v6-mp0.10.35-boundary'].includes(metadata.processingVersion)
    if (purpose || metadata.processingVersion === 'video-import-v6-mp0.10.35-boundary') {
      if (!['rest', 'idle_movement'].includes(purpose ?? '') || metadata.processingVersion !== 'video-import-v6-mp0.10.35-boundary' || metadata.qualityWindow ||
        sample.training?.protocol !== 'separate-training-v1' || sample.training.category !== purpose || !sample.training.taskId ||
        sample.label !== (purpose === 'rest' ? 'REST' : 'IDLE_MOVEMENT')) reasons.push('Invalid non-sign category, task or processing policy.')
      if (metadata.review?.samplePurpose !== purpose || stableJson(metadata.review?.training) !== stableJson(sample.training)) reasons.push('Review no longer matches the non-sign category or task.')
    } else if (sample.training?.category === 'rest' || sample.training?.category === 'idle_movement' || ['REST', 'IDLE', 'IDLE_MOVEMENT'].includes(sample.label)) {
      reasons.push('Reprocess non-sign footage with its dedicated quality policy.')
    }
    if (metadata.qualityWindow && (metadata.processingVersion !== 'video-import-v5-mp0.10.35-gesture-context' ||
      !validQualityWindow(metadata.qualityWindow, metadata.trimEndMs - metadata.trimStartMs))) reasons.push('Invalid gesture/context assessment provenance.')
    if (sourceFrames) {
      const sampling = metadata.sampling
      if (!sampling || sampling.method !== 'decoded-source-frames-v1' || ![20, 30, 60].includes(sampling.requestedFps) ||
        ![sampling.effectiveTargetFps, sampling.sourceAverageFps, sampling.sourceMedianFps, sampling.achievedFps, sampling.processingMs, sampling.processingFps].every(value => Number.isFinite(value) && value > 0) ||
        sampling.selectedFrames !== sample.frames.length || sampling.decodedFrames !== sampling.selectedFrames + sampling.skippedForTarget + sampling.duplicateTimestamps ||
        Math.abs(metadata.sampleFps - sampling.achievedFps) > .001) reasons.push('Missing or inconsistent source-frame sampling measurements.')
    }
    if (metadata.intervalReview && !intervalReviewMatches(metadata.intervalReview, metadata.trimStartMs / 1000, metadata.trimEndMs / 1000, metadata.sourceDurationMs / 1000)) reasons.push('Interval boundary confirmation no longer matches the saved interval.')
    if (!metadata.intervalReview) warnings.push('Older sample: explicit interval boundary confirmation was not recorded. Review the boundaries before training.')
    const review = metadata.review
    if (stableJson(review?.qualityWindow) !== stableJson(metadata.qualityWindow)) reasons.push('Review no longer matches gesture/context assessment boundaries.')
    if (!review || review.protocol !== 'video-training-review-v1' || (purpose ? review.completeSample !== true : review.completeSign !== true) || review.qualityFindingsAccepted !== true || !Number.isFinite(Date.parse(metadata.reviewedAt)))
      reasons.push('Confirm the sample, assigned label/task and quality findings in the video queue before saving.')
    if (review && (review.label !== sample.label || review.trimStartMs !== metadata.trimStartMs || review.trimEndMs !== metadata.trimEndMs ||
      review.processingVersion !== metadata.processingVersion || review.expectedHands !== metadata.expectedHands)) reasons.push('Review no longer matches the label, interval, processing version or expected hands.')
    if (!/^[a-f0-9]{64}$/i.test(metadata.fingerprint)) reasons.push('A SHA256 source fingerprint is required.')
    if (![metadata.trimStartMs, metadata.trimEndMs, metadata.sourceDurationMs].every(Number.isFinite) || metadata.trimStartMs < 0 ||
      metadata.trimEndMs <= metadata.trimStartMs || metadata.trimEndMs > metadata.sourceDurationMs + .01) reasons.push('Source interval is invalid.')
    if ((!sourceFrames && (metadata.sampleFps !== 20 || !metadata.processingVersion?.startsWith('video-import-v3-'))) ||
      metadata.preprocessing?.orientation !== (sourceFrames ? 'source-display-transform' : 'browser-displayed') || metadata.preprocessing.mirroring !== 'source-unchanged' ||
      metadata.preprocessing.handedness !== 'mediapipe-assignment' || metadata.preprocessing.missingHands !== 'null-with-presence-flags' || metadata.preprocessing.interpolation !== 'none')
      reasons.push('Reprocess with the current collector to establish preprocessing provenance.')
    if (![metadata.width, metadata.height, metadata.inputWidth, metadata.inputHeight, metadata.maxDimension].every(value => Number.isInteger(value) && value! > 0) ||
      metadata.inputWidth! > metadata.width || metadata.inputHeight! > metadata.height || Math.max(metadata.inputWidth!, metadata.inputHeight!) > metadata.maxDimension!) reasons.push('Processing dimensions are missing or inconsistent.')
    if (metadata.expectedHands !== 'either' && metadata.expectedHands !== 'both') reasons.push('Expected hand coverage has not been reviewed.')
  }
  try {
    if (!Array.isArray(sample.frames) || !sample.frames.length) throw Error('No landmark frames.')
    const length = buildFeatureSchema().length
    let previous = -Infinity
    for (const frame of sample.frames) {
      if (!Number.isFinite(frame.timestamp) || frame.timestamp < 0 || frame.timestamp <= previous || frame.raw?.timestamp !== frame.timestamp) throw Error('Frame timestamps must be finite, relative, synchronized and strictly increasing.')
      const sourceFrames = metadata?.sampling?.method === 'decoded-source-frames-v1'
      if (metadata && (frame.timestamp >= metadata.trimEndMs - metadata.trimStartMs + .01 ||
        (!sourceFrames && previous !== -Infinity && Math.abs(frame.timestamp - previous - 50) > .01))) throw Error('Frame timing does not match the processed interval.')
      if (sourceFrames && (frame.sourceTimestampMs === undefined || !Number.isFinite(frame.sourceTimestampMs) ||
        !Number.isFinite(frame.sourceDurationMs) || frame.sourceDurationMs! <= 0 || Math.abs(frame.sourceTimestampMs - metadata!.trimStartMs - frame.timestamp) > .01))
        throw Error('Source-frame timestamps/durations are missing or inconsistent.')
      previous = frame.timestamp
      for (const hand of [frame.raw.leftHand, frame.raw.rightHand]) if (hand !== null && !detectedHand(hand)) throw Error('A detected hand must have 21 finite landmark points; missing hands must remain null.')
      if (frame.raw.pose !== null && !UPPER_BODY_POSE_LANDMARK_NAMES.every(name => {
        const point = frame.raw.pose?.[name]
        return point && [point.x, point.y, point.z].every(Number.isFinite) && (point.visibility === undefined || Number.isFinite(point.visibility))
      })) throw Error('Pose landmarks are malformed or non-finite.')
      const vector = toFeatureVector(frame.raw)
      if (vector.features.length !== length || !vector.features.every(Number.isFinite)) throw Error('Normalized features are malformed or non-finite.')
    }
    const first = sample.frames[0].timestamp, last = sample.frames[sample.frames.length - 1].timestamp
    if (metadata && !metadata.sampling && (first !== 0 || Math.abs(sample.frames.length - Math.ceil((metadata.trimEndMs - metadata.trimStartMs) / 50 - 1e-8)) > 0)) throw Error('Frames do not cover the declared processed interval.')
    if (metadata?.sampling && sample.frames.length > 1 && Math.abs(metadata.sampling.achievedFps - (sample.frames.length - 1) * 1000 / (last - first)) > .001)
      throw Error('Reported landmark FPS does not match source timestamps.')
    if (!Number.isFinite(sample.durationMs) || Math.abs(sample.durationMs - (last - first)) > .01) throw Error('Duration does not match the saved frames.')
    const timing = metadata?.sampling ? { endMs: metadata.trimEndMs - metadata.trimStartMs, fps: metadata.sampling.effectiveTargetFps } : undefined
    const quality = purpose ? assessBoundaryVideoQuality(sample.frames, purpose, metadata?.expectedHands ?? 'either', timing)
      : assessVideoQuality(sample.frames, metadata?.expectedHands ?? 'either', timing, metadata?.qualityWindow)
    if (quality.result === 'Retake') { retake = true; reasons.push(...quality.findings) }
    else if (quality.result === 'Review') warnings.push(...quality.findings)
    if (metadata && stableJson(metadata.quality) !== stableJson(quality)) reasons.push('Stored quality does not match the saved frames and hand expectation; reprocess and review.')
  } catch (error) { retake = true; reasons.push(error instanceof Error ? error.message : 'Invalid frame data.') }
  return { id: sample.id, label: sample.label, state: retake ? 'Retake' : reasons.length ? 'Needs review' : 'Ready for training', reasons, warnings,
    sourceGroup: typeof metadata?.fingerprint === 'string' && metadata.fingerprint ? `sha256:${metadata.fingerprint.toLowerCase()}` : null }
}

export function reviewTrainingSamples(samples: LabeledSequence[]) {
  const ids = new Set<string>(), sources = new Set<string>(), contents = new Set<string>()
  return samples.map(sample => {
    const assessment = assessTrainingSample(sample)
    if (ids.has(sample.id)) assessment.reasons.push('Duplicate sample ID in this export.')
    ids.add(sample.id)
    if (assessment.state === 'Ready for training') {
      const content = JSON.stringify(sample.frames)
      if (sources.has(assessment.sourceGroup!) || contents.has(content)) {
        assessment.reasons.push('Duplicate source recording or identical landmark sequence; only the first approved occurrence is included.')
      } else { sources.add(assessment.sourceGroup!); contents.add(content) }
    }
    if (assessment.reasons.length && assessment.state !== 'Retake') assessment.state = 'Needs review'
    return assessment
  })
}

export async function buildTrainingPackage(samples: LabeledSequence[]) {
  const assessments = reviewTrainingSamples(samples)
  const approved = samples.filter((_, index) => assessments[index].state === 'Ready for training')
  if (!approved.length) throw Error('No approved, valid video samples are ready for a training package. Review and save takes in Upload videos first.')
  const dataset = buildDatasetExport(approved)
  const manifest = {
    packageVersion: TRAINING_PACKAGE_VERSION, createdAt: dataset.exportedAt, featureSchema: dataset.featureSchema,
    preprocessing: { sampleFps: 'Per-sequence sampleFps and sampling metadata; legacy 20 Hz or distinct source-frame extraction.', interpolation: 'none', modelResampling: 'Deferred to versioned training preparation; original missing-hand flags retained.' },
    sourceGroups: approved.map(sample => ({ sampleId: sample.id, groupId: `sha256:${sample.videoImport!.fingerprint.toLowerCase()}`,
      trimStartMs: sample.videoImport!.trimStartMs, trimEndMs: sample.videoImport!.trimEndMs })),
    splitPolicy: 'All samples from a source group must stay in one split. No train/validation/test split has been assigned.',
    signerIdentity: 'unknown', signerWarning: 'Different source files may show the same signer or recording session. Source grouping alone cannot establish signer independence or prevent near-duplicate recordings across splits. No unseen-signer claim is supported.',
  }
  const report = { packageVersion: TRAINING_PACKAGE_VERSION, included: approved.length, excluded: samples.length - approved.length, samples: assessments,
    intervalSummary: {
      trimmed: approved.filter(sample => !isFullRecording(sample.videoImport!.trimStartMs / 1000, sample.videoImport!.trimEndMs / 1000, sample.videoImport!.sourceDurationMs / 1000)).length,
      fullRecordings: approved.filter(sample => isFullRecording(sample.videoImport!.trimStartMs / 1000, sample.videoImport!.trimEndMs / 1000, sample.videoImport!.sourceDurationMs / 1000)).length,
      acceptedTrackingWarnings: approved.filter(sample => sample.videoImport!.quality.result === 'Review').length,
      boundaryDecisionNotRecorded: approved.filter(sample => !sample.videoImport!.intervalReview).length,
    },
    warning: manifest.signerWarning, approvalMeaning: 'Human confirmed the intended label/task, selected interval and acceptable tracking findings. Technical checks do not certify sign or task correctness.' }
  const files: Record<string, string> = {
    'dataset.json': JSON.stringify(dataset, null, 2), 'manifest.json': JSON.stringify(manifest, null, 2),
    'acceptance-report.json': JSON.stringify(report, null, 2),
    'README.md': '# Reviewed video training package\n\nRead acceptance-report.json before training. dataset.json retains the existing schemaVersion 1 and feature order, with raw landmarks and explicit missing-hand presence flags. No gaps were filled.\n\nKeep sourceGroups in one split. Signer identities are unknown; do not claim unseen-signer performance. Review similar recordings manually before splitting. No model training or split assignment occurred during export.\n\nValidate with: python scripts/validate_video_training_package.py <package.zip> [--split-file assignments.json]\nSplit assignments map every included sample ID to training, validation or test.\n',
  }
  const checksums: Record<string, string> = {}
  for (const [name, content] of Object.entries(files)) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
    checksums[name] = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  }
  const zip = new JSZip()
  Object.entries(files).forEach(([name, content]) => zip.file(name, content))
  zip.file('checksums.json', JSON.stringify(checksums, null, 2))
  return { blob: await zip.generateAsync({ type: 'blob' }), filename: `signsync-training-${approved.length}x-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`, report }
}
