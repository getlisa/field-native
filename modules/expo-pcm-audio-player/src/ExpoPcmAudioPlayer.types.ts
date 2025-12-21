export type ExpoPcmAudioPlayerModuleEvents = {};

export type ExpoPcmAudioPlayerModule = {
  /**
   * Initialize the audio player with configuration
   * @param config - Audio configuration (sampleRate, channels, bitDepth)
   */
  initialize(config: {
    sampleRate: number;
    channels: number;
    bitDepth: number;
  }): Promise<void>;

  /**
   * Stream a base64-encoded PCM16 audio chunk
   * @param base64Data - Base64-encoded PCM16 audio data
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
   * Set playback volume
   * @param volume - Volume level (0-100)
   */
  setVolume(volume: number): Promise<void>;

  /**
   * Get playback status
   */
  getStatus(): Promise<{
    isPlaying: boolean;
    buffered: number;
  }>;
};
