import ExpoModulesCore
import AVFoundation

public class ExpoPcmAudioPlayerModule: Module {
  // Audio engine components
  private var audioEngine: AVAudioEngine?
  private var playerNode: AVAudioPlayerNode?
  private var audioFormat: AVAudioFormat?
  
  // Configuration - incoming PCM16 audio specs
  private var inputSampleRate: Double = 16000
  private var inputChannels: Int = 1
  
  // Playback state
  private var isInitialized = false
  private var isPlaying = false
  private var audioQueue: [AVAudioPCMBuffer] = []
  private var queueLock = NSLock()
  
  // Volume
  private var currentVolume: Float = 1.0
  
  public func definition() -> ModuleDefinition {
    Name("ExpoPcmAudioPlayer")
    
    OnCreate {
      // Will be initialized via initialize() call
    }
    
    OnDestroy {
      self.cleanup()
    }
    
    // Initialize audio player
    AsyncFunction("initialize") { (config: [String: Any], promise: Promise) in
      let sampleRateValue = config["sampleRate"] as? Double ?? 16000
      let channelsValue = config["channels"] as? Int ?? 1
      
      self.inputSampleRate = sampleRateValue
      self.inputChannels = channelsValue
      
      do {
        try self.setupAudioEngine()
        self.isInitialized = true
        print("[ExpoPcmAudioPlayer] ✅ Initialized (input: \(sampleRateValue)Hz, \(channelsValue) channel(s), PCM16)")
        promise.resolve(nil)
      } catch {
        print("[ExpoPcmAudioPlayer] ❌ Failed to initialize: \(error)")
        promise.reject("INIT_ERROR", "Failed to initialize: \(error.localizedDescription)")
      }
    }
    
    // Stream audio chunk
    AsyncFunction("streamChunk") { (base64Data: String, promise: Promise) in
      do {
        try self.streamAudioChunk(base64Data: base64Data)
        promise.resolve(nil)
      } catch {
        promise.reject("STREAM_ERROR", "Failed to stream chunk: \(error.localizedDescription)")
      }
    }
    
    // Start playback
    AsyncFunction("start") { (promise: Promise) in
      do {
        try self.startPlayback()
        promise.resolve(nil)
      } catch {
        promise.reject("PLAY_ERROR", "Failed to start playback: \(error.localizedDescription)")
      }
    }
    
    // Pause playback
    AsyncFunction("pause") { (promise: Promise) in
      self.pausePlayback()
      promise.resolve(nil)
    }
    
    // Stop playback
    AsyncFunction("stop") { (promise: Promise) in
      self.stopPlayback()
      promise.resolve(nil)
    }
    
    // Flush buffer
    AsyncFunction("flush") { (promise: Promise) in
      promise.resolve(nil)
    }
    
    // Set volume
    AsyncFunction("setVolume") { (volume: Double, promise: Promise) in
      self.setVolume(volume: Float(volume))
      promise.resolve(nil)
    }
    
    // Get status
    AsyncFunction("getStatus") { (promise: Promise) in
      let status: [String: Any] = [
        "isPlaying": self.isPlaying,
        "buffered": self.audioQueue.count
      ]
      promise.resolve(status)
    }
  }
  
  // MARK: - Audio Engine Setup
  
