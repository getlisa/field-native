import ExpoModulesCore
import AVFoundation

public class ExpoLiveAudioModule: Module {
  // Audio engine components
  private var audioEngine: AVAudioEngine?
  private var inputNode: AVAudioInputNode?
  private var audioConverter: AVAudioConverter?
  
  // Audio format configuration (target output format)
  private var targetSampleRate: Double = 16000
  private var targetChannels: AVAudioChannelCount = 1
  private var bitsPerSample: Int = 16
  private var bufferSize: Int = 2048
  
  // Recording state
  private var isRecording = false
  private var isInitialized = false
  
  // Debug: chunk counter
  private var chunkCount = 0
  
  // Notification observers for audio interruptions
  private var interruptionObserver: NSObjectProtocol?
  private var routeChangeObserver: NSObjectProtocol?
  
  public func definition() -> ModuleDefinition {
    Name("ExpoLiveAudio")
    
    OnDestroy {
      self.cleanup()
    }
    
    // Initialize audio recorder
    Function("init") { (config: [String: Any]) in
      self.targetSampleRate = config["sampleRate"] as? Double ?? 16000
      let channelsValue = config["channels"] as? Int ?? 1
      self.targetChannels = AVAudioChannelCount(channelsValue)
      self.bitsPerSample = config["bitsPerSample"] as? Int ?? 16
      self.bufferSize = config["bufferSize"] as? Int ?? 2048
      
      self.isInitialized = true
      print("[ExpoLiveAudio] ✅ Initialized (target: \(self.targetSampleRate)Hz, \(channelsValue) ch, \(self.bitsPerSample) bits)")
    }
    
    // Start recording
    AsyncFunction("start") { (promise: Promise) in
      do {
        try self.startRecording()
        promise.resolve(nil)
      } catch {
        print("[ExpoLiveAudio] ❌ Failed to start: \(error)")
        promise.reject("START_ERROR", "Failed to start recording: \(error.localizedDescription)")
      }
    }
    
    // Stop recording
    Function("stop") {
      self.stopRecording()
    }
    
    // Configure audio session (iOS only)
    AsyncFunction("configureAudioSession") { (config: [String: Any], promise: Promise) in
      do {
        try self.configureAudioSession(config: config)
        promise.resolve(nil)
      } catch {
        print("[ExpoLiveAudio] ❌ Failed to configure audio session: \(error)")
        promise.reject("SESSION_ERROR", "Failed to configure audio session: \(error.localizedDescription)")
      }
    }

    // Prefer Bluetooth input when available (fallback to built-in mic)
    AsyncFunction("preferBluetoothInput") { (promise: Promise) in
      do {
        let info = try self.preferBluetoothInput()
        promise.resolve(info as Any)
      } catch {
        print("[ExpoLiveAudio] ❌ Failed to prefer Bluetooth input: \(error)")
        promise.reject("PREFERRED_INPUT_ERROR", "Failed to prefer Bluetooth input: \(error.localizedDescription)")
      }
    }
    
    // Define events
    Events("onAudioChunk", "onStarted", "onStopped", "onError", "onInterruptionBegan", "onInterruptionEnded")
  }
  
  // MARK: - Audio Session Configuration
  
