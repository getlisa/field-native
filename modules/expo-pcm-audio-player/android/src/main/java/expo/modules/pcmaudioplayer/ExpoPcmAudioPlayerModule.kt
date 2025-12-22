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
    
    // Initialize audio player with configuration
    AsyncFunction("initialize") { config: Map<String, Any>, promise: Promise ->
      try {
        val sampleRateValue = (config["sampleRate"] as? Double)?.toInt() ?: 16000
        val channelsValue = (config["channels"] as? Double)?.toInt() ?: 1
        val bitDepthValue = (config["bitDepth"] as? Double)?.toInt() ?: 16
        
        initializeAudioTrack(sampleRateValue, channelsValue, bitDepthValue)
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("INIT_ERROR", "Failed to initialize: ${e.message}", e)
      }
    }
    
    // Stream audio chunk
    AsyncFunction("streamChunk") { base64Data: String, promise: Promise ->
      streamAudioChunk(base64Data, promise)
    }
    
    // Start/resume playback
    AsyncFunction("start") { promise: Promise ->
      startPlayback(promise)
    }
    
    // Pause playback
    AsyncFunction("pause") { promise: Promise ->
      try {
        pausePlayback()
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("PAUSE_ERROR", "Failed to pause: ${e.message}", e)
      }
    }
    
    // Stop playback
    AsyncFunction("stop") { promise: Promise ->
      try {
        stopPlayback()
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("STOP_ERROR", "Failed to stop: ${e.message}", e)
      }
    }
    
    // Flush buffer (no-op, kept for API compatibility)
    AsyncFunction("flush") { promise: Promise ->
      promise.resolve(null)
    }
    
    // Set volume
    AsyncFunction("setVolume") { volume: Double, promise: Promise ->
      try {
        setVolume(volume.toFloat())
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("VOLUME_ERROR", "Failed to set volume: ${e.message}", e)
      }
    }
    
    // Get status
    AsyncFunction("getStatus") { promise: Promise ->
      try {
        val status = mapOf(
          "isPlaying" to isPlaying,
          "buffered" to audioQueue.size
        )
        promise.resolve(status)
      } catch (e: Exception) {
        promise.reject("STATUS_ERROR", "Failed to get status: ${e.message}", e)
      }
    }
  }
  
  // MARK: - Audio Track Initialization
  
  private fun initializeAudioTrack(sampleRate: Int, channels: Int, bitDepth: Int) {
    try {
      this.sampleRate = sampleRate
      this.channelConfig = if (channels == 2) AudioFormat.CHANNEL_OUT_STEREO else AudioFormat.CHANNEL_OUT_MONO
      
      val minBufferSize = AudioTrack.getMinBufferSize(
        sampleRate,
        channelConfig,
        audioFormat
      )
      
      audioTrack = AudioTrack(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
          .build(),
        AudioFormat.Builder()
          .setSampleRate(sampleRate)
          .setChannelMask(channelConfig)
          .setEncoding(audioFormat)
          .build(),
        minBufferSize * 2,
        AudioTrack.MODE_STREAM,
        android.media.AudioManager.AUDIO_SESSION_ID_GENERATE
      )
      
      audioTrack?.setVolume(currentVolume)
      isInitialized = true
      
      println("[ExpoPcmAudioPlayer] ✅ AudioTrack initialized (sampleRate: $sampleRate, channels: $channels, bitDepth: $bitDepth)")
    } catch (e: Exception) {
      println("[ExpoPcmAudioPlayer] Failed to initialize: ${e.message}")
      throw e
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
    if (isPlaying) return
    
    val track = audioTrack
    if (track == null) {
      println("[ExpoPcmAudioPlayer] AudioTrack not initialized")
      return
    }
    
    isPlaying = true
    isPaused = false
    track.play()
    println("[ExpoPcmAudioPlayer] ▶️ Playback started")
    
    // Start playback loop
    playbackJob = scope.launch {
      while (isPlaying && !isPaused) {
        val data = audioQueue.poll()
        if (data != null) {
          try {
            val track = audioTrack
            if (track == null) {
              println("[ExpoPcmAudioPlayer] AudioTrack not initialized, stopping playback")
              break
            }
            
            val written = track.write(data, 0, data.size)
            if (written < 0) {
              println("[ExpoPcmAudioPlayer] Error writing to AudioTrack: $written")
            }
          } catch (e: Exception) {
            println("[ExpoPcmAudioPlayer] Error in playback loop: ${e.message}")
            break
          }
        } else {
          // No data available, sleep briefly
          delay(10)
        }
      }
    }
  }
  
  private fun pausePlayback() {
    if (!isPlaying) return
    
    isPaused = true
    audioTrack?.pause()
    playbackJob?.cancel()
    playbackJob = null
    
    println("[ExpoPcmAudioPlayer] ⏸️ Playback paused")
  }
  
  private fun stopPlayback() {
    isPlaying = false
    isPaused = false
    
    audioTrack?.pause()
    audioTrack?.flush()
    audioQueue.clear()
    playbackJob?.cancel()
    playbackJob = null
    
    println("[ExpoPcmAudioPlayer] 🛑 Playback stopped")
  }
  
  private fun setVolume(volume: Float) {
    val clampedVolume = volume.coerceIn(0f, 100f) / 100f
    currentVolume = clampedVolume
    
    if (isInitialized) {
      audioTrack?.setVolume(clampedVolume)
      println("[ExpoPcmAudioPlayer] 🔊 Volume set to ${(clampedVolume * 100).toInt()}%")
    }
  }
  
  // MARK: - Cleanup
  
  private fun cleanup() {
    try {
      stopPlaybackInternal()
      audioTrack?.release()
      audioTrack = null
      isInitialized = false
      scope.cancel()
    } catch (e: Exception) {
      println("[ExpoPcmAudioPlayer] Error during cleanup: ${e.message}")
    }
  }
  
  private fun stopPlaybackInternal() {
    isPlaying = false
    isPaused = false
    
    try {
      audioTrack?.pause()
      audioTrack?.flush()
    } catch (e: Exception) {
      println("[ExpoPcmAudioPlayer] Error stopping AudioTrack: ${e.message}")
    }
    
    audioQueue.clear()
    playbackJob?.cancel()
    playbackJob = null
  }
}
