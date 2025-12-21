import ExpoModulesCore
import AVFoundation

public class ExpoPcmAudioPlayerModule: Module {
    // Audio engine components
    private var audioEngine: AVAudioEngine?
    private var playerNode: AVAudioPlayerNode?
    private var mixer: AVAudioMixerNode?
    
    // Audio format configuration
    private var sampleRate: Double = 16000
    private var channels: AVAudioChannelCount = 1
    private var bitDepth: UInt32 = 16
    private var audioFormat: AVAudioFormat?
    
    // Queue management
    private var audioQueue: [AVAudioPCMBuffer] = []
    private var isPlaying = false
    private var isPaused = false
    private var isInitialized = false
    private let queueLock = NSLock()
    
    // Current volume (0.0 to 1.0)
    private var currentVolume: Float = 1.0
    
    // Buffered count tracking
    private var bufferedCount: Int = 0
    
    public func definition() -> ModuleDefinition {
        Name("ExpoPcmAudioPlayer")
        
        // Initialize audio engine
        OnCreate {
            // Will be initialized via initialize() call
        }
        
        // Clean up on destroy
        OnDestroy {
            cleanup()
        }
        
        // Initialize with configuration
        AsyncFunction("initialize") { (config: [String: Any]) in
            try await initializeWithConfig(config: config)
        }
        
        // Stream a PCM audio chunk
        AsyncFunction("streamChunk") { (base64Data: String) in
            try await streamAudioChunk(base64Data: base64Data)
        }
        
        // Start playback
        AsyncFunction("start") {
            try await startPlayback()
        }
        
        // Pause playback
        AsyncFunction("pause") {
            try await pausePlayback()
        }
        
        // Stop playback and clear queue
        AsyncFunction("stop") {
            try await stopPlayback()
        }
        
        // Flush remaining buffer
        AsyncFunction("flush") {
            // Flush is a no-op for native implementation, chunks are played immediately
            return
        }
        
        // Set volume (0-100)
        AsyncFunction("setVolume") { (volume: Int) in
            try await setVolume(volume: volume)
        }
        
        // Get status
        AsyncFunction("getStatus") {
            return [
                "isPlaying": isPlaying && !isPaused,
                "buffered": bufferedCount
            ]
        }
    }
    
    // MARK: - Initialization
    
    private func initializeWithConfig(config: [String: Any]) async throws {
        guard let sampleRateValue = config["sampleRate"] as? Double,
              let channelsValue = config["channels"] as? Int,
              let bitDepthValue = config["bitDepth"] as? Int else {
            throw NSError(
                domain: "ExpoPcmAudioPlayer",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Invalid configuration parameters"]
            )
        }
        
        sampleRate = sampleRateValue
        channels = AVAudioChannelCount(channelsValue)
        bitDepth = UInt32(bitDepthValue)
        
        setupAudioEngine()
        isInitialized = true
        
        print("[ExpoPcmAudioPlayer] ✅ Initialized (sampleRate: \(sampleRate), channels: \(channels), bitDepth: \(bitDepth))")
    }
    
    // MARK: - Audio Engine Setup
    
    private func setupAudioEngine() {
        // Clean up existing engine if any
        cleanup()
        
        // Initialize audio components
        audioEngine = AVAudioEngine()
        playerNode = AVAudioPlayerNode()
        
        guard let engine = audioEngine,
              let node = playerNode else {
            print("[ExpoPcmAudioPlayer] Failed to create audio components")
            return
        }
        
        mixer = engine.mainMixerNode
        
        // Attach player node to engine
        engine.attach(node)
        
        // Define audio format: 16-bit PCM, specified sample rate, mono/stereo
        let format = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: sampleRate,
            channels: channels,
            interleaved: false
        )
        
        guard let format = format else {
            print("[ExpoPcmAudioPlayer] Failed to create audio format")
            return
        }
        
        audioFormat = format
        
        // Connect player node to mixer
        engine.connect(node, to: mixer!, format: format)
        