  private func configureAudioSession(config: [String: Any]) throws {
    let audioSession = AVAudioSession.sharedInstance()
    
    // Parse category (default to PlayAndRecord for voice input)
    let categoryString = config["category"] as? String ?? "PlayAndRecord"
    var category: AVAudioSession.Category
    switch categoryString {
    case "PlayAndRecord":
      category = .playAndRecord
    case "Record":
      category = .record
    default:
      category = .playAndRecord
    }
    
    // Parse mode - DEFAULT TO VOICE CHAT for transcription clarity
    let modeString = config["mode"] as? String ?? "VoiceChat"
    var mode: AVAudioSession.Mode = .voiceChat // Best for speech transcription with noise gating
    switch modeString {
    case "Measurement":
      mode = .measurement  // Reduces gain - not recommended for voice!
    case "VideoRecording":
      mode = .videoRecording  // Sensitive but less optimized for speech
    case "VoiceChat":
      mode = .voiceChat  // Best for transcription - optimized for speech frequencies + aggressive noise gating
    case "Default":
      mode = .default
    default:
      mode = .voiceChat
    }
    
    // Parse options - ADD DEFAULT BLUETOOTH SUPPORT & SPEAKER MODE
    var options: AVAudioSession.CategoryOptions = [.defaultToSpeaker]
    if config["allowBluetooth"] as? Bool ?? true {  // Default to true
      options.insert(.allowBluetooth)
    }
    if config["allowBluetoothA2DP"] as? Bool == true {
      options.insert(.allowBluetoothA2DP)
    }
    
    // Set category with options
    try audioSession.setCategory(category, mode: mode, options: options)
    print("[ExpoLiveAudio] ✅ Audio session category configured (category: \(categoryString), mode: \(modeString))")
    
    // NOTE: Manual input gain control is intentionally NOT set here
    // Manual gain (setInputGain) conflicts with Voice Processing AGC
    // By letting setVoiceProcessingEnabled(true) handle gain, the iPhone will:
    // - Automatically boost voice when technician moves away from phone
    // - Automatically lower gain when technician gets close
    // - Use multi-mic array for "Null Steering" to ignore background noise
    // This results in cleaner audio with less static than manual gain control
    if audioSession.isInputGainSettable {
      print("[ExpoLiveAudio] ℹ️ Input gain is settable but using automatic AGC via Voice Processing for better clarity")
    } else {
      print("[ExpoLiveAudio] ℹ️ Input gain not settable (using automatic AGC via Voice Processing)")
    }
    
    // OPTIMIZE: Select the best microphone for voice chat (prefer bottom mic for speakerphone)
    if let availableInputs = audioSession.availableInputs {
      for input in availableInputs {
        if input.portType == .builtInMic {
          do {
            try audioSession.setPreferredInput(input)
            print("[ExpoLiveAudio] 🎤 Selected built-in microphone")
            
            // Try to select the bottom or front microphone data source (best for distant voice)
            if let dataSources = input.dataSources {
              for dataSource in dataSources {
                if dataSource.orientation == .bottom || dataSource.orientation == .front {
                  do {
                    try input.setPreferredDataSource(dataSource)
                    print("[ExpoLiveAudio] 🎤 Using \(dataSource.orientation == .bottom ? "bottom" : "front") microphone for better distant pickup")
                    break
                  } catch {
                    print("[ExpoLiveAudio] ⚠️ Could not set preferred data source: \(error)")
                  }
                }
              }
            }
          } catch {
            print("[ExpoLiveAudio] ⚠️ Could not set preferred input: \(error)")
          }
          break
        }
      }
    }
    
    // Activate session
    do {
      try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
      print("[ExpoLiveAudio] ✅ Audio session activated with voice optimizations")
    } catch {
      print("[ExpoLiveAudio] ⚠️ Could not activate audio session: \(error)")
      // Try one more time without options
      try audioSession.setActive(true)
      print("[ExpoLiveAudio] ✅ Audio session activated (fallback)")
    }
  }

  private func preferBluetoothInput() throws -> [String: Any]? {
    let audioSession = AVAudioSession.sharedInstance()

    guard let availableInputs = audioSession.availableInputs, !availableInputs.isEmpty else {
      print("[ExpoLiveAudio] ⚠️ No available audio inputs")
      return nil
    }

    if let bluetoothInput = availableInputs.first(where: { input in
      input.portType == .bluetoothHFP || input.portType == .bluetoothLE
    }) {
      try audioSession.setPreferredInput(bluetoothInput)
      print("[ExpoLiveAudio] 🎧 Preferred Bluetooth microphone: \(bluetoothInput.portType.rawValue)")
      return [
        "type": bluetoothInput.portType.rawValue,
        "productName": bluetoothInput.portName,
        "isBluetooth": true,
        "isBuiltIn": false
      ]
    }

    if let builtInMic = availableInputs.first(where: { $0.portType == .builtInMic }) {
      try audioSession.setPreferredInput(builtInMic)
      print("[ExpoLiveAudio] 🎤 Preferred built-in microphone (Bluetooth not available)")
      return [
        "type": builtInMic.portType.rawValue,
        "productName": builtInMic.portName,
        "isBluetooth": false,
        "isBuiltIn": true
      ]
    }

    print("[ExpoLiveAudio] ⚠️ No suitable microphone input found")
    return nil
  }
  
