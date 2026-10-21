import { useEffect, useState } from "react";
import { useDatasetRecorder } from "../../hooks/useDatasetRecorder";
import PageHeader from "../layout/PageHeader";
import Card from "../shared/Card";
import CollectorCameraPreview from "./CollectorCameraPreview";
import LabelPicker from "./LabelPicker";
import RecordingControls from "./RecordingControls";
import CameraDiagnostics from "./CameraDiagnostics";
import SequenceList from "./SequenceList";
import VideoUploadCollector from "./VideoUploadCollector";
import CameraVideoRecorder from "./CameraVideoRecorder";
import type { PreservedVideoTake } from "./PendingVideoRecordings";

export default function SignSampleCollector({
  onLocked,
}: {
  onLocked: (locked: boolean) => void;
}) {
  const [durationLimitMs, setDurationLimitMs] = useState<number | undefined>();
  const [mode, setMode] = useState<"camera" | "upload">("camera");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [videoControls, setVideoControls] = useState<HTMLDivElement | null>(null);
  const [cameraMethod, setCameraMethod] = useState<"video" | "live">("video");
  const [pendingVideos, setPendingVideos] = useState<PreservedVideoTake[]>([]);
  const [incoming, setIncoming] = useState<
    { id: string; file: File; label: string; fps: number }[]
  >([]);
  const recorder = useDatasetRecorder({
    scope: "training",
    signsOnly: true,
    durationLimitMs,
  });
  const locked =
    recorder.isRecording ||
    recorder.countdown !== null ||
    uploadBusy ||
    cameraBusy;
  useEffect(() => {
    onLocked(locked);
    return () => onLocked(false);
  }, [locked, onLocked]);
  const settings = (
    <Card>
      <div className="grid gap-4">
        <fieldset
          disabled={
            recorder.isRecording || recorder.countdown !== null || cameraBusy
          }
        >
          <LabelPicker
            knownLabels={recorder.knownLabels}
            selectedLabel={recorder.selectedLabel}
            onSelectLabel={recorder.setSelectedLabel}
            disabled={
              recorder.isRecording ||
              recorder.countdown !== null ||
              cameraBusy
            }
          />
        </fieldset>
        <div>
          <p className="text-sm font-semibold text-text-2 mb-2.5">
            Collection source
          </p>
          <div
            role="group"
            aria-label="Collection source"
            className="inline-flex gap-1 rounded-lg bg-sky border border-border p-1"
          >
            {(["camera", "upload"] as const).map((value) => (
              <button
                key={value}
                disabled={locked}
                aria-pressed={mode === value}
                className={`rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal ${mode === value ? "bg-white text-ink shadow-sm ring-1 ring-border" : "text-text-2 hover:bg-white"}`}
                onClick={() => {
                  if (value === "upload" && recorder.feed.enabled)
                    recorder.feed.toggleCamera();
                  setMode(value);
                }}
              >
                {value === "camera" ? "Camera" : "Upload videos"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
  const recordedSamples = (
    <SequenceList
      collapsible
      pendingVideos={pendingVideos}
      pendingLocked={locked}
      onRemoveVideo={id => setPendingVideos(previous => previous.filter(take => take.id !== id))}
      onProcessVideos={() => {
        if (locked || !pendingVideos.length) return;
        setIncoming(previous => [...previous, ...pendingVideos]);
        setPendingVideos([]);
        if (recorder.feed.enabled) recorder.feed.toggleCamera();
        setMode("upload");
      }}
      sequences={recorder.sequences}
      onDelete={recorder.removeSequence}
      onExport={recorder.exportDataset}
      onExportZip={recorder.exportPerSampleZip}
      onDownloadZip={recorder.downloadZip}
      isExportingZip={recorder.isExportingZip}
      zipReady={recorder.zipReady}
      exportError={recorder.exportError}
      onClearAll={recorder.clearAll}
    />
  );
  return (
    <div>
      <PageHeader
        title="Sign Language Collector"
        description="Choose a label, add your recordings, then review and save each take."
      />
      <div>
        <div hidden={mode !== "upload"}>
          <VideoUploadCollector
            controls={settings}
            recordedSamples={recordedSamples}
            incoming={incoming}
            onIncomingConsumed={(ids) =>
              setIncoming((previous) =>
                previous.filter((item) => !ids.includes(item.id)),
              )
            }
            label={recorder.selectedLabel}
            sequences={recorder.sequences}
            onSaved={recorder.refreshSequences}
            onBusy={setUploadBusy}
          />
        </div>
        {mode === "camera" && <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)] gap-4 items-start">
          <div className="min-w-0 space-y-4">
          {cameraMethod === "video" ? (
            <CameraVideoRecorder
              label={recorder.selectedLabel}
              onBusy={setCameraBusy}
              controlsContainer={videoControls}
              countdownSeconds={recorder.countdownSeconds}
              onChangeCountdownSeconds={recorder.setCountdownSeconds}
              durationLimitMs={durationLimitMs}
              onChangeDurationLimitMs={setDurationLimitMs}
              onRecorded={(file, label, fps) => {
                setPendingVideos((previous) => [
                  ...previous,
                  { id: crypto.randomUUID(), file, label, fps },
                ]);
              }}
            />
          ) : (
            <CollectorCameraPreview
              feed={recorder.feed}
              countdown={recorder.countdown}
            />
          )}
          </div>
        <div className="space-y-4">
          {settings}
          {mode === "camera" && (
            <Card>
              <div className="space-y-4">
                <label className="block text-sm">
                  Camera collection method
                  <select
                    className="block border rounded p-2 w-full"
                    disabled={locked}
                    value={cameraMethod}
                    onChange={(event) => {
                      if (recorder.feed.enabled) recorder.feed.toggleCamera();
                      setCameraMethod(event.target.value as "video" | "live");
                    }}
                  >
                    <option value="video">
                      Preserve video, process afterward
                    </option>
                    <option value="live">
                      Live landmarks (existing workflow)
                    </option>
                  </select>
                </label>
                {cameraMethod === "video" && <div ref={setVideoControls} />}
                {cameraMethod === "live" && (
                  <>
                    <RecordingControls
                      isRecording={recorder.isRecording}
                      frameCount={recorder.frameCount}
                      processedFramesRef={recorder.processedFramesRef}
                      durationLimitMs={durationLimitMs}
                      onChangeDurationLimitMs={setDurationLimitMs}
                      canRecord={
                        recorder.feed.enabled &&
                        recorder.feed.cameraReady &&
                        !!recorder.selectedLabel.trim()
                      }
                      countdown={recorder.countdown}
                      countdownSeconds={recorder.countdownSeconds}
                      onChangeCountdownSeconds={recorder.setCountdownSeconds}
                      onStart={recorder.startRecording}
                      onCancelCountdown={recorder.cancelCountdown}
                      onStop={recorder.stopRecording}
                      onDiscard={recorder.discardRecording}
                    />
                    <CameraDiagnostics
                      feed={recorder.feed}
                      detectionInputWidth={recorder.detectionInputWidth}
                      onChangeInputWidth={recorder.setDetectionInputWidth}
                      locked={locked}
                    />
                    {!recorder.feed.enabled && (
                      <p className="text-sm text-text-2">
                        Start the camera above before recording a sample.
                      </p>
                    )}
                    {recorder.saveError && (
                      <p role="alert" className="text-sm text-danger">
                        {recorder.saveError}
                      </p>
                    )}
                  </>
                )}
              </div>
            </Card>
          )}
          {recordedSamples}
        </div>
        </div>}
      </div>
    </div>
  );
}
