import ExpoModulesCore
import Foundation
import ImageIO
import MWDATCamera
import MWDATCore

public class ExpoWearablesCameraModule: Module {
  private enum TimeoutError: Error {
    case timedOut
  }

  private let deviceWaitTimeoutSeconds: TimeInterval = 45.0
  private let streamTimeoutSeconds: TimeInterval = 45.0
  private let photoTimeoutSeconds: TimeInterval = 45.0
  private var isInitialized = false
  private var monitoringTask: Task<Void, Never>?
  private var registrationListenerToken: (any MWDATCore.AnyListenerToken)?
  private var deviceSelector: MWDATCore.AutoDeviceSelector?
  private var lastRegistrationState: MWDATCore.RegistrationState = .unavailable
  private var hasActiveDevice = false
  private var lastError: String?
  private var streamSession: MWDATCamera.StreamSession?
  private var isCapturing = false

  public func definition() -> ModuleDefinition {
    Name("ExpoWearablesCamera")
    Events("onWearablesStatus")

    OnDestroy {
      Task { @MainActor in
        if let session = self.streamSession {
          await session.stop()
        }
        self.streamSession = nil
      }
      self.monitoringTask?.cancel()
      self.monitoringTask = nil
      self.registrationListenerToken = nil
      self.deviceSelector = nil
    }

    AsyncFunction("initialize") { (promise: Promise) in
      Task { @MainActor in
        do {
          try self.initializeSDK()
          promise.resolve(nil)
        } catch {
          promise.reject("INIT_ERROR", "Failed to initialize Wearables SDK: \(error.localizedDescription)")
        }
      }
    }

    AsyncFunction("requestAndroidPermissions") { (promise: Promise) in
      promise.resolve(false)
    }

    AsyncFunction("startMonitoring") { (promise: Promise) in
      Task { @MainActor in
        do {
          try self.initializeSDK()
          self.beginMonitoring()
          promise.resolve(nil)
        } catch {
          self.lastError = error.localizedDescription
          promise.reject("MONITOR_ERROR", "Failed to start monitoring: \(error.localizedDescription)")
        }
      }
    }

    AsyncFunction("getStatus") { (promise: Promise) in
      promise.resolve(self.statusPayload())
    }

    AsyncFunction("requestWearablesCameraPermission") { (promise: Promise) in
      Task { @MainActor in
        do {
          try self.initializeSDK()
          let status = try await self.ensureCameraPermission()
          promise.resolve(status == .granted ? "granted" : "denied")
        } catch let error as MWDATCore.PermissionError {
          let message = self.permissionErrorMessage(error)
          print("[ExpoWearablesCamera] requestWearablesCameraPermission PermissionError: \(message)")
          self.lastError = message
          promise.reject("PERMISSION_ERROR", message)
        } catch is TimeoutError {
          let message = "Permission request timed out. Complete the prompt in Meta AI and try again."
          self.lastError = message
          promise.reject("PERMISSION_ERROR", message)
        } catch {
          self.lastError = error.localizedDescription
          promise.reject("PERMISSION_ERROR", "Failed to request camera permission: \(error.localizedDescription)")
        }
      }
    }

    AsyncFunction("startRegistration") { (promise: Promise) in
      Task { @MainActor in
        do {
          try self.initializeSDK()
          let currentState = Wearables.shared.registrationState
          print("[ExpoWearablesCamera] startRegistration called, current state: \(self.registrationStateName(currentState))")
          if currentState == .registered {
            print("[ExpoWearablesCamera] Already registered, resolving immediately")
            promise.resolve(nil)
            return
          }
          try Wearables.shared.startRegistration()
          print("[ExpoWearablesCamera] startRegistration succeeded, awaiting callback from Meta AI")
          promise.resolve(nil)
        } catch {
          print("[ExpoWearablesCamera] startRegistration error: \(error)")
          self.lastError = error.localizedDescription
          promise.reject("REGISTRATION_ERROR", "Failed to start registration with Meta AI: \(error.localizedDescription)")
        }
      }
    }

    AsyncFunction("handleUrl") { (urlString: String, promise: Promise) in
      Task { @MainActor in
        do {
          try self.initializeSDK()
          guard let url = URL(string: urlString) else {
            promise.resolve(false)
            return
          }
          let handled = try await Wearables.shared.handleUrl(url)
          print("####URL handled:#### \(handled)")
          promise.resolve(handled)
        } catch {
          self.lastError = error.localizedDescription
          promise.reject("HANDLE_URL_ERROR", "Failed to handle URL: \(error.localizedDescription)")
        }
      }
    }

    AsyncFunction("awaitRegistration") { (promise: Promise) in
      Task { @MainActor in
        do {
          try self.initializeSDK()
          try await self.ensureRegistered()
          promise.resolve(nil)
        } catch is TimeoutError {
          let message = "Registration timed out. Complete the flow in Meta AI and return to the app."
          self.lastError = message
          promise.reject("REGISTRATION_WAIT_ERROR", message)
        } catch {
          self.lastError = error.localizedDescription
          promise.reject("REGISTRATION_WAIT_ERROR", "Failed while waiting for registration: \(error.localizedDescription)")
        }
      }
    }

    AsyncFunction("getRegistrationState") { (promise: Promise) in
      promise.resolve(self.registrationStateName(self.lastRegistrationState))
    }

    AsyncFunction("capturePhotoToTempFile") { (promise: Promise) in
      Task { @MainActor in
        do {
          try self.initializeSDK()
          try await self.ensureRegistered()

          let permissionStatus = try await self.ensureCameraPermission()
          guard permissionStatus == .granted else {
            throw NSError(domain: "ExpoWearablesCamera", code: 1, userInfo: [
              NSLocalizedDescriptionKey: "Camera permission not granted",
            ])
          }

          let result = try await self.capturePhotoToTempFile()
          promise.resolve(result)
        } catch let error as MWDATCore.PermissionError {
          let message = self.permissionErrorMessage(error)
          print("[ExpoWearablesCamera] capturePhotoToTempFile PermissionError: \(message)")
          self.lastError = message
          promise.reject("PERMISSION_ERROR", message)
        } catch is TimeoutError {
          let message = "Capture timed out. Ensure glasses are on, nearby, and camera permission is granted in Meta AI."
          self.lastError = message
          promise.reject("CAPTURE_ERROR", message)
        } catch let error as MWDATCamera.StreamSessionError {
          let message = self.streamSessionErrorMessage(error)
          self.lastError = message
          promise.reject("CAPTURE_ERROR", message)
        } catch {
          self.lastError = error.localizedDescription
          promise.reject("CAPTURE_ERROR", "Failed to capture photo: \(error.localizedDescription)")
        }
      }
    }
  }

