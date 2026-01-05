/**
 * AudioRecorder.ts - Real-time audio streaming for React Native
 *
 * Uses react-native-live-audio-stream for continuous PCM16 audio streaming.
 * Handles platform-specific data formats via IAudioProcessor.
 *
 * Background support via:
 * - iOS: UIBackgroundModes: audio (in app.json)
 * - Android: react-native-background-actions foreground service
 */

import { AppState, type AppStateStatus, PermissionsAndroid, Platform } from 'react-native';
import { Buffer } from 'buffer';
import { createAudioProcessor, getNativeAudioConfig } from './processors';
import type { AudioChunkData, AudioRecorderCallbacks, AudioRecorderConfig, IAudioProcessor } from './types';

// Native modules (may be null in Expo Go)
let BackgroundActions: any = null;
let LiveAudioStream: any = null;

try {
  BackgroundActions = require('react-native-background-actions').default;
} catch {
  console.warn('[Audio] react-native-background-actions not available (requires dev build)');
}

// Prefer native ExpoLiveAudio wrapper, fallback to original lib if needed
try {
  LiveAudioStream = require('@/native/ExpoLiveAudio').default;
} catch {
  try {
    LiveAudioStream = require('react-native-live-audio-stream').default;
  } catch {
    console.warn('[Audio] react-native-live-audio-stream not available (requires dev build)');
  }
}

// Helper function to create background task options with job ID
const createBackgroundTaskOptions = (jobId?: string) => {
  const linkingURI = jobId ? `field://jobs/${jobId}` : 'field://';
  
  if (__DEV__) {
    console.log('[Audio] Creating background task options:', {
      jobId: jobId || 'undefined',
      linkingURI,
      hasJobId: !!jobId,
    });
  }
  
  return {
  taskName: 'AudioRecording',
  taskTitle: 'Recording Audio',
  taskDesc: 'Transcribing your conversation in real-time',
  taskIcon: { name: 'ic_launcher', type: 'mipmap' },
  color: '#0a7ea4',
    linkingURI,
  parameters: { delay: 1000 },
  };
};

export interface AudioRecorderOptions extends AudioRecorderCallbacks, AudioRecorderConfig {
  /** Optional callback when app goes to background */
  onAppBackground?: () => void;
}

export class AudioRecorder {
  private readonly processor: IAudioProcessor;
  private readonly callbacks: AudioRecorderCallbacks;
  private readonly config: AudioRecorderConfig;
  private readonly jobId: string | undefined;
  private readonly onAppBackground?: () => void;

