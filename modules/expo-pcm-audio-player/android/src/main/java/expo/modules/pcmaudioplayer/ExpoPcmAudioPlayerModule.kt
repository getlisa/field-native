package expo.modules.pcmaudioplayer

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import kotlinx.coroutines.*
import java.util.concurrent.ConcurrentLinkedQueue
import android.util.Base64
import java.nio.ByteBuffer
import java.nio.ByteOrder

class ExpoPcmAudioPlayerModule : Module() {
    // Audio configuration
    private var sampleRate = 16000
    private var channelConfig = AudioFormat.CHANNEL_OUT_MONO
    private val audioFormat = AudioFormat.ENCODING_PCM_16BIT
    
    // AudioTrack instance
    private var audioTrack: AudioTrack? = null
    
    // Queue for audio chunks
    private val audioQueue = ConcurrentLinkedQueue<ByteArray>()
    
    // Playback state
    private var isPlaying = false
    private var isPaused = false
    private var isInitialized = false
    private var playbackJob: Job? = null
    
    // Volume (0.0 to 1.0)
    private var currentVolume = 1.0f
    
    // Scope for coroutines
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    
    override fun definition() = ModuleDefinition {
        Name("ExpoPcmAudioPlayer")
        
        OnCreate {
            // Will be initialized via initialize() call
        }
        
        OnDestroy {
            cleanup()
        }
        
        AsyncFunction("initialize") { config: Map<String, Any>, promise: Promise ->
            initializeAudioTrack(config, promise)
        }
        
        AsyncFunction("streamChunk") { base64Data: String, promise: Promise ->
            streamAudioChunk(base64Data, promise)
        }
        
        AsyncFunction("start") { promise: Promise ->
            startPlayback(promise)
        }
        
        AsyncFunction("pause") { promise: Promise ->
            pausePlayback(promise)
        }
        
        AsyncFunction("stop") { promise: Promise ->
            stopPlayback(promise)
        }
        
        AsyncFunction("flush") {
            // Flush is a no-op for native implementation, chunks are played immediately
            return@AsyncFunction null
        }
        
        AsyncFunction("setVolume") { volume: Int, promise: Promise ->
            setVolume(volume, promise)
        }
        
        AsyncFunction("getStatus") {
            return@AsyncFunction mapOf(
                "isPlaying" to (isPlaying && !isPaused),
                "buffered" to audioQueue.size
            )
        }
    }
    
    // MARK: - AudioTrack Setup
    