  // MARK: - SDK Initialization

  @MainActor
  private func initializeSDK() throws {
    if isInitialized { return }

    do {
      try Wearables.configure()
    } catch {
      let errorText = String(describing: error)
      if !errorText.contains("alreadyConfigured") {
        throw error
      }
    }

    isInitialized = true
    lastRegistrationState = Wearables.shared.registrationState
  }

  // MARK: - Monitoring

  @MainActor
  private func beginMonitoring() {
    if monitoringTask != nil { return }

    let wearables = Wearables.shared
    let selector = MWDATCore.AutoDeviceSelector(wearables: wearables)
    deviceSelector = selector
    lastRegistrationState = wearables.registrationState
    hasActiveDevice = selector.activeDevice != nil

    registrationListenerToken =
      wearables.addRegistrationStateListener { [weak self] state in
        Task { @MainActor [weak self] in
          guard let self else { return }
          let oldName = self.registrationStateName(self.lastRegistrationState)
          let newName = self.registrationStateName(state)
          print("[ExpoWearablesCamera] registrationState changed: \(oldName) -> \(newName)")
          self.lastRegistrationState = state
          await self.teardownSessionIfNeeded()
          self.emitStatus()
        }
      }

    monitoringTask = Task { [weak self] in
      for await deviceId in selector.activeDeviceStream() {
        guard let self else { return }
        self.hasActiveDevice = deviceId != nil
        Task { @MainActor in
          await self.teardownSessionIfNeeded()
        }
        self.emitStatus()
      }
    }

    Task { @MainActor in
      await self.teardownSessionIfNeeded()
      self.emitStatus()
    }
  }

  // MARK: - Status

  private func registrationStateName(_ state: MWDATCore.RegistrationState) -> String {
    switch state {
    case .unavailable: return "Unavailable"
    case .available: return "Available"
    case .registering: return "Registering"
    case .registered: return "Registered"
    @unknown default: return "Unknown"
    }
  }

  private func permissionErrorMessage(_ error: MWDATCore.PermissionError) -> String {
    switch error {
    case .noDevice: return "No wearable device found. Ensure glasses are paired."
    case .noDeviceWithConnection: return "Device is disconnected or powered off."
    case .connectionError: return "Connection error communicating with device."
    case .metaAINotInstalled: return "Cannot reach Meta AI app. Ensure it is installed and updated."
    case .requestInProgress: return "A permission request is already in progress."
    case .requestTimeout: return "Permission request timed out."
    case .internalError: return "Internal SDK error occurred."
    @unknown default: return "Unknown permission error: \(error.localizedDescription)"
    }
  }

