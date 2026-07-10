// A single incremental update from the speech recognition engine — mirrors
// the shape of the Web Speech API's SpeechRecognitionResult closely enough
// that swapping the mock for the real thing needs no consumer changes.
export interface TranscriptUpdate {
  text: string
  isFinal: boolean
}
