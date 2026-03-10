# Meta Wearables DAT iOS SDK – Integration Audit

**Date:** March 2025  
**Scope:** Clara Wearables app – Meta Wearables Device Access Toolkit (DAT) iOS integration.  
**Goals:** Verify integration and identify causes of:
- "Waiting for an active device"
- `MWDATCore.PermissionError` error 2
- Streaming not starting from Meta smart glasses

---

## 1. SDK Installation Status

| Check | Status | Details |
|-------|--------|--------|
| SDK presence | ✅ | MWDATCore and MWDATCamera used via vendored xcframeworks |
| Location | ✅ | `modules/expo-wearables-camera/ios/Frameworks/` (MWDATCore.xcframework, MWDATCamera.xcframework) |
| Submodule | ✅ | `external/meta-wearables-dat-ios` exists (reference/samples only; app uses prebuilt frameworks in the module) |
| Podfile | ✅ | Root `ios/Podfile` does not reference DAT directly; Expo module `ExpoWearablesCamera` is autolinked and its podspec vendors the xcframeworks |
| Podspec | ✅ | `modules/expo-wearables-camera/ios/ExpoWearablesCamera.podspec` sets `vendored_frameworks = 'Frameworks/MWDATCore.xcframework', 'Frameworks/MWDATCamera.xcframework'` and framework search paths |
| Embed | ✅ | `Podfile` `post_install` adds "Embed MWDAT Frameworks" script phase to app target: copies and codesigns MWDATCore/MWDATCamera into the app bundle |
| Build | ⚠️ | Pods build; linker warnings observed (e.g. building for iOS 15.1 vs frameworks built for 15.2) – usually non-fatal |

**Conclusion:** SDK is correctly linked and embedded. No separate CocoaPods DAT pod; integration is via the Expo native module and its vendored xcframeworks.

---

## 2. Session Initialization Status

The Meta DAT iOS SDK does **not** use a single `DATSession.shared.start()` style API. It uses:

- **`Wearables.configure()`** – one-time setup (called in `initializeSDK()`).
- **`StreamSession`** – created per streaming/capture use (e.g. photo capture).

| Check | Status | Details |
|-------|--------|--------|
| Wearables.configure() | ✅ | Called in `ExpoWearablesCameraModule.initializeSDK()` (guarded by `isInitialized`) |
| When | ✅ | On first use of any SDK API (initialize, startMonitoring, startRegistration, capturePhotoToTempFile, etc.) |
| StreamSession | ✅ | Created inside `capturePhotoToTempFile()` when a photo is requested; `session.start()` is called after `waitForActiveDevice` |

**Conclusion:** Session initialization matches the DAT pattern: configure once, then create and start a `StreamSession` when capturing. There is no missing “session start” at app launch.

---

## 3. Device Detection Implementation

| Check | Status | Details |
|-------|--------|--------|
| Registration state | ✅ | `addRegistrationStateListener` in `beginMonitoring()`; updates `lastRegistrationState` and calls `emitStatus()` |
| Active device | ✅ | `AutoDeviceSelector(wearables:)` + `activeDeviceStream()` in `beginMonitoring()`; updates `hasActiveDevice` and `emitStatus()` |
| When monitoring starts | ✅ | When JS calls `startMonitoring()` (e.g. after Connect flow / `initialize()`), which calls `beginMonitoring()` |
| Device stream vs permission | ⚠️ | **Critical:** Per Meta docs, *“A device will not appear in the devicesStream until the user has granted at least one permission (e.g., camera) through the Meta AI app.”* So `activeDeviceStream()` can stay empty until camera permission is granted. |
| Request camera after registration | ✅ | JS can call `requestWearablesCameraPermission()`; it is also called in the Connect flow (e.g. after registration in listener). `capturePhotoToTempFile` calls `ensureCameraPermission()` before creating the session. |

**Conclusion:** Device discovery is implemented. “Waiting for an active device” is likely when:

1. Camera permission has not been granted in the Meta AI app after registration, so no device appears in the stream, or  
2. Glasses are off / not connected / out of range, or  
3. `waitForActiveDevice` times out (current timeout 8 seconds).

---

## 4. Streaming Setup

| Check | Status | Details |
|-------|--------|--------|
| Stream after device | ✅ | `capturePhotoToTempFile()` calls `waitForActiveDevice(selector:selector, timeout:deviceTimeoutSeconds)` before creating `StreamSession` and calling `session.start()` |
| Config | ✅ | `StreamSessionConfig(videoCodec: .raw, resolution: .low, frameRate: 24)` – matches sample pattern |
| State wait | ✅ | `waitForStreamState(session, state: .streaming, timeout:)` after `session.start()` |
| Photo capture | ✅ | `session.capturePhoto(format: .jpeg)` then `waitForPhotoData`; session stopped in `defer`/catch |
| Live video to RN | N/A | No continuous video stream is exposed to React Native; only photo capture is implemented. |

