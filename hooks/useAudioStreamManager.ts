/**
 * useAudioStreamManager - Native PCM16 audio streaming with gapless playback
 * 
 * Uses native audio APIs for reliable continuous streaming:
 * - iOS: AVAudioEngine + AVAudioPlayerNode
 * - Android: AudioTrack with coroutine-based playback
 * - Direct PCM16 streaming (no WAV conversion needed)
 * - Gapless playback with native buffering
 */

import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

// Import native module using the new requireNativeModule API (from properly scaffolded module)
// The module will automatically use the web stub on web platform
import ExpoPcmAudioPlayer from 'expo-pcm-audio-player';

interface AudioStreamConfig {
  sampleRate: number;
  channels: number;
  bitDepth: 16;
  bufferDurationMs?: number; // Buffer size in ms (default 500ms)
  minBufferChunks?: number;  // Minimum chunks to buffer before starting (default 2)
}

interface AudioStreamManager {
  initialize(): Promise<void>;
  playChunk(base64Data: string): Promise<void>;
  stop(): Promise<void>;
  flush(): Promise<void>;
  isPlaying(): boolean;
  getBufferStatus(): { buffered: number; playing: boolean };
}

export function useAudioStreamManager(
  config: AudioStreamConfig = { 
    sampleRate: 16000, 
    channels: 1, 
    bitDepth: 16,
    bufferDurationMs: 500,
    minBufferChunks: 2
  }
): AudioStreamManager {
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Refs
  const isStopped = useRef(false);
  const isPlayingRef = useRef(false);
  const bufferedCountRef = useRef(0);
  const statusCheckInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initialize native audio player
  const initialize = async () => {
    try {
      isStopped.current = false;
      isPlayingRef.current = false;
      bufferedCountRef.current = 0;

      if (Platform.OS !== 'web') {
        // Initialize native module with configuration
        await ExpoPcmAudioPlayer.initialize({
          sampleRate: config.sampleRate,
          channels: config.channels,
          bitDepth: config.bitDepth,
        });
      }

      setIsInitialized(true);
      console.log(`[AudioStreamManager] ✅ Initialized (native module, sampleRate: ${config.sampleRate})`);
    } catch (error) {
      console.error('[AudioStreamManager] Failed to initialize:', error);
      throw error;
    }
  };

  // Start status polling
  const startStatusPolling = () => {
    if (statusCheckInterval.current) return;
    
    statusCheckInterval.current = setInterval(async () => {
      if (isStopped.current || Platform.OS === 'web') return;
      
      try {
        const status = await ExpoPcmAudioPlayer.getStatus();
        isPlayingRef.current = status.isPlaying;
        bufferedCountRef.current = status.buffered;
      } catch (error) {
        // Ignore status check errors
      }
    }, 200); // Check every 200ms
  };

  // Stop status polling
  const stopStatusPolling = () => {
    if (statusCheckInterval.current) {
      clearInterval(statusCheckInterval.current);
      statusCheckInterval.current = null;
    }
  };

  // Stream audio chunk directly to native module
  const playChunk = async (base64Data: string) => {
    if (isStopped.current || Platform.OS === 'web') return;

    try {
      // Stream directly to native module (no WAV conversion needed)
      await ExpoPcmAudioPlayer.streamChunk(base64Data);

      // Auto-start playback if not already playing
      if (!isPlayingRef.current && !isStopped.current) {
        await ExpoPcmAudioPlayer.start();
        isPlayingRef.current = true;
        startStatusPolling();
      }
    } catch (error) {
      console.error('[AudioStreamManager] Error streaming chunk:', error);
    }
  };

  // Flush remaining buffer (no-op for native implementation)
  const flush = async () => {
    if (Platform.OS === 'web' || isStopped.current) return;
    
    // Native implementation handles buffering automatically
    // This is a no-op but kept for API compatibility
    console.log('[AudioStreamManager] 🔄 Flush called (native module handles buffering automatically)');
  };

  // Stop playback
  const stop = async () => {
    console.log('[AudioStreamManager] 🛑 Stopping audio stream');
    isStopped.current = true;
    isPlayingRef.current = false;
    stopStatusPolling();

    if (Platform.OS !== 'web') {
      try {
        await ExpoPcmAudioPlayer.stop();
      } catch (error) {
        console.error('[AudioStreamManager] Error stopping playback:', error);
      }
    }
  };

  // Check if playing
  const isPlaying = () => {
    if (isStopped.current) return false;
    return isPlayingRef.current;
  };

  // Get buffer status
  const getBufferStatus = () => {
    return {
      buffered: bufferedCountRef.current,
      playing: isPlayingRef.current && !isStopped.current
    };
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopStatusPolling();
      if (isInitialized && Platform.OS !== 'web') {
        ExpoPcmAudioPlayer.stop().catch(console.error);
      }
    };
  }, [isInitialized]);

  return {
    initialize,
    playChunk,
    stop,
    flush,
    isPlaying,
    getBufferStatus,
  };
}