  private func streamSessionErrorMessage(_ error: MWDATCamera.StreamSessionError) -> String {
    switch error {
    case .deviceNotFound: return "No active device found. Ensure glasses are on and camera permission is granted in Meta AI."
    case .deviceNotConnected: return "Device disconnected. Ensure glasses are on and nearby."
    case .timeout: return "Stream or capture timed out. Ensure glasses are on, nearby, and try again."
    case .videoStreamingError: return "Video streaming error. Try again."
    case .audioStreamingError: return "Audio streaming error. Try again."
    case .permissionDenied: return "Camera permission not granted in Meta AI."
    case .internalError: return "Internal streaming error. Try again."
    @unknown default: return "Stream error: \(error.localizedDescription)"
    }
  }

  private func statusPayload() -> [String: Any] {
    [
      "registrationState": registrationStateName(lastRegistrationState),
      "registrationStateDetail": lastRegistrationState.description,
      "hasActiveDevice": hasActiveDevice,
      "lastError": lastError as Any,
    ]
  }

  private func emitStatus() {
    let payload = statusPayload()
    print("[ExpoWearablesCamera] emitStatus: registrationState=\(payload["registrationState"] ?? "nil"), hasActiveDevice=\(payload["hasActiveDevice"] ?? "nil"), lastError=\(payload["lastError"] ?? "nil")")
    sendEvent("onWearablesStatus", payload)
  }

  // Only tears down the session when the device disconnects or registration is lost.
  // Does NOT pre-start sessions — that caused conflicts with the capture flow.
  @MainActor
  private func teardownSessionIfNeeded() async {
    if isCapturing {
      print("[ExpoWearablesCamera] Skipping teardown — capture in progress")
      return
    }
    let shouldHaveSession = (lastRegistrationState == .registered && hasActiveDevice)
    if !shouldHaveSession, let session = streamSession {
      print("[ExpoWearablesCamera] Stopping session (device disconnected or not registered)")
      await session.stop()
      streamSession = nil
    }
  }

  // MARK: - Permissions

  @MainActor
  private func ensureCameraPermission() async throws -> MWDATCore.PermissionStatus {
    let wearables = Wearables.shared
    let current = try await wearables.checkPermissionStatus(.camera)
    if current == .granted { return current }
    return try await wearables.requestPermission(.camera)
  }

  // MARK: - Registration

  @MainActor
  private func ensureRegistered() async throws {
    let wearables = Wearables.shared
    if wearables.registrationState == .registered { return }

    let stream = wearables.registrationStateStream()
    do {
      try wearables.startRegistration()
    } catch let error as MWDATCore.RegistrationError where error == .alreadyRegistered {
      return
    }

    try await withTimeout(deviceWaitTimeoutSeconds) {
      for await state in stream {
        if state == .registered { return }
      }
      throw TimeoutError.timedOut
    }
  }

  // MARK: - Photo Capture

  // Fully self-contained: each call stops any leftover session, creates a fresh
  // one, starts it, captures a photo, and stops. This guarantees every tap gets
  // a clean session and avoids stale-session problems on repeated captures.
  @MainActor
  private func capturePhotoToTempFile() async throws -> [String: Any] {
    isCapturing = true
    defer { isCapturing = false }

    if let old = streamSession {
      print("[ExpoWearablesCamera] Stopping leftover session before new capture")
      await old.stop()
      streamSession = nil
    }

    guard let selector = deviceSelector else {
      throw NSError(domain: "ExpoWearablesCamera", code: 0, userInfo: [
        NSLocalizedDescriptionKey: "Monitoring not started. Call startMonitoring first.",
      ])
    }

    _ = try await waitForActiveDevice(selector: selector, timeout: deviceWaitTimeoutSeconds)

    let config = MWDATCamera.StreamSessionConfig(videoCodec: .raw, resolution: .low, frameRate: 24)
    let session = MWDATCamera.StreamSession(streamSessionConfig: config, deviceSelector: selector)
    streamSession = session

    print("[ExpoWearablesCamera] Starting fresh stream session for capture")
    await session.start()

    do {
      try await waitForStreamState(session, state: .streaming, timeout: streamTimeoutSeconds)
      print("[ExpoWearablesCamera] Stream is live, setting up capture")

      let photoData = try await captureAndWaitForPhoto(session, timeout: photoTimeoutSeconds)
      let result = try writePhotoToTempFile(photoData)

      print("[ExpoWearablesCamera] Capture complete, stopping session")
      await session.stop()
      streamSession = nil

      return result
    } catch {
      print("[ExpoWearablesCamera] Capture failed, cleaning up session: \(error)")
      await session.stop()
      streamSession = nil
      throw error
    }
  }

