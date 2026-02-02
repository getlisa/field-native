export type WearablesCameraPermissionStatus = 'granted' | 'denied';

export type WearablesCameraCaptureResult = {
  localPath: string;
  width: number;
  height: number;
  sizeBytes: number;
  timestamp: number;
};

export type WearablesRegistrationState = string;

export type WearablesStatusEvent = {
  registrationState: WearablesRegistrationState;
  registrationStateDetail?: string;
  hasActiveDevice: boolean;
  lastError?: string | null;
};
