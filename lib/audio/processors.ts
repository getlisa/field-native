/**
 * Platform-specific audio processors
 *
 * react-native-live-audio-stream emits data differently on iOS vs Android:
 * - Android: Emits base64 string directly
 * - iOS: May emit raw data (ArrayBuffer, Uint8Array, or base64 string)
 *
 * These processors normalize the data to a consistent format.
 */

import { Platform } from 'react-native';
import { Buffer } from 'buffer';
import type { AudioChunkData, AudioConfig, IAudioProcessor } from './types';

// Android AudioSource values
const AUDIO_SOURCE = {
  DEFAULT: 0,
  MIC: 1,
  CAMCORDER: 5,
  VOICE_RECOGNITION: 6,
  VOICE_COMMUNICATION: 7,
};

/**
 * Base audio processor with shared utilities
 */
abstract class BaseAudioProcessor implements IAudioProcessor {
  abstract processChunk(rawData: unknown): AudioChunkData | null;
  abstract getConfig(): AudioConfig;

  /**
   * Convert raw bytes to base64 string
   */
  protected bytesToBase64(bytes: Uint8Array | number[]): string {
    const buffer = Buffer.from(bytes);
    return buffer.toString('base64');
  }

  /**
   * Compute RMS (root mean square) from PCM16 base64 data
   */
  protected computeRms(base64Data: string): number {
    try {
      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.length < 2) return 0;

      let sumSquares = 0;
      const sampleCount = Math.floor(buffer.length / 2);

      for (let i = 0; i < buffer.length - 1; i += 2) {
        const sample = buffer.readInt16LE(i);
        sumSquares += sample * sample;
      }

      return Math.sqrt(sumSquares / sampleCount);
    } catch {
      return 0;
    }
  }

  /**
   * Calculate byte size from base64 string
   */
  protected getByteSize(base64Data: string): number {
    // Base64 encodes 3 bytes into 4 characters
    return Math.floor((base64Data.length * 3) / 4);
  }
}

/**
 * Android audio processor
 * Android typically emits base64 strings directly
 */
class AndroidAudioProcessor extends BaseAudioProcessor {
  processChunk(rawData: unknown): AudioChunkData | null {
    // Android emits base64 string directly
    if (typeof rawData === 'string') {
      if (rawData.length === 0) {
        console.warn('[Audio:Android] Empty string data received');
        return null;
      }
      const byteSize = this.getByteSize(rawData);
      return {
        base64: rawData,
        byteSize,
        rms: this.computeRms(rawData),
      };
    }

    // Fallback: handle if Android sends array-like data
    if (Array.isArray(rawData) || rawData instanceof Uint8Array) {
      const bytes = rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData);
      if (bytes.length === 0) {
        console.warn('[Audio:Android] Empty array data received');
        return null;
      }
      const base64 = this.bytesToBase64(bytes);
      return {
        base64,
        byteSize: bytes.length,
        rms: this.computeRms(base64),
      };
    }

    console.warn('[Audio:Android] Unknown data type:', typeof rawData);
    return null;
  }

  getConfig(): AudioConfig {
    return {
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      bufferSize: 4096, // ~256ms at 16kHz
    };
  }
}

/**
 * iOS audio processor
 * iOS may emit data in different formats depending on the library version
 */
class iOSAudioProcessor extends BaseAudioProcessor {
  processChunk(rawData: unknown): AudioChunkData | null {
    // Case 1: base64 string (some versions)
    if (typeof rawData === 'string') {
      if (rawData.length === 0) {
        console.warn('[Audio:iOS] Empty string data received');
        return null;
      }
      const byteSize = this.getByteSize(rawData);
      return {
        base64: rawData,
        byteSize,
        rms: this.computeRms(rawData),
      };
    }

    // Case 2: ArrayBuffer (common on iOS)
    if (rawData instanceof ArrayBuffer) {
      const bytes = new Uint8Array(rawData);
      if (bytes.length === 0) {
        console.warn('[Audio:iOS] Empty ArrayBuffer received');
        return null;
      }
      const base64 = this.bytesToBase64(bytes);
      return {
        base64,
        byteSize: bytes.length,
        rms: this.computeRms(base64),
      };
    }

    // Case 3: Uint8Array
    if (rawData instanceof Uint8Array) {
      if (rawData.length === 0) {
        console.warn('[Audio:iOS] Empty Uint8Array received');
        return null;
      }
      const base64 = this.bytesToBase64(rawData);
      return {
        base64,
        byteSize: rawData.length,
        rms: this.computeRms(base64),
      };
    }

    // Case 4: Plain array of numbers
    if (Array.isArray(rawData)) {
      if (rawData.length === 0) {
        console.warn('[Audio:iOS] Empty array received');
        return null;
      }
      const bytes = new Uint8Array(rawData);
      const base64 = this.bytesToBase64(bytes);
      return {
        base64,
        byteSize: bytes.length,
        rms: this.computeRms(base64),
      };
    }

    // Case 5: Object with data property (some library versions wrap the data)
    if (rawData && typeof rawData === 'object') {
      const obj = rawData as Record<string, unknown>;

      // Try common property names
      const dataValue = obj.data ?? obj.audioData ?? obj.buffer ?? obj.bytes;
      if (dataValue) {
        return this.processChunk(dataValue);
      }

      // Try to convert object to array if it has numeric keys
      const keys = Object.keys(obj);
      if (keys.length > 0 && keys.every((k) => !isNaN(Number(k)))) {
        const bytes = new Uint8Array(keys.length);
        for (let i = 0; i < keys.length; i++) {
          bytes[i] = Number(obj[i]) || 0;
        }
        if (bytes.length > 0) {
          const base64 = this.bytesToBase64(bytes);
          return {
            base64,
            byteSize: bytes.length,
            rms: this.computeRms(base64),
          };
        }
      }
    }

    console.warn('[Audio:iOS] Unknown data type:', typeof rawData, rawData);
    return null;
  }

  getConfig(): AudioConfig {
    return {
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      bufferSize: 2048, // Smaller buffer (128ms) for iOS for more responsive capture
    };
  }
}

/**
 * Factory function to get the appropriate audio processor for the current platform
 */
export function createAudioProcessor(): IAudioProcessor {
  if (Platform.OS === 'ios') {
    return new iOSAudioProcessor();
  }
  return new AndroidAudioProcessor();
}

/**
 * Get native audio config for react-native-live-audio-stream
 * Optimized for maximum microphone gain on both platforms
 */
export function getNativeAudioConfig(processor: IAudioProcessor): Record<string, unknown> {
  const config = processor.getConfig();

  const baseConfig = {
    sampleRate: config.sampleRate,
    channels: config.channels,
    bitsPerSample: config.bitsPerSample,
    bufferSize: config.bufferSize,
    wavFile: '', // Not using file output
  };

  if (Platform.OS === 'android') {
    return {
      ...baseConfig,
      // Use VOICE_RECOGNITION (6) for better microphone gain and automatic gain control
      // This provides better volume than standard MIC (1)
      audioSource: AUDIO_SOURCE.VOICE_RECOGNITION,
    };
  }

  // iOS-specific optimizations for better microphone gain
  return {
    ...baseConfig,
    // iOS uses AVAudioSession under the hood
    // These options help improve microphone sensitivity
    audioQuality: 'High',
    audioMode: 'measurement', // Optimized for capturing all audio without processing
    enableBuiltInEQ: false, // Disable EQ that might reduce gain
  };
}