  // MARK: - Recording Control
  
  private func startRecording() throws {
    if isRecording {
      print("[ExpoLiveAudio] ⚠️ Already recording")
      return
    }
    
    guard isInitialized else {
      throw NSError(domain: "ExpoLiveAudio", code: -1, userInfo: [NSLocalizedDescriptionKey: "Not initialized. Call init() first."])
    }
    
    // Reset chunk counter
    chunkCount = 0
    
    // Ensure audio session is active (but DON'T reconfigure category/mode)
    // The app should configure the session BEFORE calling start() via configureAudioSession()
    let audioSession = AVAudioSession.sharedInstance()
    
    // Only activate if not already active - preserve existing configuration
    if !audioSession.isOtherAudioPlaying {
      do {
        try audioSession.setActive(true)
        print("[ExpoLiveAudio] ✅ Audio session activated (preserving existing configuration)")
      } catch {
        print("[ExpoLiveAudio] ⚠️ Could not activate audio session: \(error)")
        // Continue anyway - session might already be active
      }
    }
    
    // Initialize audio engine
    audioEngine = AVAudioEngine()
    guard let engine = audioEngine else {
      throw NSError(domain: "ExpoLiveAudio", code: -2, userInfo: [NSLocalizedDescriptionKey: "Failed to create audio engine"])
    }
    
    inputNode = engine.inputNode
    guard let input = inputNode else {
      throw NSError(domain: "ExpoLiveAudio", code: -3, userInfo: [NSLocalizedDescriptionKey: "Failed to get input node"])
    }
    
    // CRITICAL: Enable Hardware Voice Processing I/O Unit
    // This activates the iPhone's system-level AGC, Noise Suppression, and Multi-Mic Array processing
    // This is the "WhatsApp-style" clean voice processing that eliminates static
    do {
      try input.setVoiceProcessingEnabled(true)
      print("[ExpoLiveAudio] 🎙️ Voice Processing ENABLED")
      
      // Ensure bypass is false so the filters actually run (reduces static)
      // Note: isVoiceProcessingBypassed is a property, not a method
      input.isVoiceProcessingBypassed = false
      print("[ExpoLiveAudio] 🎚️ Voice Processing Bypass DISABLED (filters active)")
    } catch {
      print("[ExpoLiveAudio] ⚠️ Voice Processing not supported on this device: \(error)")
      // Continue anyway - older devices might not support it
    }
    
    // IMPORTANT: When Voice Processing is enabled, iOS often forces hardware format to 48kHz
    // Our converter already handles this, so this will work seamlessly
    let hardwareFormat = input.outputFormat(forBus: 0)
    print("[ExpoLiveAudio] 🎤 Hardware format: \(hardwareFormat.sampleRate)Hz, \(hardwareFormat.channelCount) ch, \(hardwareFormat.commonFormat.rawValue)")
    
    // Create target output format (what we want to send to JS)
    // Use NON-INTERLEAVED format so we can access int16ChannelData
    guard let targetFormat = AVAudioFormat(
      commonFormat: .pcmFormatInt16,
      sampleRate: targetSampleRate,
      channels: targetChannels,
      interleaved: false  // Non-interleaved for int16ChannelData access
    ) else {
      throw NSError(domain: "ExpoLiveAudio", code: -4, userInfo: [NSLocalizedDescriptionKey: "Failed to create target audio format"])
    }
    
    print("[ExpoLiveAudio] 🎯 Target format: \(targetFormat.sampleRate)Hz, \(targetFormat.channelCount) ch, Int16, non-interleaved")
    
    // Create audio converter from hardware format to target format
    guard let converter = AVAudioConverter(from: hardwareFormat, to: targetFormat) else {
      throw NSError(domain: "ExpoLiveAudio", code: -5, userInfo: [NSLocalizedDescriptionKey: "Failed to create audio converter"])
    }
    audioConverter = converter
    print("[ExpoLiveAudio] ✅ Audio converter created")
    
    // Install tap using hardware format (required by iOS)
    // We'll convert the audio in the callback
    let tapBufferSize = AVAudioFrameCount(self.bufferSize)
    input.installTap(onBus: 0, bufferSize: tapBufferSize, format: hardwareFormat) { [weak self] (buffer: AVAudioPCMBuffer, time: AVAudioTime) in
      self?.processAudioBuffer(buffer, converter: converter, targetFormat: targetFormat)
    }
    
    // Start engine
    try engine.start()
    
    // Setup audio interruption handling
    setupInterruptionHandling()
    
    isRecording = true
    sendEvent("onStarted", [:])
    
    print("[ExpoLiveAudio] ▶️ Recording started")
  }
  
