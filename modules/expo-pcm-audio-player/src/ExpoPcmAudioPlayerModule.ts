import { NativeModule, requireNativeModule } from 'expo';

import { ExpoPcmAudioPlayerModuleEvents } from './ExpoPcmAudioPlayer.types';

declare class ExpoPcmAudioPlayerModule extends NativeModule<ExpoPcmAudioPlayerModuleEvents> {
  /**
   * Initialize the audio player with configuration
   */
  initialize(config: {
    sampleRate: number;
    channels: number;
    bitDepth: number;
  }): Promise<void>;

  /**
   * Stream a base64-encoded PCM16 audio chunk
   */
  streamChunk(base64Data: string): Promise<void>;

  /**
   * Start or resume audio playback
   */
  start(): Promise<void>;

  /**
   * Pause audio playback (keeps buffer)
   */
  pause(): Promise<void>;

  /**
   * Stop playback and clear buffer
   */
  stop(): Promise<void>;

  /**
   * Flush remaining buffered chunks
   */
  flush(): Promise<void>;

  /**
   * Set playback volume (0-100)
   */
  setVolume(volume: number): Promise<void>;

  /**
   * Get playback status
   */
  getStatus(): Promise<{
    isPlaying: boolean;
    buffered: number;
  }>;
}

// This call loads the native module object from the JSI.
export default requireNativeModule<ExpoPcmAudioPlayerModule>('ExpoPcmAudioPlayer');