    private fun initializeAudioTrack(config: Map<String, Any>, promise: Promise) {
        try {
            val sampleRateValue = (config["sampleRate"] as? Number)?.toInt() ?: 16000
            val channelsValue = (config["channels"] as? Number)?.toInt() ?: 1
            val bitDepthValue = (config["bitDepth"] as? Number)?.toInt() ?: 16
            
            sampleRate = sampleRateValue
            
            // Set channel configuration based on number of channels
            channelConfig = when (channelsValue) {
                1 -> AudioFormat.CHANNEL_OUT_MONO
                2 -> AudioFormat.CHANNEL_OUT_STEREO
                else -> AudioFormat.CHANNEL_OUT_MONO
            }
            
            // Release existing AudioTrack if any
            audioTrack?.release()
            
            val bufferSize = AudioTrack.getMinBufferSize(
                sampleRate,
                channelConfig,
                audioFormat
            ) * 3 // Triple buffer for smoother playback
            
            audioTrack = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setSampleRate(sampleRate)
                        .setChannelMask(channelConfig)
                        .setEncoding(audioFormat)
                        .build()
                )
                .setBufferSizeInBytes(bufferSize)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
            
            audioTrack?.setVolume(currentVolume)
            isInitialized = true
            
            println("[ExpoPcmAudioPlayer] ✅ AudioTrack initialized (sampleRate: $sampleRate, channels: $channelsValue, bitDepth: $bitDepthValue)")
            promise.resolve(null)
        } catch (e: Exception) {
            println("[ExpoPcmAudioPlayer] Failed to initialize: ${e.message}")
            promise.reject("INIT_ERROR", "Failed to initialize audio track: ${e.message}", e)
        }
    }
    
    // MARK: - Audio Streaming
    
    private fun streamAudioChunk(base64Data: String, promise: Promise) {
        if (!isInitialized) {
            promise.reject("NOT_INITIALIZED", "Audio player not initialized", null)
            return
        }
        
        try {
            // Decode base64 to byte array
            val audioData = Base64.decode(base64Data, Base64.DEFAULT)
            
            // Add to queue
            audioQueue.offer(audioData)
            
            // Start playback if not already playing and not paused
            if (!isPlaying && !isPaused) {
                startPlaybackInternal()
            }
            
            promise.resolve(null)
        } catch (e: Exception) {
            println("[ExpoPcmAudioPlayer] Error streaming chunk: ${e.message}")
            promise.reject("STREAM_ERROR", "Failed to stream audio chunk: ${e.message}", e)
        }
    }
    
    // MARK: - Playback Control
    
    private fun startPlayback(promise: Promise) {
        try {
            startPlaybackInternal()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("PLAY_ERROR", "Failed to start playback: ${e.message}", e)
        }
    }
    
    private fun startPlaybackInternal() {
        if (!isInitialized || audioTrack == null) {
            throw IllegalStateException("Audio player not initialized")
        }
        
        if (isPlaying) {
            return
        }
        
        isPlaying = true
        isPaused = false
        
        // Start AudioTrack
        try {
            audioTrack?.play()
        } catch (e: Exception) {
            isPlaying = false
            throw e
        }
        
        // Start playback coroutine
        playbackJob?.cancel()
        playbackJob = scope.launch {
            playbackLoop()
        }
        
        println("[ExpoPcmAudioPlayer] ▶️ Playback started")
    }
    
    private suspend fun playbackLoop() {
        val track = audioTrack ?: return
        
        while (isPlaying && !isPaused) {
            try {
                // Check if track is still valid
                if (track.state != AudioTrack.STATE_INITIALIZED) {
                    println("[ExpoPcmAudioPlayer] AudioTrack not initialized, stopping playback")
                    break
                }
                
                val audioData = audioQueue.poll()
                
                if (audioData != null) {
                    // Write audio data to AudioTrack
                    var bytesWritten = 0
                    while (bytesWritten < audioData.size && isPlaying && !isPaused) {
                        val written = track.write(
                            audioData,
                            bytesWritten,
                            audioData.size - bytesWritten,
                            AudioTrack.WRITE_BLOCKING
                        )
                        if (written < 0) {
                            // Error writing
                            println("[ExpoPcmAudioPlayer] Error writing to AudioTrack: $written")
                            break
                        }
                        bytesWritten += written
                    }
                } else {
                    // No data available, wait briefly
                    delay(10)
                }
            } catch (e: Exception) {
                println("[ExpoPcmAudioPlayer] Error in playback loop: ${e.message}")
                delay(10) // Continue after error
            }
        }
        
        // Mark as not playing when loop exits
        isPlaying = false
    }
    
    private fun pausePlayback(promise: Promise) {
        if (!isPlaying) {
            promise.resolve(null)
            return
        }
        
        isPaused = true
        try {
            audioTrack?.pause()
            println("[ExpoPcmAudioPlayer] ⏸️ Playback paused")
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("PAUSE_ERROR", "Failed to pause playback: ${e.message}", e)
        }
    }
    
    private fun stopPlayback(promise: Promise) {
        try {
            stopPlaybackInternal()
            println("[ExpoPcmAudioPlayer] 🛑 Playback stopped")
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("STOP_ERROR", "Failed to stop playback: ${e.message}", e)
        }
    }
    
    private fun setVolume(volume: Int, promise: Promise) {
        val normalizedVolume = volume.coerceIn(0, 100) / 100.0f
        currentVolume = normalizedVolume
        
        try {
            val result = audioTrack?.setVolume(normalizedVolume)
            if (result == AudioTrack.SUCCESS) {
                println("[ExpoPcmAudioPlayer] 🔊 Volume set to $volume%")
                promise.resolve(null)
            } else {
                promise.reject("VOLUME_ERROR", "Failed to set volume", null)
            }
        } catch (e: Exception) {
            promise.reject("VOLUME_ERROR", "Failed to set volume: ${e.message}", e)
        }
    }
    
    // MARK: - Cleanup
    
    private fun cleanup() {
        try {
            stopPlaybackInternal()
            scope.cancel()
            audioTrack?.release()
            audioTrack = null
            audioQueue.clear()
            isInitialized = false
        } catch (e: Exception) {
            println("[ExpoPcmAudioPlayer] Error during cleanup: ${e.message}")
        }
    }
    
    private fun stopPlaybackInternal() {
        isPlaying = false
        isPaused = false
        
        // Cancel playback coroutine
        playbackJob?.cancel()
        playbackJob = null
        
        // Stop and flush AudioTrack
        try {
            audioTrack?.pause()
            audioTrack?.flush()
        } catch (e: Exception) {
            println("[ExpoPcmAudioPlayer] Error stopping AudioTrack: ${e.message}")
        }
        
        // Clear queue
        audioQueue.clear()
    }
}