  private func stopRecording() {
    guard isRecording else {
      print("[ExpoLiveAudio] ⚠️ Not recording")
      return
    }
    
    print("[ExpoLiveAudio] 🛑 Stopping... (sent \(chunkCount) chunks)")
    
    // Remove tap
    inputNode?.removeTap(onBus: 0)
    
    // Stop engine
    audioEngine?.stop()
    
    // Clean up converter
    audioConverter = nil
    
    // DON'T deactivate audio session - this can interrupt other components
    // like WebSocket connections or TTS playback
    // Let the app manage the audio session lifecycle
    // try? AVAudioSession.sharedInstance().setActive(false)
    print("[ExpoLiveAudio] ℹ️ Audio session remains active (preserves WebSocket/network)")
    
    // Remove interruption observers
    removeInterruptionHandling()
    
    isRecording = false
    sendEvent("onStopped", [:])
    
    print("[ExpoLiveAudio] 🛑 Recording stopped")
  }
  
  // MARK: - Audio Processing
  
  private func processAudioBuffer(_ buffer: AVAudioPCMBuffer, converter: AVAudioConverter, targetFormat: AVAudioFormat) {
    // Calculate the output frame count based on sample rate ratio
    let ratio = targetFormat.sampleRate / buffer.format.sampleRate
    let outputFrameCapacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio)
    
    guard outputFrameCapacity > 0 else {
      return
    }
    
