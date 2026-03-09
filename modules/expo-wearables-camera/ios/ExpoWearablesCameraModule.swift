import Combine
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
  private var registrationListenerToken: AnyListenerToken?
  private var deviceSelector: AutoDeviceSelector?
  private var lastRegistrationState: RegistrationState = .unavailable
  private var hasActiveDevice = false
  private var lastError: String?

  public func definition() -> ModuleDefinition {
    Name("ExpoWearablesCamera")
    Events("onWearablesStatus")

    OnDestroy {
      monitoringTask?.cancel()
      monitoringTask = nil
      registrationListenerToken = nil
      deviceSelector = nil
    }

    AsyncFunction("initialize") { (promise: Promise) in
      do {
        try self.ensureInitialized()
        promise.resolve(nil)
      } catch {
        promise.reject("INIT_ERROR", "Failed to initialize Wearables SDK: \(error.localizedDescription)", error)
      }
    }

    AsyncFunction("requestAndroidPermissions") { (promise: Promise) in
      promise.resolve(false)
    }

    AsyncFunction("startMonitoring") { (promise: Promise) in
      Task {
        do {
          try self.ensureInitialized()
          self.startMonitoring()
          promise.resolve(nil)
        } catch {
          self.lastError = error.localizedDescription
          promise.reject("MONITOR_ERROR", "Failed to start monitoring: \(error.localizedDescription)", error)
        }
      }
    }

    AsyncFunction("getStatus") { (promise: Promise) in
      promise.resolve(self.statusPayload())
    }

    AsyncFunction("requestWearablesCameraPermission") { (promise: Promise) in
      Task {
        do {
          try self.ensureInitialized()
          let status = try self.ensureCameraPermission()
          let value = status == .granted ? "granted" : "denied"
          promise.resolve(value)
        } catch {
          self.lastError = error.localizedDescription
          promise.reject("PERMISSION_ERROR", "Failed to request camera permission: \(error.localizedDescription)", error)
        }
      }
    }

    AsyncFunction("startRegistration") { (promise: Promise) in
      Task {
        do {
          try self.ensureInitialized()
          try Wearables.shared.startRegistration()
          promise.resolve(nil)
        } catch {
          self.lastError = error.localizedDescription
          promise.reject(
            "REGISTRATION_ERROR",
            "Failed to start registration with Meta AI: \(error.localizedDescription)",
            error
          )
        }
      }
    }

    AsyncFunction("awaitRegistration") { (promise: Promise) in
      Task {
        do {
          try self.ensureInitialized()
          try await self.ensureRegistered()
          promise.resolve(nil)
        } catch {
          self.lastError = error.localizedDescription
          promise.reject(
            "REGISTRATION_WAIT_ERROR",
            "Failed while waiting for registration: \(error.localizedDescription)",
            error
          )
        }
      }
    }

    AsyncFunction("getRegistrationState") { (promise: Promise) in
      let state = String(describing: self.lastRegistrationState)
      promise.resolve(state)
    }

    AsyncFunction("capturePhotoToTempFile") { (promise: Promise) in
      Task {
        do {
          try self.ensureInitialized()
          try await self.ensureRegistered()

          let permissionStatus = try self.ensureCameraPermission()
          if permissionStatus != .granted {
            throw NSError(domain: "ExpoWearablesCamera", code: 1, userInfo: [
              NSLocalizedDescriptionKey: "Camera permission not granted"
            ])
          }

          let result = try await self.capturePhotoToTempFile()
          promise.resolve(result)
        } catch {
          self.lastError = error.localizedDescription
          promise.reject("CAPTURE_ERROR", "Failed to capture photo: \(error.localizedDescription)", error)
        }
      }
    }
  }

  private func ensureInitialized() throws {
    if isInitialized {
      return
    }

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

  private func startMonitoring() {
    if monitoringTask != nil {
      return
    }

    let wearables = Wearables.shared
    let selector = AutoDeviceSelector(wearables: wearables)
    deviceSelector = selector
    lastRegistrationState = wearables.registrationState
    hasActiveDevice = selector.activeDevice != nil

    registrationListenerToken =
      wearables.addRegistrationStateListener { [weak self] state in
        guard let self else { return }
        self.lastRegistrationState = state
        self.emitStatus()
      }

    monitoringTask =
      Task { [weak self] in
        guard let self else { return }
        for await deviceId in selector.activeDeviceStream() {
          self.hasActiveDevice = deviceId != nil
          self.emitStatus()
        }
      }

    emitStatus()
  }

  private func statusPayload() -> [String: Any] {
    [
      "registrationState": String(describing: lastRegistrationState),
      "registrationStateDetail": lastRegistrationState.description,
      "hasActiveDevice": hasActiveDevice,
      "lastError": lastError as Any
    ]
  }

  private func emitStatus() {
    sendEvent("onWearablesStatus", statusPayload())
  }

  private func ensureCameraPermission() throws -> PermissionStatus {
    let wearables = Wearables.shared
    let current = try wearables.checkPermissionStatus(.camera)
    if current == .granted {
      return current
    }
    return try wearables.requestPermission(.camera)
  }

  private func ensureRegistered() async throws {
    let wearables = Wearables.shared
    if wearables.registrationState == .registered {
      return
    }

    try wearables.startRegistration()
    try await waitForRegistrationState(.registered, timeout: deviceTimeoutSeconds)
  }

  private func waitForRegistrationState(
    _ desired: RegistrationState,
    timeout: TimeInterval
  ) async throws {
    try await withTimeout(timeout) {
      for await state in Wearables.shared.registrationStateStream() {
        lastRegistrationState = state
        if state == desired {
          return
        }
      }
      throw TimeoutError.timedOut
    }
  }

  private func capturePhotoToTempFile() async throws -> [String: Any] {
    let wearables = Wearables.shared
    let selector = AutoDeviceSelector(wearables: wearables)
    _ = try await waitForActiveDevice(selector: selector, timeout: deviceTimeoutSeconds)

    let config = StreamSessionConfig(videoCodec: .raw, resolution: .low, frameRate: 24)
    let session = StreamSession(streamSessionConfig: config, deviceSelector: selector)
    defer { session.stop() }

    session.start()
    try await waitForStreamState(session, state: .streaming, timeout: deviceTimeoutSeconds)

    guard session.capturePhoto(format: .jpeg) else {
      throw NSError(domain: "ExpoWearablesCamera", code: 2, userInfo: [
        NSLocalizedDescriptionKey: "Photo capture request failed"
      ])
    }

    let photoData = try await waitForPhotoData(session, timeout: deviceTimeoutSeconds)
    return try writePhotoToTempFile(photoData)
  }

  private func waitForActiveDevice(
    selector: AutoDeviceSelector,
    timeout: TimeInterval
  ) async throws -> DeviceIdentifier {
    if let active = selector.activeDevice {
      return active
    }

    return try await withTimeout(timeout) {
      for await deviceId in selector.activeDeviceStream() {
        if let active = deviceId {
          return active
        }
      }
      throw TimeoutError.timedOut
    }
  }

  private func waitForStreamState(
    _ session: StreamSession,
    state desired: StreamSessionState,
    timeout: TimeInterval
  ) async throws {
    try await withTimeout(timeout) {
      for await state in session.statePublisher.values {
        if state == desired {
          return
        }
      }
      throw TimeoutError.timedOut
    }
  }

  private func waitForPhotoData(
    _ session: StreamSession,
    timeout: TimeInterval
  ) async throws -> PhotoData {
    try await withTimeout(timeout) {
      for await photo in session.photoDataPublisher.values {
        return photo
      }
      throw TimeoutError.timedOut
    }
  }

  private func writePhotoToTempFile(_ photoData: PhotoData) throws -> [String: Any] {
    let timestamp = Int(Date().timeIntervalSince1970)
    let fileExtension = photoData.format == .jpeg ? "jpg" : "heic"
    let fileName = "meta-photo-\(timestamp).\(fileExtension)"
    let tempUrl = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)

    try photoData.data.write(to: tempUrl, options: [.atomic])

    let (width, height) = imageSize(from: photoData.data)
    let sizeBytes = photoData.data.count

    return [
      "localPath": tempUrl.path,
      "width": width,
      "height": height,
      "sizeBytes": sizeBytes,
      "timestamp": timestamp
    ]
  }

  private func imageSize(from data: Data) -> (Int, Int) {
    guard
      let source = CGImageSourceCreateWithData(data as CFData, nil),
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
      let height = properties[kCGImagePropertyPixelHeight] as? NSNumber
    else {
      return (0, 0)
    }

    return (width.intValue, height.intValue)
  }

  private func withTimeout<T>(
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