  @MainActor
  private func waitForActiveDevice(
    selector: MWDATCore.AutoDeviceSelector,
    timeout: TimeInterval
  ) async throws -> MWDATCore.DeviceIdentifier {
    if let active = selector.activeDevice { return active }

    let stream = selector.activeDeviceStream()
    return try await withTimeout(timeout) {
      for await deviceId in stream {
        if let active = deviceId { return active }
      }
      throw TimeoutError.timedOut
    }
  }

  @MainActor
  private func waitForStreamState(
    _ session: MWDATCamera.StreamSession,
    state desired: MWDATCamera.StreamSessionState,
    timeout: TimeInterval
  ) async throws {
    let stream = AsyncStream<MWDATCamera.StreamSessionState> { continuation in
      let token = session.statePublisher.listen { state in
        continuation.yield(state)
      }
      // Yield the current state immediately so we don't miss a fast transition
      continuation.yield(session.state)
      continuation.onTermination = { _ in
        Task { await token.cancel() }
      }
    }

    try await withTimeout(timeout) {
      for await state in stream {
        if state == desired { return }
      }
      throw TimeoutError.timedOut
    }
  }

  /// Sets up photo/error/state listeners BEFORE firing capturePhoto to guarantee
  /// we never miss the photo data event. Also listens for errors and unexpected
  /// session stops so we fail immediately instead of hanging until timeout.
  @MainActor
  private func captureAndWaitForPhoto(
    _ session: MWDATCamera.StreamSession,
    timeout: TimeInterval
  ) async throws -> MWDATCamera.PhotoData {
    let stream = AsyncThrowingStream<MWDATCamera.PhotoData, Error> { continuation in
      let photoToken = session.photoDataPublisher.listen { photo in
        continuation.yield(photo)
        continuation.finish()
      }
      let errorToken = session.errorPublisher.listen { error in
        continuation.finish(throwing: error)
      }
      let stateToken = session.statePublisher.listen { state in
        if state == .stopped || state == .stopping {
          continuation.finish(throwing: NSError(
            domain: "ExpoWearablesCamera",
            code: 3,
            userInfo: [NSLocalizedDescriptionKey: "Stream session stopped unexpectedly during capture"]
          ))
        }
      }
      continuation.onTermination = { _ in
        Task {
          await photoToken.cancel()
          await errorToken.cancel()
          await stateToken.cancel()
        }
      }
    }

    print("[ExpoWearablesCamera] Capturing photo, waiting for data...")
    guard session.capturePhoto(format: .jpeg) else {
      throw NSError(domain: "ExpoWearablesCamera", code: 2, userInfo: [
        NSLocalizedDescriptionKey: "Photo capture request failed",
      ])
    }

    return try await withTimeout(timeout) {
      for try await photo in stream {
        return photo
      }
      throw TimeoutError.timedOut
    }
  }

  // MARK: - Utilities

  private func writePhotoToTempFile(_ photoData: MWDATCamera.PhotoData) throws -> [String: Any] {
    let timestamp = Int(Date().timeIntervalSince1970)
    let fileExtension = photoData.format == .jpeg ? "jpg" : "heic"
    let fileName = "meta-photo-\(timestamp).\(fileExtension)"
    let tempUrl = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)

    try photoData.data.write(to: tempUrl, options: [.atomic])

    let (width, height) = imageSize(from: photoData.data)

    return [
      "localPath": tempUrl.path,
      "width": width,
      "height": height,
      "sizeBytes": photoData.data.count,
      "timestamp": timestamp,
    ]
  }

  private func imageSize(from data: Data) -> (Int, Int) {
    guard
      let source = CGImageSourceCreateWithData(data as CFData, nil),
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
      let height = properties[kCGImagePropertyPixelHeight] as? NSNumber
    else { return (0, 0) }

    return (width.intValue, height.intValue)
  }

  private func withTimeout<T: Sendable>(
    _ timeout: TimeInterval,
    operation: @escaping @Sendable () async throws -> T
  ) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
      group.addTask {
        try await operation()
      }
      group.addTask {
        try await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
        throw TimeoutError.timedOut
      }
      let result = try await group.next()!
      group.cancelAll()
      return result
    }
  }
}
