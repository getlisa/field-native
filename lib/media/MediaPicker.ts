/**
 * MediaPicker - Abstraction for image/media picking
 *
 * Handles both camera and gallery access with graceful fallback
 * when native modules aren't available (e.g., in Expo Go).
 */

import { Alert, Platform } from 'react-native';
import type { IMediaPicker, ImagePickerOptions, ImagePickerResult, MediaAsset } from './types';

// Native module - may not be available in Expo Go
let ImagePicker: any = null;
let isModuleAvailable = false;

try {
  ImagePicker = require('expo-image-picker');
  // Test if the native module is actually accessible
  isModuleAvailable = typeof ImagePicker?.launchCameraAsync === 'function';
} catch {
  console.warn('[MediaPicker] expo-image-picker not available');
}

const CANCELLED_RESULT: ImagePickerResult = { cancelled: true, assets: [] };

class ExpoMediaPicker implements IMediaPicker {
  isAvailable(): boolean {
    return isModuleAvailable;
  }

  async requestCameraPermission(): Promise<boolean> {
    if (!this.isAvailable()) {
      this.showUnavailableAlert();
      return false;
    }

    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Camera access is needed to take photos. Please enable it in your device settings.',
          [{ text: 'OK' }]
        );
        return false;
      }
      return true;
    } catch (error) {
      console.error('[MediaPicker] Camera permission error:', error);
      return false;
    }
  }

  async requestGalleryPermission(): Promise<boolean> {
    if (!this.isAvailable()) {
      this.showUnavailableAlert();
      return false;
    }

    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Gallery access is needed to select photos. Please enable it in your device settings.',
          [{ text: 'OK' }]
        );
        return false;
      }
      return true;
    } catch (error) {
      console.error('[MediaPicker] Gallery permission error:', error);
      return false;
    }
  }

  async launchCamera(options: ImagePickerOptions = {}): Promise<ImagePickerResult> {
    if (!this.isAvailable()) {
      this.showUnavailableAlert();
      return CANCELLED_RESULT;
    }

    const hasPermission = await this.requestCameraPermission();
    if (!hasPermission) {
      return CANCELLED_RESULT;
    }

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: options.allowsEditing ?? true,
        quality: options.quality ?? 0.8,
      });

      if (result.canceled || !result.assets?.length) {
        return CANCELLED_RESULT;
      }

      return {
        cancelled: false,
        assets: result.assets.map(this.mapAsset),
      };
    } catch (error) {
      console.error('[MediaPicker] Camera launch error:', error);
      Alert.alert('Camera Error', 'Could not access camera. Please try again.');
      return CANCELLED_RESULT;
    }
  }

  async launchGallery(options: ImagePickerOptions = {}): Promise<ImagePickerResult> {
    if (!this.isAvailable()) {
      this.showUnavailableAlert();
      return CANCELLED_RESULT;
    }

    const hasPermission = await this.requestGalleryPermission();
    if (!hasPermission) {
      return CANCELLED_RESULT;
    }

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: options.allowsEditing ?? true,
        quality: options.quality ?? 0.8,
      });

      if (result.canceled || !result.assets?.length) {
        return CANCELLED_RESULT;
      }

      return {
        cancelled: false,
        assets: result.assets.map(this.mapAsset),
      };
    } catch (error) {
      console.error('[MediaPicker] Gallery launch error:', error);
      Alert.alert('Gallery Error', 'Could not access gallery. Please try again.');
      return CANCELLED_RESULT;
    }
  }

  private mapAsset(asset: any): MediaAsset {
    return {
      uri: asset.uri,
      type: asset.mimeType || 'image/jpeg',
      name: asset.fileName || `image-${Date.now()}.jpg`,
      size: asset.fileSize,
      width: asset.width,
      height: asset.height,
    };
  }

  private showUnavailableAlert(): void {
    Alert.alert(
      'Feature Unavailable',
      'Image picking requires a development build. This feature is not available in Expo Go.\n\nTo use this feature, run:\nnpx expo run:ios\nor\nnpx expo run:android',
      [{ text: 'OK' }]
    );
  }
}

// Singleton instance
let mediaPickerInstance: IMediaPicker | null = null;

export function getMediaPicker(): IMediaPicker {
  if (!mediaPickerInstance) {
    mediaPickerInstance = new ExpoMediaPicker();
  }
  return mediaPickerInstance;
}

export { ExpoMediaPicker };