    // Create output buffer with target format
    guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: outputFrameCapacity) else {
      print("[ExpoLiveAudio] ❌ Failed to create output buffer")
      return
    }
    
    // Convert the audio
    var error: NSError?
    var inputBufferConsumed = false
    
    let inputBlock: AVAudioConverterInputBlock = { inNumPackets, outStatus in
      if inputBufferConsumed {
        outStatus.pointee = .noDataNow
        return nil
      }
      inputBufferConsumed = true
      outStatus.pointee = .haveData
      return buffer
    }
    
    let status = converter.convert(to: outputBuffer, error: &error, withInputFrom: inputBlock)
    
    if status == .error {
      print("[ExpoLiveAudio] ❌ Conversion error: \(error?.localizedDescription ?? "unknown")")
      return
    }
    
    let frameLength = Int(outputBuffer.frameLength)
    if frameLength == 0 {
      return // No data to send
    }
    
    // Extract Int16 data from converted buffer (non-interleaved format)
    guard let int16ChannelData = outputBuffer.int16ChannelData else {
      print("[ExpoLiveAudio] ❌ No int16 data in converted buffer")
      return
    }
    
    let channelCount = Int(outputBuffer.format.channelCount)
    
    // Build PCM16 interleaved data for output (LRLRLR... or just L for mono)
    let totalBytes = frameLength * channelCount * 2 // PCM16 = 2 bytes per sample
    var audioData: Data
    
    if channelCount == 1 {
      // Mono: High-performance direct memory copy (eliminates jitter/static from looping)
      let channelData = int16ChannelData[0]
      audioData = Data(bytes: channelData, count: frameLength * 2)
    } else {
      // Multi-channel: Interleave channels (but mono is recommended for field techs)
      audioData = Data(capacity: totalBytes)
      for frame in 0..<frameLength {
        for channel in 0..<channelCount {
          let sample = int16ChannelData[channel][frame]
          withUnsafeBytes(of: sample.littleEndian) { bytes in
            audioData.append(contentsOf: bytes)
          }
        }
      }
    }
    
    // Convert to base64
    let base64String = audioData.base64EncodedString()
    
    // Increment chunk counter
    chunkCount += 1
    
    // Log first few chunks for debugging
    if chunkCount <= 3 {
      print("[ExpoLiveAudio] 📦 Chunk #\(chunkCount): \(audioData.count) bytes -> \(base64String.count) base64 chars")
    }
    
    // Emit event
    sendEvent("onAudioChunk", [
      "data": base64String
    ])
  }
  
  // MARK: - Audio Interruption Handling
  
  private func setupInterruptionHandling() {
    let notificationCenter = NotificationCenter.default
    
    // Handle audio interruptions (phone calls, Siri, etc.)
    interruptionObserver = notificationCenter.addObserver(
      forName: AVAudioSession.interruptionNotification,
      object: AVAudioSession.sharedInstance(),
      queue: .main
    ) { [weak self] notification in
      self?.handleInterruption(notification)
    }
    
    // Handle route changes (Bluetooth connect/disconnect, headphone plug, etc.)
    routeChangeObserver = notificationCenter.addObserver(
      forName: AVAudioSession.routeChangeNotification,
      object: AVAudioSession.sharedInstance(),
      queue: .main
    ) { [weak self] notification in
      self?.handleRouteChange(notification)
    }
    
    print("[ExpoLiveAudio] 🎧 Audio interruption handling setup")
  }
  
  private func removeInterruptionHandling() {
    if let observer = interruptionObserver {
      NotificationCenter.default.removeObserver(observer)
      interruptionObserver = nil
    }
    
    if let observer = routeChangeObserver {
      NotificationCenter.default.removeObserver(observer)
      routeChangeObserver = nil
    }
    
    print("[ExpoLiveAudio] 🎧 Audio interruption handling removed")
  }
  
  private func handleInterruption(_ notification: Notification) {
    guard let userInfo = notification.userInfo,
          let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: typeValue) else {
      return
    }
    
    switch type {
    case .began:
      // Interruption began (phone call, Siri, etc.)
      print("[ExpoLiveAudio] ⚠️ Audio interruption began")
      // Audio engine will be paused automatically by iOS
      
      // Notify JS layer so it can pause AudioRecorder and send silence chunks
      sendEvent("onInterruptionBegan", [:])
      
    case .ended:
      // Interruption ended
      guard let optionsValue = userInfo[AVAudioSessionInterruptionOptionKey] as? UInt else {
        return
      }
      let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)
      
      if options.contains(.shouldResume) {
        print("[ExpoLiveAudio] ✅ Audio interruption ended - notifying JS layer to resume")
        
        // DON'T restart the engine here - the tap was removed when paused
        // Let the JS layer handle the full restart via resume() -> init() + start()
        // which will properly re-install the tap
        
        // Just notify JS layer so it can resume AudioRecorder
        sendEvent("onInterruptionEnded", ["shouldResume": true])
      } else {
        print("[ExpoLiveAudio] ℹ️ Audio interruption ended - not resuming")
        
        // Notify JS layer even if not resuming
        sendEvent("onInterruptionEnded", ["shouldResume": false])
      }
      
    @unknown default:
      print("[ExpoLiveAudio] ⚠️ Unknown interruption type")
    }
  }
  
  private func handleRouteChange(_ notification: Notification) {
    guard let userInfo = notification.userInfo,
          let reasonValue = userInfo[AVAudioSessionRouteChangeReasonKey] as? UInt,
          let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue) else {
      return
    }
    
    switch reason {
    case .newDeviceAvailable:
      print("[ExpoLiveAudio] 🎧 New audio device available (Bluetooth/headphones connected)")
      
    case .oldDeviceUnavailable:
      print("[ExpoLiveAudio] 🎧 Audio device removed (Bluetooth/headphones disconnected)")
      // Recording will continue using the default device (speaker/mic)
      
    case .categoryChange:
      print("[ExpoLiveAudio] ℹ️ Audio category changed")
      
    case .override:
      print("[ExpoLiveAudio] ℹ️ Audio route override")
      
    default:
      print("[ExpoLiveAudio] ℹ️ Audio route change: \(reason.rawValue)")
    }
  }
  
  // MARK: - Cleanup
  
  private func cleanup() {
    stopRecording()
    removeInterruptionHandling()
    audioEngine = nil
    inputNode = nil
    audioConverter = nil
    isInitialized = false
    print("[ExpoLiveAudio] 🧹 Cleaned up")
  }
}

