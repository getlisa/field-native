import ExpoModulesCore
import Foundation
import ImageIO
import MWDATCamera
import MWDATCore

public class ExpoWearablesCameraModule: Module {
  private enum TimeoutError: Error {
    case timedOut
  }

  private let deviceTimeoutSeconds: TimeInterval = 8.0
  private var isInitialized = false
  private var monitoringTask: Task<Void, Never>?
  private var registrationListenerToken: (any MWDATCore.AnyListenerToken)?
  private var deviceSelector: MWDATCore.AutoDeviceSelector?
  private var lastRegistrationState: MWDATCore.RegistrationState = .unavailable
  private var hasActiveDevice = false
  private var lastError: String?

  public func definition() -> ModuleDefinition {
    Name("ExpoWearablesCamera")
    Events("onWearablesStatus")

    OnDestroy {
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
          self.emitStatus()
        }
      }

    monitoringTask = Task { [weak self] in
      for await deviceId in selector.activeDeviceStream() {
        guard let self else { return }
        self.hasActiveDevice = deviceId != nil
        self.emitStatus()
      }
    }

    emitStatus()
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

    try await withTimeout(deviceTimeoutSeconds) {
      for await state in stream {
        if state == .registered { return }
      }
      throw TimeoutError.timedOut
    }
  }

  // MARK: - Photo Capture

  @MainActor
  private func capturePhotoToTempFile() async throws -> [String: Any] {
    let wearables = Wearables.shared
    let selector = MWDATCore.AutoDeviceSelector(wearables: wearables)
    _ = try await waitForActiveDevice(selector: selector, timeout: deviceTimeoutSeconds)

    let config = MWDATCamera.StreamSessionConfig(videoCodec: .raw, resolution: .low, frameRate: 24)
    let session = MWDATCamera.StreamSession(streamSessionConfig: config, deviceSelector: selector)

    await session.start()

    do {
      try await waitForStreamState(session, state: .streaming, timeout: deviceTimeoutSeconds)

      guard session.capturePhoto(format: .jpeg) else {
        await session.stop()
        throw NSError(domain: "ExpoWearablesCamera", code: 2, userInfo: [
          NSLocalizedDescriptionKey: "Photo capture request failed",
        ])
      }

      let photoData = try await waitForPhotoData(session, timeout: deviceTimeoutSeconds)
      await session.stop()
      return try writePhotoToTempFile(photoData)
    } catch {
      await session.stop()
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

  @MainActor
  private func waitForPhotoData(
    _ session: MWDATCamera.StreamSession,
    timeout: TimeInterval
  ) async throws -> MWDATCamera.PhotoData {
    let stream = AsyncStream<MWDATCamera.PhotoData> { continuation in
      let token = session.photoDataPublisher.listen { photo in
        continuation.yield(photo)
      }
      continuation.onTermination = { _ in
        Task { await token.cancel() }
      }
    }

    return try await withTimeout(timeout) {
      for await photo in stream {
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
