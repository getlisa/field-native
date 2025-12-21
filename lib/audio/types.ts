/**
 * Audio module type definitions
 */

export interface AudioChunkData {
  /** Base64-encoded PCM16 audio data */
  base64: string;
  /** Size in bytes of the raw PCM16 data */
  byteSize: number;
  /** RMS value for debugging (0-32768) */
  rms?: number;
}

export interface AudioConfig {
  sampleRate: number;
  channels: 1 | 2;
  bitsPerSample: 8 | 16;
  bufferSize: number;
}

export interface IAudioProcessor {
  /**
   * Process raw audio data from the native module into a standard format
   * @param rawData - Raw data from the native audio module (varies by platform)
   * @returns Processed audio chunk with base64 data
   */
  processChunk(rawData: unknown): AudioChunkData | null;

  /**
   * Get the audio configuration for this platform
   */
  getConfig(): AudioConfig;
}

export interface AudioRecorderCallbacks {
  onAudioChunk: (data: AudioChunkData) => void;
  onError?: (error: Error) => void;
  onStatusChange?: (isRecording: boolean) => void;
}

export interface AudioRecorderConfig {
  /** Enable background task (Android only) */
  enableBackgroundTask?: boolean;
  /** Enable verbose RMS logging */
  debugRms?: boolean;
  /** Job ID for deep linking from background service notification */
  jobId?: string;
}

