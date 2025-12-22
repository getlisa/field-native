// Web stub for ExpoLiveAudioModule
// Audio recording is not supported on web platform
import { AudioConfig, AudioSessionConfig } from './ExpoLiveAudio.types';

const ExpoLiveAudioModule = {
  init(_config: AudioConfig) {
    console.warn('[ExpoLiveAudio] Native audio recording is not supported on web');
  },
  
  async start() {
    console.warn('[ExpoLiveAudio] Native audio recording is not supported on web');
  },
  
  stop() {
    console.warn('[ExpoLiveAudio] Native audio recording is not supported on web');
  },
  
  async configureAudioSession(_config: AudioSessionConfig) {
    console.warn('[ExpoLiveAudio] configureAudioSession is not supported on web');
  },
};

export default ExpoLiveAudioModule;
