import { NativeModule, requireNativeModule } from 'expo';

import { ExpoLiveAudioModuleEvents, AudioConfig, AudioSessionConfig } from './ExpoLiveAudio.types';

declare class ExpoLiveAudioModule extends NativeModule<ExpoLiveAudioModuleEvents> {
  /**
   * Initialize the audio recorder with configuration
   */
  init(config: AudioConfig): void;

  /**
   * Start audio recording
   */
  start(): Promise<void>;

  /**
   * Stop audio recording
   */
  stop(): Promise<void>;

  /**
   * Configure audio session (iOS only)
   */
  configureAudioSession(config: AudioSessionConfig): Promise<void>;
}

// This call loads the native module object from the JSI.
export default requireNativeModule<ExpoLiveAudioModule>('ExpoLiveAudio');
