import { AlertTriangle } from "lucide-react";
import PageHeader from "../components/layout/PageHeader";
import Card from "../components/shared/Card";
import CollectorCameraPreview from "../components/collector/CollectorCameraPreview";
import LabelPicker from "../components/collector/LabelPicker";
import RecordingControls from "../components/collector/RecordingControls";
import SequenceList from "../components/collector/SequenceList";
import { useDatasetRecorder } from "../hooks/useDatasetRecorder";

// Camera -> MediaPipe Hands + Pose -> Synchronized landmarks -> Dataset
// Collector -> Labeled sequences -> Exported dataset. Everything upstream
// (useCameraFeed's detection loop, the skeleton overlay) is untouched -
// this page only adds what to do with the frames it already produces:
// label them, buffer them while recording, and save/export the result.
export default function DatasetCollectorPage() {
  const {
    feed,
    sequences,
    knownLabels,
    selectedLabel,
    setSelectedLabel,
    isRecording,
    frameCount,
    saveError,
    startRecording,
    stopRecording,
    discardRecording,
    removeSequence,
    clearAll,
    exportDataset,
  } = useDatasetRecorder();

  const canRecord = feed.enabled && feed.cameraReady && !!selectedLabel.trim();

  return (
    <div>
      <PageHeader
        title="Dataset Collector"
        description="Record labeled hand + pose landmark sequences to build the training dataset for sign recognition."
      />

      <div className="grid grid-cols-[5fr_3fr] gap-4 items-start">
        <CollectorCameraPreview feed={feed} />

        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex flex-col gap-4">
              <LabelPicker
                knownLabels={knownLabels}
                selectedLabel={selectedLabel}
                onSelectLabel={setSelectedLabel}
                disabled={isRecording}
              />

              <RecordingControls
                isRecording={isRecording}
                frameCount={frameCount}
                canRecord={canRecord}
                onStart={startRecording}
                onStop={stopRecording}
                onDiscard={discardRecording}
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
              onClearAll={clearAll}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
