import { useEffect, useState } from 'react'
import { useDatasetRecorder } from '../../hooks/useDatasetRecorder'
import PageHeader from '../layout/PageHeader'
import Card from '../shared/Card'
import CollectorCameraPreview from './CollectorCameraPreview'
import LabelPicker from './LabelPicker'
import RecordingControls from './RecordingControls'
import CameraDiagnostics from './CameraDiagnostics'
import SequenceList from './SequenceList'

export default function SignSampleCollector({ onLocked }: { onLocked: (locked: boolean) => void }) {
  const [durationLimitMs, setDurationLimitMs] = useState<number | undefined>()
  const recorder = useDatasetRecorder({ scope: 'training', signsOnly: true, durationLimitMs })
  const locked = recorder.isRecording || recorder.countdown !== null
  useEffect(() => { onLocked(locked); return () => onLocked(false) }, [locked, onLocked])
  return <div>
    <PageHeader title="Sign Language Collector" description="Record individual sign samples. Save and export hand and pose landmarks." />
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,7fr)_minmax(320px,3fr)] gap-4 items-start">
      <CollectorCameraPreview feed={recorder.feed} countdown={recorder.countdown} />
      <div className="space-y-4">
        <Card><div className="space-y-4">
          <fieldset disabled={locked}>
            <LabelPicker knownLabels={recorder.knownLabels} selectedLabel={recorder.selectedLabel} onSelectLabel={recorder.setSelectedLabel} disabled={locked} />
          </fieldset>
          <RecordingControls isRecording={recorder.isRecording} frameCount={recorder.frameCount} processedFramesRef={recorder.processedFramesRef}
            durationLimitMs={durationLimitMs} onChangeDurationLimitMs={setDurationLimitMs}
            canRecord={recorder.feed.enabled && recorder.feed.cameraReady && !!recorder.selectedLabel.trim()}
            countdown={recorder.countdown} countdownSeconds={recorder.countdownSeconds} onChangeCountdownSeconds={recorder.setCountdownSeconds}
            onStart={recorder.startRecording} onCancelCountdown={recorder.cancelCountdown} onStop={recorder.stopRecording} onDiscard={recorder.discardRecording} />
          <CameraDiagnostics feed={recorder.feed} detectionInputWidth={recorder.detectionInputWidth} onChangeInputWidth={recorder.setDetectionInputWidth} locked={locked} />
          {!recorder.feed.enabled && <p className="text-sm text-text-2">Start the camera above before recording a sample.</p>}
          {recorder.saveError && <p role="alert" className="text-sm text-danger">{recorder.saveError}</p>}
        </div></Card>
        <SequenceList sequences={recorder.sequences} onDelete={recorder.removeSequence} onExport={recorder.exportDataset}
          onExportZip={recorder.exportPerSampleZip} onDownloadZip={recorder.downloadZip}
          isExportingZip={recorder.isExportingZip} zipReady={recorder.zipReady} exportError={recorder.exportError} onClearAll={recorder.clearAll} />
      </div>
    </div>
  </div>
}