**Conclusion:** Streaming is correctly gated on an active device and used only for the photo capture flow. If “streaming not starting” means live preview in the app, that feature is not implemented in the bridge (only capture is).

---

## 5. Permissions Validation

### Info.plist (`ios/ClaraWearables/Info.plist`)

| Key | Present | Notes |
|-----|--------|--------|
| NSCameraUsageDescription | ✅ | Set |
| NSMicrophoneUsageDescription | ✅ | Set |
| NSBluetoothAlwaysUsageDescription | ✅ | Set |
| NSBluetoothPeripheralUsageDescription | ✅ | Set |
| NSLocalNetworkUsageDescription | ❌ | Not present. Add only if the DAT SDK or Meta AI flow requires local network discovery (check SDK/docs). |
| UISupportedExternalAccessoryProtocols | ✅ | `com.meta.ar.wearable` |
| UIBackgroundModes | ✅ | audio, bluetooth-peripheral, external-accessory |
| MWDAT (AppLinkURLScheme, MetaAppID) | ⚠️ | Present; **ClientToken** and **TeamID** are not in the MWDAT dict. Official sample uses MetaAppID, ClientToken, TeamID. Empty MetaAppID can allow Developer Mode; for full/production flows, add ClientToken and TeamID per [Meta docs](https://wearables.developer.meta.com/docs/build-integration-ios/). |

### app.config.js (Expo)

MWAT block and Bluetooth/External Accessory entries are set in `app.config.js` under `ios.infoPlist`; prebuild will merge these into the generated Info.plist.

**Suggested fix (if needed):**  
- Add **NSLocalNetworkUsageDescription** only if required by the SDK.  
- Add **ClientToken** and **TeamID** to the MWDAT dict (e.g. from env) for non–Developer-Mode registration/device flows.

---

## 6. Potential Issues

### A. "Waiting for an active device"

- **Cause 1:** No device in `activeDeviceStream()` because **camera permission has not been granted** in the Meta AI app after registration.  
  **Fix:** Ensure the app (or Connect flow) calls `requestWearablesCameraPermission()` after registration completes so the user is prompted in Meta AI and the device can appear.

- **Cause 2:** **Timeouts too short.** `deviceTimeoutSeconds = 8.0` is used for `waitForActiveDevice`, `waitForStreamState`, and `ensureRegistered`.  
  **Fix:** Increase to 20–45 seconds for `waitForActiveDevice` (and optionally for `ensureRegistered`) so slow device discovery or user delay doesn’t always time out.

- **Cause 3:** Glasses not on / not paired / not in range.  
  **Fix:** Document that glasses must be on and connected; optionally surface a clearer error when `waitForActiveDevice` times out (e.g. “No active device; ensure glasses are on and camera permission is granted in Meta AI”).

### B. MWDATCore.PermissionError error 2

- **Meaning:** In MWDATCore, `PermissionError` raw value 2 is **`connectionError`** (noDevice=0, noDeviceWithConnection=1, **connectionError=2**, …).

- **Where it can happen:** `ensureCameraPermission()` → `wearables.requestPermission(.camera)` can throw this if the connection to the device fails (e.g. no device, or connection lost).

- **Current handling:** The module catches the error, sets `lastError`, and rejects with a generic `CAPTURE_ERROR` / `PERMISSION_ERROR` message. There is no specific handling or user-facing message for `PermissionError.connectionError`.

**Suggested fix:**

- In `requestWearablesCameraPermission` (and anywhere `ensureCameraPermission` is used), catch `MWDATCore.PermissionError` and map:
  - `connectionError` (2) → e.g. “Device connection error. Ensure glasses are on and connected, then try again.”
  - Optionally map other cases (noDevice, noDeviceWithConnection, requestTimeout, etc.) for better UX.
- Optionally expose a structured error code (e.g. `PERMISSION_CONNECTION_ERROR`) to JS so the UI can show a specific message.

### C. Streaming not starting from glasses

- **If “streaming” means live video in the app:** The native module only implements **photo capture** (create session → start → wait streaming → capture photo → stop). There is no API exposed to RN for continuous video streaming or preview.  
  **Fix:** Would require new native APIs (e.g. startStream, stopStream, frame events or file path) and JS/UI to consume them.

- **If “streaming” means photo capture failing:** Follow the “Waiting for an active device” and PermissionError fixes above (permission + device visibility, timeouts, and connectionError handling). Also ensure registration and callback URL handling are complete (see below).

### D. handleUrl does not update or emit status after callback

- **Location:** `ExpoWearablesCameraModule.swift`, `AsyncFunction("handleUrl")` (around lines 99–115).

- **Issue:** After `Wearables.shared.handleUrl(url)` succeeds, the code does **not**:
  - Set `lastRegistrationState = Wearables.shared.registrationState`
  - Clear `lastError` (if desired)
  - Call `emitStatus()`

- **Impact:** When the user returns from the Meta AI app via the callback URL, the SDK state becomes “registered” but the React Native app may not receive an updated status event, so the UI can still show “Connect” or “not connected.”

**Suggested fix:** After a successful `handleUrl`, update state and notify JS:

```swift
let handled = try await Wearables.shared.handleUrl(url)
self.lastRegistrationState = Wearables.shared.registrationState
self.lastError = nil
self.emitStatus()
promise.resolve(handled)
```

### E. ensureRegistered timeout (8 s) after opening Meta app

- **Location:** `ensureRegistered()` uses `withTimeout(deviceTimeoutSeconds)` (8 s) waiting for `registrationState == .registered`.

- **Issue:** User is in the Meta AI app for more than 8 seconds; when they return and the app tries to ensure registration (e.g. before capture), the wait can time out even though the user has completed registration.

**Suggested fix:** Use a longer timeout for registration wait (e.g. 30–45 s), or a separate constant (e.g. `registrationTimeoutSeconds`) so other timeouts (device, stream) can stay shorter.

### F. MWDAT ClientToken / TeamID missing

- **Location:** `ios/ClaraWearables/Info.plist` and `app.config.js` – MWDAT dict has `AppLinkURLScheme` and `MetaAppID` (empty); **ClientToken** and **TeamID** are missing.

- **Impact:** May work in Developer Mode with empty MetaAppID; for production or full device/permission flows, Meta docs recommend setting these from the Wearables Developer Center.

**Suggested fix:** Add ClientToken and TeamID to the MWDAT dict (e.g. from env in app.config.js and/or Xcode build settings for Info.plist), as in the official sample.

---

## 7. Recommended Fixes (Summary)

| # | Issue | File(s) | Suggested fix |
|---|--------|---------|----------------|
| 1 | handleUrl doesn’t update/emit status | `ExpoWearablesCameraModule.swift` | After successful `handleUrl`, set `lastRegistrationState`, clear `lastError`, call `emitStatus()`. |
| 2 | Short timeouts (8 s) | `ExpoWearablesCameraModule.swift` | Increase `deviceTimeoutSeconds` (or add `registrationTimeoutSeconds`) to 30–45 s for registration and device wait. |
| 3 | PermissionError.connectionError (error 2) not mapped | `ExpoWearablesCameraModule.swift` | In `requestWearablesCameraPermission` and capture path, catch `PermissionError` and map `connectionError` (and optionally others) to clear messages and/or error codes. |
| 4 | Device not appearing until camera granted | JS + flow | Ensure camera permission is requested after registration (e.g. in Connect flow or when status becomes “registered”); document that “active device” appears only after at least one permission is granted in Meta AI. |
| 5 | MWDAT ClientToken / TeamID | `Info.plist`, `app.config.js` | Add ClientToken and TeamID to MWDAT for non–Developer-Mode use. |
| 6 | (Optional) NSLocalNetworkUsageDescription | `Info.plist` / app.config.js | Add if DAT or Meta AI requires local network. |
| 7 | Clearer “no active device” message | `ExpoWearablesCameraModule.swift` or JS | When `waitForActiveDevice` times out, reject with a message like “No active device. Ensure glasses are on and camera permission is granted in Meta AI.” |

---

## 8. Debug Checklist

- [ ] **Registration:** After tapping Connect and completing the flow in Meta AI, does the app receive the callback URL and call `handleUrl`? (Check `__DEV__` log in root layout and native `handleUrl` print.)
- [ ] **Status after callback:** After `handleUrl` succeeds, does the JS layer receive an `onWearablesStatus` event with `registrationState: "Registered"`? (If not, add `emitStatus()` after `handleUrl` as in §7.)
- [ ] **Camera permission:** After registration, is `requestWearablesCameraPermission()` (or equivalent) called so the user is prompted in Meta AI for camera access? (Check that the Connect/listener flow or capture flow triggers it.)
- [ ] **Glasses:** Are the Meta glasses on, paired with the phone, and in range when testing capture?
- [ ] **Timeouts:** If capture or “waiting for device” often fails, try increasing `deviceTimeoutSeconds` (or the registration/device-specific timeouts) and retest.
- [ ] **PermissionError 2:** Reproduce the error, then add mapping for `PermissionError.connectionError` and confirm the user sees the new message.
- [ ] **MWDAT config:** For production, set MetaAppID, ClientToken, and TeamID and retest registration and device visibility.

---

**End of audit.** No code was modified; this document is analysis and recommendations only.
