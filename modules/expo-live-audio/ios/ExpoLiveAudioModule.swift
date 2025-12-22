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
    
    // Define events
    Events("onAudioChunk", "onStarted", "onStopped", "onError")
  }
  
  // MARK: - Audio Session Configuration
  
  private func configureAudioSession(config: [String: Any]) throws {
    let audioSession = AVAudioSession.sharedInstance()
    
    // Parse category
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
    
    // Parse mode
    let modeString = config["mode"] as? String ?? "Default"
    var mode: AVAudioSession.Mode = .default
    switch modeString {
    case "Measurement":
      mode = .measurement
    case "VideoRecording":
      mode = .videoRecording
    case "VoiceChat":
      mode = .voiceChat
    default:
      mode = .default
    }
    
    // Parse options
    var options: AVAudioSession.CategoryOptions = []
    if config["allowBluetooth"] as? Bool == true {
      options.insert(.allowBluetooth)
    }
    if config["allowBluetoothA2DP"] as? Bool == true {
      options.insert(.allowBluetoothA2DP)
    }
    
    try audioSession.setCategory(category, mode: mode, options: options)
    try audioSession.setActive(true)
    
    print("[ExpoLiveAudio] ✅ Audio session configured (category: \(categoryString), mode: \(modeString))")
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
    
    // Configure audio session for recording
    let audioSession = AVAudioSession.sharedInstance()
    try audioSession.setCategory(.record, mode: .measurement, options: [])
    try audioSession.setActive(true)
    
    // Initialize audio engine
    audioEngine = AVAudioEngine()
    guard let engine = audioEngine else {
      throw NSError(domain: "ExpoLiveAudio", code: -2, userInfo: [NSLocalizedDescriptionKey: "Failed to create audio engine"])
    }
    
    inputNode = engine.inputNode
    guard let input = inputNode else {
      throw NSError(domain: "ExpoLiveAudio", code: -3, userInfo: [NSLocalizedDescriptionKey: "Failed to get input node"])
    }
    
    // Get the hardware's native format - we MUST tap with this format or compatible format
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
    
    // Deactivate audio session
    try? AVAudioSession.sharedInstance().setActive(false)
    
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
    var audioData = Data(capacity: totalBytes)
    
    if channelCount == 1 {
      // Mono: Direct copy from channel 0
      let channelData = int16ChannelData[0]
      for frame in 0..<frameLength {
        let sample = channelData[frame]
        withUnsafeBytes(of: sample.littleEndian) { bytes in
          audioData.append(contentsOf: bytes)
        }
      }
    } else {
      // Multi-channel: Interleave channels
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
  
  // MARK: - Cleanup
  
  private func cleanup() {
    stopRecording()
    audioEngine = nil
    inputNode = nil
    audioConverter = nil
    isInitialized = false
    print("[ExpoLiveAudio] 🧹 Cleaned up")
  }
}
