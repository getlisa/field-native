/**
 * Audio module exports
 */

export type {
  AudioChunkData,
  AudioConfig,
  IAudioProcessor,
  AudioRecorderCallbacks,
  AudioRecorderConfig,
} from './types';

export { createAudioProcessor, getNativeAudioConfig } from './processors';
export { AudioRecorder, type AudioRecorderOptions } from './AudioRecorder';

