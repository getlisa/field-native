export type AudioConfig = {
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
  bufferSize?: number;
  wavFile?: string;
  // Android specific
  audioSource?: number;
  // iOS specific
  audioQuality?: string;
  audioMode?: string;
  enableBuiltInEQ?: boolean;
};

export type AudioSessionConfig = {
  category?: string;
  mode?: string;
  allowBluetooth?: boolean;
  allowBluetoothA2DP?: boolean;
};

export type AudioChunkEventPayload = {
  data: string; // base64 encoded PCM16 audio data
};

export type ExpoLiveAudioModuleEvents = {
  onAudioChunk: (params: AudioChunkEventPayload) => void;
  onStarted: () => void;
  onStopped: () => void;
  onError: (params: { error: string }) => void;
};

export type ExpoLiveAudioViewProps = {
  url?: string;
  onLoad?: (event: { nativeEvent: { url: string } }) => void;
};
