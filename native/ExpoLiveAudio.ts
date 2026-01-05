/* native/ExpoLiveAudio.ts
 *
 * JS wrapper for the native Expo module "ExpoLiveAudio".
 * Provides a drop-in compatible API for `react-native-live-audio-stream` usage in AudioRecorder.
 * 
 * Based on Expo Modules API documentation:
 * https://docs.expo.dev/modules/android-lifecycle-listeners/#typescript-interface-and-react-usage
 */

import { requireNativeModule, NativeModule } from 'expo-modules-core';

// Event payload types
type AudioChunkEvent = {
  data: string;
};

type ErrorEvent = {
  error: string;
};

// Define all events that the native module emits
type ExpoLiveAudioModuleEvents = {
  onAudioChunk(event: AudioChunkEvent): void;
  onStarted(event: {}): void;
  onStopped(event: {}): void;
  onError(event: ErrorEvent): void;
  onInterruptionBegan(event: {}): void;
  onInterruptionEnded(event: { shouldResume: boolean }): void;
};

// Declare the native module class with proper typing
declare class ExpoLiveAudioNativeModule extends NativeModule<ExpoLiveAudioModuleEvents> {
  init(config: {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
    bufferSize: number;
  }): void;
  
  start(): Promise<void>;
  stop(): void;
  configureAudioSession(options: any): Promise<void>;
}

// Load the native module
const NativeExpoLiveAudio = requireNativeModule<ExpoLiveAudioNativeModule>('ExpoLiveAudio');

// Types for the wrapper API (compatible with react-native-live-audio-stream)
type StartConfig = {
  sampleRate?: number;
  chunkSize?: number;
  channels?: number;
  bitsPerSample?: number;
  bufferSize?: number;
  micMode?: 'communication' | 'mic' | 'camcorder';
  codec?: 'pcm16' | 'opus' | 'none';
  audioMode?: string;
  audioQuality?: string;
  enableBuiltInEQ?: boolean;
  wavFile?: string;
};

type AudioChunkHandler = (data: string) => void;

// Map to store subscriptions for cleanup
const activeSubscriptions = new Map<AudioChunkHandler, { remove: () => void }>();

/**
 * Wrapper object that mirrors the API used by AudioRecorder.
 * Wraps the native module to provide react-native-live-audio-stream compatibility.
 */
const ExpoLiveAudio = {
  /**
   * Initialize audio recorder with configuration
   */
  init(config: StartConfig = {}) {
    try {
      NativeExpoLiveAudio.init({
        sampleRate: config.sampleRate || 16000,
        channels: config.channels || 1,
        bitsPerSample: config.bitsPerSample || 16,
        bufferSize: config.bufferSize || 2048,
      });
      
      if (__DEV__) {
        console.log('[ExpoLiveAudio] ✅ init() called with config:', config);
      }
    } catch (err) {
      console.error('[ExpoLiveAudio] init error:', err);
      throw err;
    }
  },

  /**
   * Start recording
   */
  start() {
    try {
      if (__DEV__) {
        console.log('[ExpoLiveAudio] ✅ Calling native start()');
      }
      return NativeExpoLiveAudio.start();
    } catch (err) {
      console.error('[ExpoLiveAudio] start error:', err);
      throw err;
    }
  },

  /**
   * Stop recording
   */
  stop() {
    try {
      NativeExpoLiveAudio.stop();
      if (__DEV__) {
        console.log('[ExpoLiveAudio] ✅ stop() called');
      }
    } catch (err) {
      console.error('[ExpoLiveAudio] stop error:', err);
    }
  },

  /**
   * Configure audio session (iOS only)
   */
  async configureAudioSession(options: any) {
    try {
      await NativeExpoLiveAudio.configureAudioSession(options);
      if (__DEV__) {
        console.log('[ExpoLiveAudio] ✅ configureAudioSession() called');
      }
    } catch (err) {
      console.error('[ExpoLiveAudio] configureAudioSession error:', err);
    }
  },

  /**
   * Add event listener (compatible with react-native-live-audio-stream API)
   * Maps friendly event names to native event names
   */
  on(eventName: string, handler: AudioChunkHandler) {
    // Map 'data' -> native event 'onAudioChunk'
    if (eventName === 'data') {
      const wrappedHandler = (event: AudioChunkEvent) => {
        if (__DEV__) {
          // console.log('[ExpoLiveAudio] 📥 Received onAudioChunk, data length:', event?.data?.length || 0);
        }
        
        const audioData = event?.data;
        if (audioData) {
          handler(audioData);
        } else if (__DEV__) {
          console.warn('[ExpoLiveAudio] ⚠️ Received event without data field:', event);
        }
      };

      const subscription = NativeExpoLiveAudio.addListener('onAudioChunk', wrappedHandler);
      activeSubscriptions.set(handler, subscription);
      
      if (__DEV__) {
        console.log('[ExpoLiveAudio] ✅ Added listener for "data" event (mapped to onAudioChunk)');
      }
      
      return subscription;
    }

    // Map other friendly names
    if (eventName === 'started') {
      const subscription = NativeExpoLiveAudio.addListener('onStarted', handler as any);
      activeSubscriptions.set(handler, subscription);
      return subscription;
    }
    
    if (eventName === 'stopped') {
      const subscription = NativeExpoLiveAudio.addListener('onStopped', handler as any);
      activeSubscriptions.set(handler, subscription);
      return subscription;
    }
    
    if (eventName === 'error') {
      const subscription = NativeExpoLiveAudio.addListener('onError', handler as any);
      activeSubscriptions.set(handler, subscription);
      return subscription;
    }

    // Audio interruption events (iOS/Android)
    if (eventName === 'onInterruptionBegan') {
      const subscription = NativeExpoLiveAudio.addListener('onInterruptionBegan', handler as any);
      activeSubscriptions.set(handler, subscription);
      if (__DEV__) {
        console.log('[ExpoLiveAudio] ✅ Added listener for "onInterruptionBegan" event');
      }
      return subscription;
    }

    if (eventName === 'onInterruptionEnded') {
      const subscription = NativeExpoLiveAudio.addListener('onInterruptionEnded', handler as any);
      activeSubscriptions.set(handler, subscription);
      if (__DEV__) {
        console.log('[ExpoLiveAudio] ✅ Added listener for "onInterruptionEnded" event');
      }
      return subscription;
    }

    if (__DEV__) {
      console.warn(`[ExpoLiveAudio] ⚠️ Unknown event name: ${eventName}`);
    }
  },

  /**
   * Remove listener - call remove() on the subscription
   */
  removeListener(eventName: string, handler: AudioChunkHandler) {
    const subscription = activeSubscriptions.get(handler);
    if (subscription) {
      subscription.remove();
      activeSubscriptions.delete(handler);
      if (__DEV__) {
        console.log(`[ExpoLiveAudio] ✅ Removed listener for "${eventName}"`);
      }
    } else if (__DEV__) {
      console.warn(`[ExpoLiveAudio] ⚠️ No subscription found for handler on event "${eventName}"`);
    }
  },

  /**
   * Alias for removeListener
   */
  off(eventName: string, handler: AudioChunkHandler) {
    this.removeListener(eventName, handler);
  },

  /**
   * Check if native module is available
   */
  isNativeAvailable(): boolean {
    return !!NativeExpoLiveAudio;
  },

  /**
   * Expose the raw native module for advanced usage
   */
  get __nativeModule() {
    return NativeExpoLiveAudio;
  },
};

export default ExpoLiveAudio;
