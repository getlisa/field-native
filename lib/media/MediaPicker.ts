/**
 * MediaPicker - Abstraction for image/media picking
 *
 * Handles camera, gallery, and Meta glasses access with graceful fallback
 * when native modules aren't available (e.g., in Expo Go).
 */

import { Alert, Platform } from 'react-native';
import type { IMediaPicker, ImagePickerOptions, ImagePickerResult, MediaAsset, ImageSource } from './types';

// Native module - may not be available in Expo Go
let ImagePicker: any = null;
let isModuleAvailable = false;

try {
  ImagePicker = require('expo-image-picker');
  isModuleAvailable = typeof ImagePicker?.launchCameraAsync === 'function';
} catch {
  console.warn('[MediaPicker] expo-image-picker not available');
}

// Meta Wearables module - optional
let ExpoMetaWearables: any = null;
let isMetaWearablesAvailable = false;

try {
  ExpoMetaWearables = require('expo-meta-wearables').default;
  isMetaWearablesAvailable = typeof ExpoMetaWearables?.initialize === 'function';
} catch {
  // expo-meta-wearables not installed
}

const CANCELLED_RESULT: ImagePickerResult = { cancelled: true, assets: [] };

class ExpoMediaPicker implements IMediaPicker {
  private _metaGlassesInitialized = false;
  private _metaGlassesDevicesAvailable = false;
  private _metaGlassesCaptureResolver: ((asset: MediaAsset | null) => void) | null = null;

  constructor() {
    this.checkMetaGlassesAvailability();
    if (isMetaWearablesAvailable) {
      setInterval(() => this.checkMetaGlassesAvailability(), 5000);
    }
  }

  private async checkMetaGlassesAvailability(): Promise<void> {
    if (!isMetaWearablesAvailable || !ExpoMetaWearables) {
      this._metaGlassesDevicesAvailable = false;
      return;
    }
    try {
      if (!this._metaGlassesInitialized) {
        const initialized = ExpoMetaWearables.isInitialized?.();
        if (!initialized) {
          this._metaGlassesDevicesAvailable = false;
          return;
        }
        this._metaGlassesInitialized = true;
      }
      const devices = ExpoMetaWearables.getDevices?.();
      this._metaGlassesDevicesAvailable = devices && devices.length > 0;
    } catch {
      this._metaGlassesDevicesAvailable = false;
    }
  }

  isAvailable(): boolean {
    return isModuleAvailable;
  }

  isMetaGlassesAvailable(): boolean {
    return isMetaWearablesAvailable && this._metaGlassesDevicesAvailable;
  }

  getAvailableSources(): ImageSource[] {
    const sources: ImageSource[] = [];
    if (isModuleAvailable) {
      sources.push('camera', 'gallery');
    }
    if (this.isMetaGlassesAvailable()) {
      sources.push('metaGlasses');
    }
    return sources;
  }

  async requestCameraPermission(): Promise<boolean> {
    if (!this.isAvailable()) {
      this.showUnavailableAlert();
      return false;
    }
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Camera access is needed.', [{ text: 'OK' }]);
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
        Alert.alert('Permission Required', 'Gallery access is needed.', [{ text: 'OK' }]);
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
    if (!hasPermission) return CANCELLED_RESULT;

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: options.allowsEditing ?? true,
        quality: options.quality ?? 0.8,
      });
      if (result.canceled || !result.assets?.length) return CANCELLED_RESULT;
      return {
        cancelled: false,
        assets: result.assets.map((asset: any) => this.mapAsset(asset, 'camera')),
      };
    } catch (error) {
      console.error('[MediaPicker] Camera launch error:', error);
      Alert.alert('Camera Error', 'Could not access camera.');
      return CANCELLED_RESULT;
    }
  }

  async launchGallery(options: ImagePickerOptions = {}): Promise<ImagePickerResult> {
    if (!this.isAvailable()) {
      this.showUnavailableAlert();
      return CANCELLED_RESULT;
    }
    const hasPermission = await this.requestGalleryPermission();
    if (!hasPermission) return CANCELLED_RESULT;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: options.allowsEditing ?? true,
        quality: options.quality ?? 0.8,
      });
      if (result.canceled || !result.assets?.length) return CANCELLED_RESULT;
      return {
        cancelled: false,
        assets: result.assets.map((asset: any) => this.mapAsset(asset, 'gallery')),
      };
    } catch (error) {
      console.error('[MediaPicker] Gallery launch error:', error);
      Alert.alert('Gallery Error', 'Could not access gallery.');
      return CANCELLED_RESULT;
    }
  }

  async launchMetaGlasses(options: ImagePickerOptions = {}): Promise<ImagePickerResult> {
    if (!isMetaWearablesAvailable || !ExpoMetaWearables) {
      Alert.alert('Meta Glasses Unavailable', 'expo-meta-wearables is required.', [{ text: 'OK' }]);
      return CANCELLED_RESULT;
    }
    if (!this.isMetaGlassesAvailable()) {
      Alert.alert('No Glasses Connected', 'Please connect your Meta glasses.', [{ text: 'OK' }]);
      return CANCELLED_RESULT;
    }
    return new Promise((resolve) => {
      this._metaGlassesCaptureResolver = (asset: MediaAsset | null) => {
        if (asset) {
          resolve({ cancelled: false, assets: [asset] });
        } else {
          resolve(CANCELLED_RESULT);
        }
      };
    });
  }

  resolveMetaGlassesCapture(asset: MediaAsset | null): void {
    if (this._metaGlassesCaptureResolver) {
      this._metaGlassesCaptureResolver(asset);
      this._metaGlassesCaptureResolver = null;
    }
  }

  private mapAsset(asset: any, source: ImageSource): MediaAsset {
    return {
      uri: asset.uri,
      type: asset.mimeType || 'image/jpeg',
      name: asset.fileName || 'image-' + Date.now() + '.jpg',
      size: asset.fileSize,
      width: asset.width,
      height: asset.height,
      source,
      base64: asset.base64,
    };
  }

  private showUnavailableAlert(): void {
    Alert.alert(
      'Feature Unavailable',
      'Image picking requires a development build.',
      [{ text: 'OK' }]
    );
  }
}

let mediaPickerInstance: IMediaPicker | null = null;

export function getMediaPicker(): IMediaPicker {
  if (!mediaPickerInstance) {
    mediaPickerInstance = new ExpoMediaPicker();
  }
  return mediaPickerInstance;
}

export { ExpoMediaPicker };
