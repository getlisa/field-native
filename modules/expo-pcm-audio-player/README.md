# expo-pcm-audio-player

Native PCM audio streaming module for Expo. Streams base64-encoded PCM16 audio chunks in real-time with gapless playback on iOS and Android.

## Features

- ✅ Gapless playback using native audio APIs
- ✅ Low latency streaming
- ✅ Direct PCM16 support (no WAV conversion needed)
- ✅ iOS: AVAudioEngine + AVAudioPlayerNode
- ✅ Android: AudioTrack with coroutine-based playback

## Installation

```bash
npm install ./modules/expo-pcm-audio-player
```

## Usage

```typescript
import ExpoPcmAudioPlayer from 'expo-pcm-audio-player';

// Initialize
await ExpoPcmAudioPlayer.initialize({
  sampleRate: 16000,
  channels: 1,
  bitDepth: 16,
});

// Stream audio chunks
await ExpoPcmAudioPlayer.streamChunk(base64PcmData);

// Control playback
await ExpoPcmAudioPlayer.start();
await ExpoPcmAudioPlayer.pause();
await ExpoPcmAudioPlayer.stop();
```
