/**
 * Media module type definitions
 */

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
}

export interface IMediaPicker {
  /**
   * Check if the picker is available on this device/build
   */
  isAvailable(): boolean;

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
}