  private func setupAudioEngine() throws {
    // Clean up existing engine if any
    cleanup()
    
    // Configure audio session FIRST
    let audioSession = AVAudioSession.sharedInstance()
    try audioSession.setCategory(.playback, mode: .default, options: [.mixWithOthers])
    try audioSession.setActive(true)
    print("[ExpoPcmAudioPlayer] ✅ Audio session configured")
    
    // Initialize audio components
    audioEngine = AVAudioEngine()
    playerNode = AVAudioPlayerNode()
    
    guard let engine = audioEngine,
          let node = playerNode else {
      throw NSError(domain: "ExpoPcmAudioPlayer", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to create audio components"])
    }
    
    // Attach player node to engine FIRST
    engine.attach(node)
    
    // Use Float32 format which is what AVAudioEngine prefers
    // We'll convert from Int16 when streaming
    let format = AVAudioFormat(
      standardFormatWithSampleRate: inputSampleRate,
      channels: AVAudioChannelCount(inputChannels)
    )
    
    guard let format = format else {
      throw NSError(domain: "ExpoPcmAudioPlayer", code: -2, userInfo: [NSLocalizedDescriptionKey: "Failed to create audio format"])
    }
    
    audioFormat = format
    print("[ExpoPcmAudioPlayer] 🎼 Using format: \(format)")
    
    // Connect player node to main mixer
    // Using the format we created (Float32, non-interleaved)
    engine.connect(node, to: engine.mainMixerNode, format: format)
    print("[ExpoPcmAudioPlayer] ✅ Connected player node to mixer")
    
    // Start audio engine
    try engine.start()
    print("[ExpoPcmAudioPlayer] ✅ Audio engine started")
    
    // Set initial volume
    node.volume = currentVolume
  }
  
  // MARK: - Audio Streaming
  
  private func streamAudioChunk(base64Data: String) throws {
    guard isInitialized,
          let format = audioFormat,
          let node = playerNode else {
      print("[ExpoPcmAudioPlayer] ❌ streamAudioChunk: Not initialized")
      throw NSError(domain: "ExpoPcmAudioPlayer", code: -1, userInfo: [NSLocalizedDescriptionKey: "Not initialized"])
    }
    
    // Decode base64 to Data
    guard let audioData = Data(base64Encoded: base64Data) else {
      print("[ExpoPcmAudioPlayer] ❌ streamAudioChunk: Invalid base64 data")
      throw NSError(domain: "ExpoPcmAudioPlayer", code: -2, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 data"])
    }
    
    // Calculate frame count from Int16 PCM data
    // Each frame = channelCount * 2 bytes (Int16)
    let bytesPerFrame = inputChannels * 2
    let frameCount = audioData.count / bytesPerFrame
    
    guard frameCount > 0 else {
      print("[ExpoPcmAudioPlayer] ⚠️ No frames in audio data")
      return
    }
    
    print("[ExpoPcmAudioPlayer] 🎵 Received \(audioData.count) bytes → \(frameCount) frames")
    
    // Create Float32 buffer for AVAudioEngine
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frameCount)) else {
      print("[ExpoPcmAudioPlayer] ❌ Failed to create buffer")
      throw NSError(domain: "ExpoPcmAudioPlayer", code: -3, userInfo: [NSLocalizedDescriptionKey: "Failed to create buffer"])
    }
    
    buffer.frameLength = AVAudioFrameCount(frameCount)
    
    // Convert Int16 PCM to Float32 and copy to buffer
    audioData.withUnsafeBytes { (rawBufferPointer: UnsafeRawBufferPointer) in
      guard let baseAddress = rawBufferPointer.baseAddress else { return }
      let int16Pointer = baseAddress.assumingMemoryBound(to: Int16.self)
      
      guard let floatChannelData = buffer.floatChannelData else { return }
      
      let channelCount = inputChannels
      
      if channelCount == 1 {
        // Mono: Convert Int16 to Float32 directly
        for frame in 0..<frameCount {
          // Convert Int16 (-32768 to 32767) to Float32 (-1.0 to 1.0)
          floatChannelData[0][frame] = Float(int16Pointer[frame]) / 32768.0
        }
      } else {
        // Stereo: De-interleave and convert
        for frame in 0..<frameCount {
          for channel in 0..<channelCount {
            let sampleIndex = frame * channelCount + channel
            floatChannelData[channel][frame] = Float(int16Pointer[sampleIndex]) / 32768.0
          }
        }
      }
    }
    
    // Add to queue and schedule
    queueLock.lock()
    audioQueue.append(buffer)
    let queueSize = audioQueue.count
    queueLock.unlock()
    
    print("[ExpoPcmAudioPlayer] 📥 Queued buffer (queue size: \(queueSize))")
    
    scheduleNextBuffer()
    
    // Auto-start if not playing
    if !isPlaying {
      print("[ExpoPcmAudioPlayer] 🚀 Auto-starting playback")
      try startPlayback()
    }
  }
  
  private func scheduleNextBuffer() {
    guard let node = playerNode else { return }
    
    queueLock.lock()
    defer { queueLock.unlock() }
    
    var scheduledCount = 0
    while !audioQueue.isEmpty {
      let buffer = audioQueue.removeFirst()
      node.scheduleBuffer(buffer) { [weak self] in
        self?.scheduleNextBuffer()
      }
      scheduledCount += 1
    }
    
    if scheduledCount > 0 {
      print("[ExpoPcmAudioPlayer] 🎼 Scheduled \(scheduledCount) buffer(s)")
    }
  }
  
  // MARK: - Playback Control
  
  private func startPlayback() throws {
    guard let node = playerNode else {
      throw NSError(domain: "ExpoPcmAudioPlayer", code: -4, userInfo: [NSLocalizedDescriptionKey: "Player node not initialized"])
    }
    
    if !isPlaying {
      node.play()
      isPlaying = true
      print("[ExpoPcmAudioPlayer] ▶️ Playback started")
    }
  }
  
  private func pausePlayback() {
    guard let node = playerNode else { return }
    
    if isPlaying {
      node.pause()
      isPlaying = false
      print("[ExpoPcmAudioPlayer] ⏸️ Playback paused")
    }
  }
  
  private func stopPlayback() {
    guard let node = playerNode else { return }
    
    node.stop()
    isPlaying = false
    
    queueLock.lock()
    audioQueue.removeAll()
    queueLock.unlock()
    
    print("[ExpoPcmAudioPlayer] 🛑 Playback stopped")
  }
  
  private func setVolume(volume: Float) {
    let clampedVolume = min(max(volume / 100.0, 0.0), 1.0)
    currentVolume = clampedVolume
    
    if let node = playerNode {
      node.volume = clampedVolume
      print("[ExpoPcmAudioPlayer] 🔊 Volume set to \(Int(clampedVolume * 100))%")
    }
  }
  
  // MARK: - Cleanup
  
  private func cleanup() {
    stopPlayback()
    
    if let engine = audioEngine, engine.isRunning {
      engine.stop()
    }
    
    if let node = playerNode, let engine = audioEngine {
      engine.detach(node)
    }
    
    audioEngine = nil
    playerNode = nil
    audioFormat = nil
    isInitialized = false
    print("[ExpoPcmAudioPlayer] 🧹 Cleaned up")
  }
}