  private isRecording = false;
  private isPaused = false;
  private chunkCount = 0;
  private appStateSubscription: { remove: () => void } | null = null;
  private isBackgroundTaskRunning = false;
  private isListenerAttached = false;
  private silenceInterval: ReturnType<typeof setInterval> | null = null;
  private interruptionListenersAttached = false;
  private audioStateCheckInterval: ReturnType<typeof setInterval> | null = null;
  private lastAudioChunkTime: number = Date.now();
  private pausedByInterruption = false;
  private interruptionStartedAt: number | null = null;
  private interruptionResumeTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(options: AudioRecorderOptions) {
    this.processor = createAudioProcessor();
    this.callbacks = {
      onAudioChunk: options.onAudioChunk,
      onError: options.onError,
      onStatusChange: options.onStatusChange,
    };
    this.config = {
      enableBackgroundTask: options.enableBackgroundTask ?? true,
      debugRms: options.debugRms ?? true,
    };
    this.jobId = options.jobId;
    this.onAppBackground = options.onAppBackground;
    
    if (__DEV__) {
      console.log('[Audio] AudioRecorder created with jobId:', this.jobId || 'undefined');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Check if native audio modules are available
   */
  isNativeModuleAvailable(): boolean {
    return LiveAudioStream !== null;
  }

  /**
   * Check if currently recording
   */
  getIsRecording(): boolean {
    return this.isRecording;
  }

  /**
   * Check if currently paused
   */
  getIsPaused(): boolean {
    return this.isPaused;
  }

  /**
   * Check if background service is running (Android only)
   */
  isBackgroundServiceRunning(): boolean {
    return this.isBackgroundTaskRunning;
  }

  /**
   * Request microphone permissions
   * Uses centralized permission service for consistency
   */
  async requestPermissions(): Promise<boolean> {
    try {
      // Use centralized permission service
      const { getPermissionService } = await import('@/services/permissionService');
      const permissionService = getPermissionService();
      const result = await permissionService.requestMicrophonePermission();
      return result.granted;
    } catch (error) {
      // Fallback to direct permission request if service not available
      console.warn('[Audio] Permission service not available, using fallback:', error);
      if (Platform.OS === 'android') {
        try {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
            {
              title: 'Microphone Permission',
              message: 'This app needs access to your microphone for transcription.',
              buttonPositive: 'OK',
              buttonNegative: 'Cancel',
            }
          );
          return granted === PermissionsAndroid.RESULTS.GRANTED;
        } catch (err) {
          console.error('[Audio] Permission request failed:', err);
          return false;
        }
      }
      // iOS permissions handled via Info.plist
      return true;
    }
  }

  /**
   * Start real-time audio streaming
   */
  async start(): Promise<void> {
    if (this.isRecording) {
      console.warn('[Audio] Already recording');
      return;
    }

    if (!LiveAudioStream) {
      const error = new Error(
        'Audio recording requires a development build. Native modules not available in Expo Go.'
      );
      console.error('[Audio] ❌', error.message);
      this.callbacks.onError?.(error);
      return;
    }

    try {
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        throw new Error('Microphone permission not granted');
      }

      const nativeConfig = getNativeAudioConfig(this.processor);

      if (__DEV__) {
        console.log('[Audio] 🎤 Starting real-time audio stream...');
        console.log('[Audio] → Platform:', Platform.OS);
        console.log('[Audio] → Config:', nativeConfig);
        console.log('[Audio] → JobId:', this.jobId || 'undefined');
      }

      // Configure iOS audio session for optimal transcription clarity
      // MUST be done BEFORE init() and start()
      if (Platform.OS === 'ios' && LiveAudioStream.configureAudioSession) {
        try {
          await LiveAudioStream.configureAudioSession({
            category: 'PlayAndRecord',
            mode: 'VoiceChat', // Best for transcription - optimized for speech frequencies + aggressive noise gating
            allowBluetooth: true,
            allowBluetoothA2DP: true, // Ensures speaker doesn't cause echo
          });
          if (__DEV__) {
            console.log('[Audio] ✅ iOS audio session configured (VoiceChat mode + Hardware Voice Processing)');
            console.log('[Audio] 🎙️ Multi-mic array enabled for noise suppression and null steering');
          }
          
          // Small delay to ensure audio session is fully configured
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
          // This error can happen if audio session is in use
          console.error('[Audio] ❌ Failed to configure iOS audio session:', err);
          // Try to continue anyway - the native module will attempt to activate
          if (__DEV__) {
            console.log('[Audio] ⚠️ Continuing without pre-configuration (native module will configure)');
          }
        }
      }

      // Start Android background service if enabled
      await this.startBackgroundTask();

      // Listen to app state changes
      this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);

      // Initialize and start the audio stream
      // The native module will preserve the audio session config we set above
      LiveAudioStream.init(nativeConfig);
      this.attachDataListener();
      LiveAudioStream.start();

      this.isRecording = true;
      this.chunkCount = 0;
      this.lastAudioChunkTime = Date.now();
      this.callbacks.onStatusChange?.(true);

      // Start audio health check (detects if audio stops flowing unexpectedly)
      this.startAudioHealthCheck();

      if (__DEV__) {
        console.log('[Audio] ✅ Audio stream started');
      }
    } catch (error) {
      console.error('[Audio] Failed to start recording:', error);
      this.isRecording = false;
      this.detachDataListener();
      await this.stopBackgroundTask();
      this.callbacks.onStatusChange?.(false);
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Pause audio streaming (keeps WebSocket alive with silence)
   */
  async pause(): Promise<void> {
    if (!this.isRecording || this.isPaused) return;

    if (__DEV__) {
      console.log('[Audio] ⏸️ Pausing audio stream (will send silence to keep connection alive)');
    }

    this.isPaused = true;

    // Stop audio health check while paused
    this.stopAudioHealthCheck();

    // Stop the native audio stream
    try {
      if (LiveAudioStream) {
        LiveAudioStream.stop();
      }
    } catch (error) {
      console.warn('[Audio] Error pausing stream:', error);
    }

    this.detachDataListener();

    // Send silence chunks every 100ms to keep WebSocket alive
    this.silenceInterval = setInterval(() => {
      if (this.isPaused && this.isRecording) {
        // Create a silent audio chunk (all zeros)
        // 100ms at 16kHz mono, 16-bit = 16000 * 0.1 * 2 bytes = 3200 bytes
        const silentBuffer = new ArrayBuffer(3200);
        const silentArray = new Uint8Array(silentBuffer);
        silentArray.fill(0);
        
        // Convert to base64
        const base64 = Buffer.from(silentBuffer).toString('base64');
        
        const silentChunk: AudioChunkData = {
          base64,
          buffer: silentBuffer,
          byteSize: silentBuffer.byteLength,
          rms: 0,
        };
        
        this.callbacks.onAudioChunk(silentChunk);
      }
    }, 100);

    if (__DEV__) {
      console.log('[Audio] ✅ Audio stream paused, sending silence chunks');
    }
  }

  /**
   * Resume audio streaming
   */
  async resume(): Promise<void> {
    if (!this.isRecording || !this.isPaused) {
      if (__DEV__) {
        console.log('[Audio] ⚠️ Resume called but conditions not met:', {
          isRecording: this.isRecording,
          isPaused: this.isPaused,
        });
      }
      return;
    }

    if (__DEV__) {
      console.log('[Audio] ▶️ Resuming audio stream...');
    }

    // Stop sending silence chunks
    if (this.silenceInterval) {
      clearInterval(this.silenceInterval);
      this.silenceInterval = null;
    }

    this.isPaused = false;
    this.pausedByInterruption = false;
    this.interruptionStartedAt = null;
    this.clearInterruptionRecovery();

    try {
      // Reconfigure iOS audio session if needed (similar to start)
      if (Platform.OS === 'ios' && LiveAudioStream?.configureAudioSession) {
        try {
          await LiveAudioStream.configureAudioSession({
            category: 'PlayAndRecord',
            mode: 'VoiceChat',
            allowBluetooth: true,
            allowBluetoothA2DP: true,
          });
          // Small delay to ensure audio session is fully configured
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
          console.warn('[Audio] ⚠️ Failed to reconfigure iOS audio session on resume:', err);
          // Continue anyway - native module will attempt to activate
        }
      }

      // Restart the native audio stream
      if (LiveAudioStream) {
        const nativeConfig = getNativeAudioConfig(this.processor);
        
        // Re-initialize and start
        LiveAudioStream.init(nativeConfig);
        this.attachDataListener();
        LiveAudioStream.start();

        // Reset audio chunk tracking and restart health check
        this.lastAudioChunkTime = Date.now();
        this.startAudioHealthCheck();

        if (__DEV__) {
          console.log('[Audio] ✅ Audio stream resumed');
        }
      }
    } catch (error) {
      console.error('[Audio] ❌ Failed to resume stream:', error);
      this.isPaused = true; // Keep paused on error
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Stop audio streaming
   */
  async stop(): Promise<void> {
    if (!this.isRecording) return;

    if (__DEV__) {
      console.log(`[Audio] 🛑 Stopping audio stream (sent ${this.chunkCount} chunks)`);
    }

    this.isRecording = false;
    this.isPaused = false;
    this.pausedByInterruption = false;
    this.interruptionStartedAt = null;
    this.clearInterruptionRecovery();

    // Stop health check
    this.stopAudioHealthCheck();

    // Stop silence interval if running
    if (this.silenceInterval) {
      clearInterval(this.silenceInterval);
      this.silenceInterval = null;
    }

    // Cleanup listeners
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    this.detachDataListener();

    // Stop audio stream
    try {
      if (LiveAudioStream) {
        LiveAudioStream.stop();
      }
    } catch (error) {
      console.error('[Audio] Failed to stop stream:', error);
    }

    await this.stopBackgroundTask();
    this.callbacks.onStatusChange?.(false);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: Audio Data Handling
  // ─────────────────────────────────────────────────────────────────────────────

  private handleAudioData = (rawData: unknown): void => {
    if (!this.isRecording || this.isPaused) return;

    // Process the raw data using platform-specific processor
    const chunk = this.processor.processChunk(rawData);

    if (!chunk) {
      if (__DEV__) {
        console.warn('[Audio] ⚠️ Failed to process audio chunk');
      }
      return;
    }

    // Track when we receive real audio (for health check)
    this.lastAudioChunkTime = Date.now();

    this.chunkCount++;
    this.logChunk(chunk);
    this.callbacks.onAudioChunk(chunk);
  };

  private logChunk(chunk: AudioChunkData): void {
    if (!__DEV__) return;

    // Log first chunk and every 20th chunk
    if (this.chunkCount === 1 || this.chunkCount % 20 === 0) {
      const sizeKB = Math.round(chunk.byteSize / 1024);
      const rmsStr = chunk.rms !== undefined ? `, rms=${Math.round(chunk.rms)}` : '';
      console.log(`[Audio] 🎵 Chunk #${this.chunkCount} (${sizeKB}KB PCM16${rmsStr})`);

      // Warn if RMS is consistently low
      if (chunk.rms !== undefined && chunk.rms < 10 && this.chunkCount > 5) {
        console.warn('[Audio] ⚠️ Very low RMS detected - audio may be silent!');
      }
    }
  }

  private attachDataListener(): void {
    if (!LiveAudioStream || this.isListenerAttached) return;

    LiveAudioStream.on('data', this.handleAudioData);
    this.isListenerAttached = true;
    
    // Also attach interruption listeners
    this.attachInterruptionListeners();
  }

  private detachDataListener(): void {
    if (!LiveAudioStream || !this.isListenerAttached) return;

    try {
      if (typeof LiveAudioStream.removeListener === 'function') {
        LiveAudioStream.removeListener('data', this.handleAudioData);
      } else if (typeof LiveAudioStream.off === 'function') {
        LiveAudioStream.off('data', this.handleAudioData);
      }
    } catch (e) {
      if (__DEV__) {
        console.log('[Audio] Listener cleanup error (non-critical):', e);
      }
    }

    this.isListenerAttached = false;
    
    // Also detach interruption listeners
    this.detachInterruptionListeners();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: Audio Interruption Handling (iOS/Android)
  // ─────────────────────────────────────────────────────────────────────────────
  
  private handleInterruptionBegan = (): void => {
    if (__DEV__) {
      console.log('[Audio] 🚨 Audio interruption began (phone call, etc.) - pausing...', {
        isRecording: this.isRecording,
        isPaused: this.isPaused,
      });
    }
    
    this.pausedByInterruption = true;
    this.interruptionStartedAt = Date.now();
    this.scheduleInterruptionRecovery();

    // Pause recording to send silence chunks and keep WebSocket alive
    this.pause().catch((error) => {
      console.error('[Audio] ❌ Failed to pause on interruption:', error);
    });
  };
  
  private handleInterruptionEnded = (event: any): void => {
    const shouldResume = event?.shouldResume ?? true;
    
    if (__DEV__) {
      console.log('[Audio] ✅ Audio interruption ended', {
        shouldResume,
        isRecording: this.isRecording,
        isPaused: this.isPaused,
        willAttemptResume: shouldResume && this.isPaused,
      });
    }
    
    this.clearInterruptionRecovery();

    if (shouldResume && this.isPaused) {
      // Resume recording
      this.resume().catch((error) => {
        console.error('[Audio] ❌ Failed to resume after interruption:', error);
      });
    } else if (__DEV__) {
      console.log('[Audio] ⏭️ Skipping resume:', {
        reason: !shouldResume ? 'shouldResume=false' : 'not paused',
      });
    }
  };
  
  private attachInterruptionListeners(): void {
    if (!LiveAudioStream || this.interruptionListenersAttached) return;
    
    try {
      LiveAudioStream.on('onInterruptionBegan', this.handleInterruptionBegan);
      LiveAudioStream.on('onInterruptionEnded', this.handleInterruptionEnded);
      this.interruptionListenersAttached = true;
      
      if (__DEV__) {
        console.log('[Audio] 🎧 Interruption listeners attached');
      }
    } catch (e) {
      if (__DEV__) {
        console.warn('[Audio] Failed to attach interruption listeners:', e);
      }
    }
  }
  
  private detachInterruptionListeners(): void {
    if (!LiveAudioStream || !this.interruptionListenersAttached) return;
    
    try {
      if (typeof LiveAudioStream.removeListener === 'function') {
        LiveAudioStream.removeListener('onInterruptionBegan', this.handleInterruptionBegan);
        LiveAudioStream.removeListener('onInterruptionEnded', this.handleInterruptionEnded);
      } else if (typeof LiveAudioStream.off === 'function') {
        LiveAudioStream.off('onInterruptionBegan', this.handleInterruptionBegan);
        LiveAudioStream.off('onInterruptionEnded', this.handleInterruptionEnded);
      }
      
      this.interruptionListenersAttached = false;
      
      if (__DEV__) {
        console.log('[Audio] 🎧 Interruption listeners detached');
      }
    } catch (e) {
      if (__DEV__) {
        console.warn('[Audio] Failed to detach interruption listeners:', e);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: Background Task (Android)
  // ─────────────────────────────────────────────────────────────────────────────

  private handleAppStateChange = (nextAppState: AppStateStatus): void => {
    if (__DEV__) {
      console.log('[Audio] App state changed:', nextAppState);
    }

    if (nextAppState === 'background' && this.isRecording) {
      console.log('[Audio] 📱 App in background, audio continues via background service');
      // Call optional callback to suppress recording confirmation dialog
      this.onAppBackground?.();
    }

    if (nextAppState === 'active' && this.isRecording && this.isPaused && this.pausedByInterruption) {
      if (__DEV__) {
        console.log('[Audio] 🔄 App became active while paused by interruption - attempting resume');
      }
      this.resume().catch((error) => {
        console.error('[Audio] ❌ Failed to resume on app foreground:', error);
      });
    }
  };

  private async startBackgroundTask(): Promise<void> {
    if (!this.config.enableBackgroundTask) {
      if (__DEV__) {
        console.log('[Audio] ⚠️ Background task disabled');
      }
      return;
    }

    if (Platform.OS !== 'android') return;
    if (this.isBackgroundTaskRunning) return;
    if (!BackgroundActions) {
      if (__DEV__) {
        console.log('[Audio] ⚠️ Background actions not available');
      }
      return;
    }

    try {
      const taskOptions = createBackgroundTaskOptions(this.jobId);
      
      if (__DEV__) {
        console.log('[Audio] Starting background task with options:', {
          jobId: this.jobId || 'undefined',
          linkingURI: taskOptions.linkingURI,
          taskTitle: taskOptions.taskTitle,
          hasJobId: !!this.jobId,
        });
      }
      
      await BackgroundActions.start(this.backgroundTaskLoop, taskOptions);
      this.isBackgroundTaskRunning = true;
      
      if (__DEV__) {
        console.log('[Audio] 🔄 Android background service started', this.jobId ? `for job ${this.jobId}` : '');
        console.log('[Audio] Deep link URI configured:', taskOptions.linkingURI);
        if (!this.jobId) {
          console.warn('[Audio] ⚠️ Background task started without jobId - deep link will not work!');
        }
      }
    } catch (error) {
      console.error('[Audio] Failed to start background task:', error);
      if (__DEV__) {
        console.error('[Audio] Error details:', {
          jobId: this.jobId || 'undefined',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }
  }

  private async stopBackgroundTask(): Promise<void> {
    if (Platform.OS !== 'android') return;
    if (!this.isBackgroundTaskRunning) return;
    if (!BackgroundActions) return;

    try {
      await BackgroundActions.stop();
      this.isBackgroundTaskRunning = false;
      if (__DEV__) {
        console.log('[Audio] 🔄 Android background service stopped');
      }
    } catch (error) {
      console.error('[Audio] Failed to stop background task:', error);
    }
  }

  private backgroundTaskLoop = async (_taskData?: { delay: number }): Promise<void> => {
    // Keep the service alive while recording
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (!this.isRecording) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000);
    });
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Private: Audio Health Check (detects stuck/stalled audio)
  // ─────────────────────────────────────────────────────────────────────────────

  private startAudioHealthCheck(): void {
    // Don't start if already running
    if (this.audioStateCheckInterval) return;

    if (__DEV__) {
      console.log('[Audio] 🏥 Starting audio health check...');
    }

    // Check every 3 seconds if audio is flowing
    this.audioStateCheckInterval = setInterval(() => {
      // Skip check if paused (we're intentionally sending silence)
      if (this.isPaused) return;

      const timeSinceLastChunk = Date.now() - this.lastAudioChunkTime;
      
      // If no audio received for 5 seconds while supposedly recording, try to recover
      if (timeSinceLastChunk > 5000 && this.isRecording && !this.isPaused) {
        if (__DEV__) {
          console.warn('[Audio] ⚠️ Audio health check failed - no audio for 5s, attempting recovery...', {
            timeSinceLastChunk: Math.round(timeSinceLastChunk / 1000) + 's',
            isRecording: this.isRecording,
            isPaused: this.isPaused,
            chunkCount: this.chunkCount,
          });
        }

        // Attempt to recover by restarting the audio stream
        this.recoverAudioStream();
      }
    }, 3000);
  }

  private stopAudioHealthCheck(): void {
    if (this.audioStateCheckInterval) {
      clearInterval(this.audioStateCheckInterval);
      this.audioStateCheckInterval = null;
      
      if (__DEV__) {
        console.log('[Audio] 🏥 Audio health check stopped');
      }
    }
  }

  private scheduleInterruptionRecovery(): void {
    // If an interruption end event never arrives (e.g., missed call not answered),
    // attempt a resume after a grace period.
    const recoveryDelayMs = 8000;
    this.clearInterruptionRecovery();
    this.interruptionResumeTimeout = setTimeout(() => {
      if (this.isRecording && this.isPaused && this.pausedByInterruption) {
        if (__DEV__) {
          console.warn('[Audio] ⏳ No interruption-ended event received, auto-resuming after timeout');
        }
        this.resume().catch((error) => {
          console.error('[Audio] ❌ Auto-resume after interruption timeout failed:', error);
        });
      }
    }, recoveryDelayMs);
  }

  private clearInterruptionRecovery(): void {
    if (this.interruptionResumeTimeout) {
      clearTimeout(this.interruptionResumeTimeout);
      this.interruptionResumeTimeout = null;
    }
  }

  private async recoverAudioStream(): Promise<void> {
    if (__DEV__) {
      console.log('[Audio] 🔧 Attempting to recover audio stream...');
    }

    try {
      // Don't use pause/resume since those have guards
      // Directly restart the stream
      
      // Stop current stream
      this.detachDataListener();
      if (LiveAudioStream) {
        LiveAudioStream.stop();
      }

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 500));

      // Reconfigure audio session if iOS
      if (Platform.OS === 'ios' && LiveAudioStream?.configureAudioSession) {
        try {
          await LiveAudioStream.configureAudioSession({
            category: 'PlayAndRecord',
            mode: 'VoiceChat',
            allowBluetooth: true,
            allowBluetoothA2DP: true,
          });
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
          console.warn('[Audio] ⚠️ Failed to reconfigure audio session during recovery:', err);
        }
      }

      // Restart stream
      if (LiveAudioStream) {
        const nativeConfig = getNativeAudioConfig(this.processor);
        LiveAudioStream.init(nativeConfig);
        this.attachDataListener();
        LiveAudioStream.start();
        
        this.lastAudioChunkTime = Date.now();
        
        if (__DEV__) {
          console.log('[Audio] ✅ Audio stream recovery complete');
        }
      }
    } catch (error) {
      console.error('[Audio] ❌ Failed to recover audio stream:', error);
      this.callbacks.onError?.(error instanceof Error ? error : new Error('Failed to recover audio stream'));
    }
  }
}

export default AudioRecorder;
