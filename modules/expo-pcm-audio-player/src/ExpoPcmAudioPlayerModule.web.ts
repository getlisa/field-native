// Web stub for ExpoPcmAudioPlayerModule
// This file replaces ExpoPcmAudioPlayerModule.ts on web builds
const ExpoPcmAudioPlayerModule = {
  async initialize() {
    console.warn('[ExpoPcmAudioPlayer] Native PCM audio streaming is not supported on web');
  },
  async streamChunk() {
    console.warn('[ExpoPcmAudioPlayer] Native PCM audio streaming is not supported on web');
  },
  async start() {
    console.warn('[ExpoPcmAudioPlayer] Native PCM audio streaming is not supported on web');
  },
  async pause() {
    console.warn('[ExpoPcmAudioPlayer] Native PCM audio streaming is not supported on web');
  },
  async stop() {
    console.warn('[ExpoPcmAudioPlayer] Native PCM audio streaming is not supported on web');
  },
  async flush() {
    console.warn('[ExpoPcmAudioPlayer] Native PCM audio streaming is not supported on web');
  },
  async setVolume() {
    console.warn('[ExpoPcmAudioPlayer] Native PCM audio streaming is not supported on web');
  },
  async getStatus() {
    return { isPlaying: false, buffered: 0 };
  },
};

export default ExpoPcmAudioPlayerModule;

