import { AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";
import CameraDiagnostics from "../components/collector/CameraDiagnostics";
import PageHeader from "../components/layout/PageHeader";
import Card from "../components/shared/Card";
import CollectorCameraPreview from "../components/collector/CollectorCameraPreview";
import LabelPicker from "../components/collector/LabelPicker";
import RecordingControls from "../components/collector/RecordingControls";
import SequenceList from "../components/collector/SequenceList";
import { useDatasetRecorder } from "../hooks/useDatasetRecorder";
import { createIdleMetadata, IDLE_DURATION_MS, IDLE_LABEL } from "../services/dataset/idleCollection";

// Camera -> MediaPipe Hands + Pose -> Synchronized landmarks -> Dataset
// Collector -> Labeled sequences -> Exported dataset. Everything upstream
// (useCameraFeed's detection loop, the skeleton overlay) is untouched -
// this page only adds what to do with the frames it already produces:
// label them, buffer them while recording, and save/export the result.
export default function DatasetCollectorPage() {
  const [mode, setMode] = useState<'sign' | 'idle'>('sign');
  const [lastSignLabel, setLastSignLabel] = useState('HELLO');
  const collection = useMemo(() => mode === 'idle'
    ? createIdleMetadata() : undefined,
  [mode]);
  const {
    feed,
    detectionInputWidth,
    setDetectionInputWidth,
    processedFramesRef,
    sequences,
    knownLabels,
    selectedLabel,
    setSelectedLabel,
    isRecording,
    frameCount,
    saveError,
    countdown,
    countdownSeconds,
    setCountdownSeconds,
    startRecording,
    cancelCountdown,
    stopRecording,
    discardRecording,
    removeSequence,
    clearAll,
    exportDataset,
    exportPerSampleZip,
    downloadZip,
    isExportingZip,
    zipReady,
    exportError,
  } = useDatasetRecorder({
    collection,
    recordingAllowed: mode === 'sign' || !!collection,
    durationLimitMs: mode === 'idle' ? IDLE_DURATION_MS : undefined,
  });

  const locked = isRecording || countdown !== null;
  const canRecord = feed.enabled && feed.cameraReady && !!selectedLabel.trim()
    && (mode === 'sign' || !!collection);
  const signLabels = useMemo(() => knownLabels.filter(label => label !== IDLE_LABEL && !label.startsWith('IDLE_')), [knownLabels]);

  function selectMode(nextMode: 'sign' | 'idle') {
    if (locked || nextMode === mode) return;
    if (mode === 'sign') setLastSignLabel(selectedLabel);
    setMode(nextMode);
    setSelectedLabel(nextMode === 'idle' ? IDLE_LABEL : lastSignLabel);
  }

  return (
    <div>
      <PageHeader
        title="Dataset Collector"
        description="Record sign or idle samples. Save and export hand + pose landmarks."
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,7fr)_minmax(320px,3fr)] gap-4 items-start">
        <div className="min-w-0 flex flex-col gap-4">
          <CollectorCameraPreview feed={feed} countdown={countdown} />
          {mode === 'idle' && (
              <Card>
                <details>
                  <summary className="cursor-pointer text-sm font-semibold">View posture and palm guides</summary>
                  <img src="/guides/idle-hand/half-body-resting-postures-v1.png" alt="Half-body views of hands beside the torso, near the waist and in front of the lower abdomen" loading="lazy" className="mt-3 w-full rounded-lg" />
                  <img src="/guides/idle-hand/palm-orientation-v1.png" alt="Natural inward-facing hands and an optional relaxed palm-visible variation, held below the chest" loading="lazy" className="mt-3 w-full rounded-lg" />
                  <img src="/guides/idle-hand/one-hand-idle-posture.png" alt="One hand and idle posture" loading="lazy" className="mt-3 w-full rounded-lg" />
                </details>
              </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex flex-col gap-4">
              <div className="flex gap-2" role="group" aria-label="Recording type">
                {(['sign', 'idle'] as const).map(value => (
                  <button key={value} type="button" disabled={locked} aria-pressed={mode === value}
                    onClick={() => selectMode(value)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-60 ${mode === value ? 'border-signal bg-signal-light text-ink' : 'border-border text-text-2'}`}>
                    {value === 'sign' ? 'Sign samples' : 'Idle samples'}
                  </button>
                ))}
              </div>
              {mode === 'idle' ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-semibold text-ink">Label: IDLE</p>
                  <p className="text-sm text-text-2">Recording stops and saves automatically after 3 seconds.</p>
                </div>
              ) : (
                <fieldset disabled={locked}>
                  <LabelPicker
                    knownLabels={signLabels}
                    selectedLabel={selectedLabel}
                    onSelectLabel={setSelectedLabel}
                    disabled={locked}
                  />
                </fieldset>
              )}

              <RecordingControls
                isRecording={isRecording}
                frameCount={frameCount}
                processedFramesRef={processedFramesRef}
                canRecord={canRecord}
                countdown={countdown}
                countdownSeconds={countdownSeconds}
                onChangeCountdownSeconds={setCountdownSeconds}
                onStart={startRecording}
                onCancelCountdown={cancelCountdown}
                onStop={stopRecording}
                onDiscard={discardRecording}
              />

              <CameraDiagnostics
                feed={feed}
                detectionInputWidth={detectionInputWidth}
                onChangeInputWidth={setDetectionInputWidth}
                locked={isRecording || countdown !== null}
              />

              {!feed.enabled && (
                <p className="text-sm text-text-2">
                  Start the camera above before recording a sample.
                </p>
              )}

              {saveError && (
                <div className="bg-danger-light text-[#a3372f] text-sm font-medium px-3 py-2 rounded-lg flex items-center gap-2">
                  <AlertTriangle size={14} />
                  {saveError}
                </div>
              )}
            </div>
          </Card>
          
          <div className="flex flex-col gap-4">
            <SequenceList
              sequences={sequences}
              onDelete={removeSequence}
              onExport={exportDataset}
              onExportZip={exportPerSampleZip}
              onDownloadZip={downloadZip}
              isExportingZip={isExportingZip}
              zipReady={zipReady}
              exportError={exportError}
              onClearAll={clearAll}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
