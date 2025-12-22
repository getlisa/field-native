package expo.modules.liveaudio

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import androidx.core.os.bundleOf
import kotlinx.coroutines.*
import kotlin.coroutines.coroutineContext
import java.nio.ByteBuffer
import java.nio.ByteOrder

class ExpoLiveAudioModule : Module() {
  // Audio configuration
  private var sampleRate = 16000
  private var channelConfig = AudioFormat.CHANNEL_IN_MONO
  private val audioFormat = AudioFormat.ENCODING_PCM_16BIT
  private var bufferSize = 4096
  
  // Audio source (Android specific)
  private var audioSource = MediaRecorder.AudioSource.VOICE_RECOGNITION
  
  // Recording state
  private var audioRecord: AudioRecord? = null
  private var isRecording = false
  private var isInitialized = false
  private var recordingJob: Job? = null
  
  // Scope for coroutines
  private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
  
  override fun definition() = ModuleDefinition {
    Name("ExpoLiveAudio")
    
    Events("onAudioChunk", "onStarted", "onStopped", "onError")
    
    OnDestroy {
      cleanup()
    }
    
    // Initialize audio recorder
    Function("init") { config: Map<String, Any> ->
      sampleRate = (config["sampleRate"] as? Number)?.toInt() ?: 16000
      val channelsValue = (config["channels"] as? Number)?.toInt() ?: 1
      channelConfig = if (channelsValue == 1) AudioFormat.CHANNEL_IN_MONO else AudioFormat.CHANNEL_IN_STEREO
      bufferSize = (config["bufferSize"] as? Number)?.toInt() ?: 4096
      
      // Android specific: audio source
      audioSource = (config["audioSource"] as? Number)?.toInt() ?: MediaRecorder.AudioSource.VOICE_RECOGNITION
      
      isInitialized = true
      Log.i("ExpoLiveAudio", "✅ Initialized (sampleRate: $sampleRate, channels: $channelsValue, bufferSize: $bufferSize)")
    }
    
    // Start recording
    AsyncFunction("start") { promise: Promise ->
      try {
        startRecording()
        promise.resolve(null)
      } catch (e: Exception) {
        Log.e("ExpoLiveAudio", "Failed to start: ${e.message}", e)
        promise.reject("START_ERROR", "Failed to start recording: ${e.message}", e)
      }
    }
    
    // Stop recording
    Function("stop") {
      stopRecording()
    }
    
    // Configure audio session (Android - no-op, kept for API compatibility)
    AsyncFunction("configureAudioSession") { config: Map<String, Any>, promise: Promise ->
      // Android doesn't use audio session like iOS
      // This is kept for API compatibility
      Log.d("ExpoLiveAudio", "configureAudioSession called (Android - no-op)")
      promise.resolve(null)
    }
  }
  
  // MARK: - Recording Control
  
  private fun startRecording() {
    if (isRecording) {
      Log.w("ExpoLiveAudio", "Already recording")
      return
    }
    
    if (!isInitialized) {
      throw IllegalStateException("Not initialized. Call init() first.")
    }
    
    // Get minimum buffer size
    val minBufferSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
    if (minBufferSize == AudioRecord.ERROR || minBufferSize == AudioRecord.ERROR_BAD_VALUE) {
      throw IllegalStateException("Invalid audio parameters for AudioRecord")
    }
    
    // Use provided buffer size or minimum, whichever is larger
    val recordBufferSize = maxOf(bufferSize * 2, minBufferSize)
    
    try {
      // Create AudioRecord
      audioRecord = AudioRecord(
        audioSource,
        sampleRate,
        channelConfig,
        audioFormat,
        recordBufferSize
      )
      
      val record = audioRecord ?: throw IllegalStateException("Failed to create AudioRecord")
      
      // Check state
      if (record.state != AudioRecord.STATE_INITIALIZED) {
        record.release()
        throw IllegalStateException("AudioRecord initialization failed")
      }
      
      // Start recording
      record.startRecording()
      isRecording = true
      
      // Emit started event
      sendEvent("onStarted", bundleOf())
      
      // Start reading audio data in a coroutine
      recordingJob = scope.launch {
        try {
          readAudioData(record, recordBufferSize)
        } catch (e: Exception) {
          Log.e("ExpoLiveAudio", "Error reading audio data: ${e.message}", e)
          sendEvent("onError", bundleOf("error" to (e.message ?: "Unknown error")))
          stopRecording()
        }
      }
      
      Log.i("ExpoLiveAudio", "▶️ Recording started")
    } catch (e: Exception) {
      audioRecord?.release()
      audioRecord = null
      throw e
    }
  }
  
  private fun stopRecording() {
    if (!isRecording) {
      Log.w("ExpoLiveAudio", "Not recording")
      return
    }
    
    // Cancel recording job
    recordingJob?.cancel()
    recordingJob = null
    
    // Stop and release AudioRecord
    try {
      audioRecord?.stop()
      audioRecord?.release()
    } catch (e: Exception) {
      Log.e("ExpoLiveAudio", "Error stopping AudioRecord: ${e.message}", e)
    }
    
    audioRecord = null
    isRecording = false
    
    // Emit stopped event
    sendEvent("onStopped", bundleOf())
    
    Log.i("ExpoLiveAudio", "🛑 Recording stopped")
  }
  
  // MARK: - Audio Processing
  
  private suspend fun readAudioData(record: AudioRecord, bufferSize: Int) {
    val buffer = ByteArray(bufferSize)
    
    // Use coroutineContext to check if coroutine is still active
    while (isRecording && coroutineContext.isActive) {
      try {
        // Read audio data
        val bytesRead = record.read(buffer, 0, buffer.size)
        
        if (bytesRead < 0) {
          when (bytesRead) {
            AudioRecord.ERROR_INVALID_OPERATION -> {
              Log.e("ExpoLiveAudio", "ERROR_INVALID_OPERATION")
              break
            }
            AudioRecord.ERROR_BAD_VALUE -> {
              Log.e("ExpoLiveAudio", "ERROR_BAD_VALUE")
              break
            }
          }
          continue
        }
        
        if (bytesRead == 0) {
          delay(10) // Small delay if no data
          continue
        }
        
        // Convert to base64
        val audioData = buffer.copyOf(bytesRead)
        val base64String = Base64.encodeToString(audioData, Base64.NO_WRAP)
        
        // Emit event
        sendEvent("onAudioChunk", bundleOf("data" to base64String))
        
      } catch (e: CancellationException) {
        Log.i("ExpoLiveAudio", "Recording cancelled")
        break
      } catch (e: Exception) {
        Log.e("ExpoLiveAudio", "Error reading audio: ${e.message}", e)
        throw e
      }
    }
  }
  
  // MARK: - Cleanup
  
  private fun cleanup() {
    stopRecording()
    isInitialized = false
    Log.i("ExpoLiveAudio", "🧹 Cleaned up")
  }
}
