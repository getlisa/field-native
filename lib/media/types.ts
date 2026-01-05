/**
 * Media module type definitions
 */

/**
 * Image source types for the media picker
 */
export type ImageSource = 'camera' | 'gallery' | 'metaGlasses';

export interface MediaAsset {
  /** Local URI of the image/video */
  uri: string;
  /** MIME type (e.g., 'image/jpeg') */
  type: string;
  /** Filename */
  name: string;
  /** File size in bytes (if available) */
  size?: number;
  /** Width in pixels (if available) */
  width?: number;
  /** Height in pixels (if available) */
  height?: number;
  /** Source the image came from */
  source?: ImageSource;
  /** Base64 encoded data (if available) */
  base64?: string;
}

export interface ImagePickerResult {
  cancelled: boolean;
  assets: MediaAsset[];
}

export interface ImagePickerOptions {
  /** Allow editing before selection */
  allowsEditing?: boolean;
  /** Image quality (0-1) */
  quality?: number;
  /** Max width (optional) */
  maxWidth?: number;
  /** Max height (optional) */
  maxHeight?: number;
  /** Allowed sources (default: all available) */
  allowedSources?: ImageSource[];
}

export interface IMediaPicker {
  /**
   * Check if the picker is available on this device/build
   */
  isAvailable(): boolean;

  /**
   * Check if Meta glasses are available
   */
  isMetaGlassesAvailable(): boolean;

  /**
   * Request camera permissions
   */
  requestCameraPermission(): Promise<boolean>;

  /**
   * Request media library permissions
   */
  requestGalleryPermission(): Promise<boolean>;

  /**
   * Launch camera to take a photo
   */
  launchCamera(options?: ImagePickerOptions): Promise<ImagePickerResult>;

  /**
   * Launch image picker to select from gallery
   */
  launchGallery(options?: ImagePickerOptions): Promise<ImagePickerResult>;

  /**
   * Launch Meta glasses camera to capture a photo
   */
  launchMetaGlasses(options?: ImagePickerOptions): Promise<ImagePickerResult>;

  /**
   * Get available image sources
   */
  getAvailableSources(): ImageSource[];
}