        // Configure audio session
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try audioSession.setActive(true)
        } catch {
            print("[ExpoPcmAudioPlayer] Audio session setup failed: \(error)")
        }
        
        // Start audio engine
        do {
            try engine.start()
            print("[ExpoPcmAudioPlayer] ✅ Audio engine started")
        } catch {
            print("[ExpoPcmAudioPlayer] Failed to start audio engine: \(error)")
        }
        
        // Set initial volume
        node.volume = currentVolume
    }
    
    // MARK: - Audio Streaming
    
    private func streamAudioChunk(base64Data: String) async throws {
        guard isInitialized, let format = audioFormat else {
            throw NSError(
                domain: "ExpoPcmAudioPlayer",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Audio player not initialized"]
            )
        }
        
        // Decode base64 to Data
        guard let audioData = Data(base64Encoded: base64Data) else {
            throw NSError(
                domain: "ExpoPcmAudioPlayer",
                code: 3,
                userInfo: [NSLocalizedDescriptionKey: "Invalid base64 data"]
            )
        }
        
        // Convert Data to PCM buffer
        guard let pcmBuffer = createPCMBuffer(from: audioData, format: format) else {
            throw NSError(
                domain: "ExpoPcmAudioPlayer",
                code: 4,
                userInfo: [NSLocalizedDescriptionKey: "Failed to create PCM buffer"]
            )
        }
        
        // Add to queue
        queueLock.lock()
        audioQueue.append(pcmBuffer)
        bufferedCount = audioQueue.count
        queueLock.unlock()
        
        // Start playback if not already playing and not paused
        if !isPlaying && !isPaused {
            try await startPlayback()
        } else if isPlaying {
            // Schedule buffer if already playing
            scheduleNextBuffer()
        }
    }
    
    private func createPCMBuffer(from data: Data, format: AVAudioFormat) -> AVAudioPCMBuffer? {
        // Calculate frame count: data size / (bytes per sample * channels)
        let bytesPerSample = Int(bitDepth / 8)
        let frameCount = UInt32(data.count) / UInt32(bytesPerSample) / channels
        
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
            return nil
        }
        
        buffer.frameLength = frameCount
        
        // Copy audio data to buffer
        if let audioBuffer = buffer.int16ChannelData?[0] {
            data.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
                guard let baseAddress = bytes.baseAddress else { return }
                let int16Pointer = baseAddress.assumingMemoryBound(to: Int16.self)
                memcpy(audioBuffer, int16Pointer, Int(frameCount) * MemoryLayout<Int16>.size)
            }
        }
        
        return buffer
    }
    
    private func scheduleNextBuffer() {
        queueLock.lock()
        guard !audioQueue.isEmpty, let node = playerNode else {
            queueLock.unlock()
            return
        }
        
        let buffer = audioQueue.removeFirst()
        bufferedCount = audioQueue.count
        queueLock.unlock()
        
        // Schedule buffer for playback
        node.scheduleBuffer(buffer) { [weak self] in
            // When buffer completes, schedule next
            DispatchQueue.main.async {
                self?.scheduleNextBuffer()
            }
        }
    }
    
    // MARK: - Playback Control
    
    private func startPlayback() async throws {
        guard let node = playerNode, isInitialized else {
            throw NSError(
                domain: "ExpoPcmAudioPlayer",
                code: 5,
                userInfo: [NSLocalizedDescriptionKey: "Audio player not initialized"]
            )
        }
        
        guard !isPlaying else { return }
        
        isPlaying = true
        isPaused = false
        
        // Start player node
        if !node.isPlaying {
            node.play()
        }
        
        // Schedule initial buffers (pre-buffer for smooth playback)
        scheduleNextBuffer()
        scheduleNextBuffer()
        
        print("[ExpoPcmAudioPlayer] ▶️ Playback started")
    }
    
    private func pausePlayback() async throws {
        guard let node = playerNode else { return }
        
        guard isPlaying else { return }
        
        isPaused = true
        node.pause()
        
        print("[ExpoPcmAudioPlayer] ⏸️ Playback paused")
    }
    
    private func stopPlayback() async throws {
        guard let node = playerNode else { return }
        
        isPlaying = false
        isPaused = false
        
        node.stop()
        
        // Clear queue
        queueLock.lock()
        audioQueue.removeAll()
        bufferedCount = 0
        queueLock.unlock()
        
        print("[ExpoPcmAudioPlayer] 🛑 Playback stopped")
    }
    
    private func setVolume(volume: Int) async throws {
        let normalizedVolume = Float(min(max(volume, 0), 100)) / 100.0
        currentVolume = normalizedVolume
        playerNode?.volume = normalizedVolume
        
        print("[ExpoPcmAudioPlayer] 🔊 Volume set to \(volume)%")
    }
    
    // MARK: - Cleanup
    
    private func cleanup() {
        audioEngine?.stop()
        playerNode?.stop()
        
        queueLock.lock()
        audioQueue.removeAll()
        bufferedCount = 0
        queueLock.unlock()
        
        isPlaying = false
        isPaused = false
        isInitialized = false
    }
}
