import type { WearablesCameraCaptureResult, WearablesCameraPermissionStatus, WearablesStatusEvent } from './ExpoWearablesCamera.types';
type ExpoWearablesCameraNativeModule = {
    initialize(): Promise<void>;
    startRegistration(): Promise<void>;
    awaitRegistration(): Promise<void>;
    getRegistrationState(): Promise<string>;
    requestAndroidPermissions(): Promise<boolean>;
    startMonitoring(): Promise<void>;
    getStatus(): Promise<WearablesStatusEvent>;
    requestWearablesCameraPermission(): Promise<WearablesCameraPermissionStatus>;
    capturePhotoToTempFile(): Promise<WearablesCameraCaptureResult>;
    addListener(eventName: 'onWearablesStatus', listener: (event: WearablesStatusEvent) => void): {
        remove: () => void;
    };
};
declare const ExpoWearablesCamera: ExpoWearablesCameraNativeModule | null;
export default ExpoWearablesCamera;
//# sourceMappingURL=ExpoWearablesCameraModule.d.ts.map