package expo.modules.liveaudio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.os.Build
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
  
  // Audio source (Android specific) - CHANGED DEFAULT for better distant voice pickup
  private var audioSource = MediaRecorder.AudioSource.VOICE_COMMUNICATION
  
  // Audio effects for better voice capture
  private var automaticGainControl: AutomaticGainControl? = null
  private var noiseSuppressor: NoiseSuppressor? = null
  
  // Recording state
  private var audioRecord: AudioRecord? = null
  private var isRecording = false
  private var isInitialized = false
  private var recordingJob: Job? = null
  
  // Configuration flags
  private var enableAGC = true
  private var enableNoiseSuppression = true
  
  // Audio focus management
  private var audioManager: AudioManager? = null
  private var audioFocusRequest: AudioFocusRequest? = null
  private var hasAudioFocus = false
  private var isPausedByFocusLoss = false
  
  // Scope for coroutines
  private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
  
  override fun definition() = ModuleDefinition {
    Name("ExpoLiveAudio")
    
    Events("onAudioChunk", "onStarted", "onStopped", "onError", "onInterruptionBegan", "onInterruptionEnded")
    
    OnDestroy {
      cleanup()
    }
    
    // Initialize audio recorder
    Function("init") { config: Map<String, Any> ->
      sampleRate = (config["sampleRate"] as? Number)?.toInt() ?: 16000
      val channelsValue = (config["channels"] as? Number)?.toInt() ?: 1
      channelConfig = if (channelsValue == 1) AudioFormat.CHANNEL_IN_MONO else AudioFormat.CHANNEL_IN_STEREO
      bufferSize = (config["bufferSize"] as? Number)?.toInt() ?: 4096
      
      // Android specific: audio source (UPDATED MAPPING for better voice input)
      val audioSourceString = config["audioSource"] as? String
      audioSource = when (audioSourceString) {
        "VOICE_COMMUNICATION" -> MediaRecorder.AudioSource.VOICE_COMMUNICATION
        "MIC" -> MediaRecorder.AudioSource.MIC
        "CAMCORDER" -> MediaRecorder.AudioSource.CAMCORDER
        "VOICE_RECOGNITION" -> MediaRecorder.AudioSource.VOICE_RECOGNITION
        "UNPROCESSED" -> if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.N) {
          MediaRecorder.AudioSource.UNPROCESSED
        } else {
          MediaRecorder.AudioSource.VOICE_COMMUNICATION
        }
        else -> MediaRecorder.AudioSource.VOICE_COMMUNICATION // Default for WhatsApp-style voice chat
      }
      
      // Audio processing options
      enableAGC = (config["enableAGC"] as? Boolean) ?: true
      enableNoiseSuppression = (config["enableNoiseSuppression"] as? Boolean) ?: true
      
      isInitialized = true
      Log.i("ExpoLiveAudio", "✅ Initialized (sampleRate: $sampleRate, channels: $channelsValue, bufferSize: $bufferSize, audioSource: $audioSource, AGC: $enableAGC, NS: $enableNoiseSuppression)")
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
    
    // Configure audio session (Android - configure audio source)
    AsyncFunction("configureAudioSession") { config: Map<String, Any>, promise: Promise ->
      try {
        // On Android, we can update audio source preference
        val audioSourceString = config["audioSource"] as? String
        if (audioSourceString != null) {
          audioSource = when (audioSourceString) {
            "VOICE_COMMUNICATION" -> MediaRecorder.AudioSource.VOICE_COMMUNICATION
            "MIC" -> MediaRecorder.AudioSource.MIC
            "CAMCORDER" -> MediaRecorder.AudioSource.CAMCORDER
            "VOICE_RECOGNITION" -> MediaRecorder.AudioSource.VOICE_RECOGNITION
            "UNPROCESSED" -> if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.N) {
              MediaRecorder.AudioSource.UNPROCESSED
            } else {
              MediaRecorder.AudioSource.VOICE_COMMUNICATION
            }
            else -> MediaRecorder.AudioSource.VOICE_COMMUNICATION
          }
          Log.d("ExpoLiveAudio", "✅ Audio source configured: $audioSource")
        }
        
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("CONFIG_ERROR", "Failed to configure audio: ${e.message}", e)
      }
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
    
    // Request audio focus before starting recording
    if (!requestAudioFocus()) {
      Log.w("ExpoLiveAudio", "⚠️ Starting recording without audio focus")
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
      
      // Setup audio effects for better voice capture (AGC, Noise Suppression)
      setupAudioEffects(record.audioSessionId)
      
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
      
      Log.i("ExpoLiveAudio", "▶️ Recording started with audioSource: $audioSource")
    } catch (e: Exception) {
      audioRecord?.release()
      audioRecord = null
      releaseAudioEffects()
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
    
    // Release audio effects
    releaseAudioEffects()
    
    // Stop and release AudioRecord
    try {
      audioRecord?.stop()
      audioRecord?.release()
    } catch (e: Exception) {
      Log.e("ExpoLiveAudio", "Error stopping AudioRecord: ${e.message}", e)
    }
    
    audioRecord = null
    isRecording = false
    
    // Abandon audio focus
    abandonAudioFocus()
    
    // Emit stopped event
    sendEvent("onStopped", bundleOf())
    
    Log.i("ExpoLiveAudio", "🛑 Recording stopped")
  }
  
  // MARK: - Audio Effects (AGC, Noise Suppression)
  
  private fun setupAudioEffects(audioSessionId: Int) {
    try {
      // Setup Automatic Gain Control (AGC) - boosts quiet audio automatically
      if (enableAGC && AutomaticGainControl.isAvailable()) {
        automaticGainControl = AutomaticGainControl.create(audioSessionId)
        automaticGainControl?.enabled = true
        Log.i("ExpoLiveAudio", "🎚️ AGC enabled (auto-boosts audio volume)")
      } else {
        Log.w("ExpoLiveAudio", "⚠️ AGC not available or disabled")
      }
      
      // Setup Noise Suppressor - reduces background noise
      if (enableNoiseSuppression && NoiseSuppressor.isAvailable()) {
        noiseSuppressor = NoiseSuppressor.create(audioSessionId)
        noiseSuppressor?.enabled = true
        Log.i("ExpoLiveAudio", "🔇 Noise suppression enabled")
      } else {
        Log.w("ExpoLiveAudio", "⚠️ Noise suppression not available or disabled")
      }
    } catch (e: Exception) {
      Log.e("ExpoLiveAudio", "Failed to setup audio effects: ${e.message}", e)
      // Continue without effects - not critical
    }
  }
  
  private fun releaseAudioEffects() {
    try {
      automaticGainControl?.release()
      automaticGainControl = null
      
      noiseSuppressor?.release()
      noiseSuppressor = null
      
      Log.i("ExpoLiveAudio", "🔧 Audio effects released")
    } catch (e: Exception) {
      Log.e("ExpoLiveAudio", "Error releasing audio effects: ${e.message}", e)
    }
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
  
  // MARK: - Audio Focus Management
  
  private val audioFocusChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
    when (focusChange) {
      AudioManager.AUDIOFOCUS_LOSS -> {
        // Permanent audio focus loss (phone call, another app taking over permanently)
        Log.w("ExpoLiveAudio", "⚠️ Audio focus lost permanently - pausing recording")
        if (isRecording && !isPausedByFocusLoss) {
          isPausedByFocusLoss = true
          hasAudioFocus = false
          
          // Notify JS layer to pause and send silence
          sendEvent("onInterruptionBegan", bundleOf())
        }
      }
      
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
        // Temporary audio focus loss (TTS, navigation, etc.) - will be restored
        Log.w("ExpoLiveAudio", "⚠️ Audio focus lost temporarily - pausing recording")
        if (isRecording && !isPausedByFocusLoss) {
          isPausedByFocusLoss = true
          // Keep hasAudioFocus = true so we know we still "own" the focus and will get it back
          
          // Notify JS layer to pause and send silence
          sendEvent("onInterruptionBegan", bundleOf())
        }
      }
      
      AudioManager.AUDIOFOCUS_GAIN -> {
        // Regained audio focus (after transient loss)
        Log.i("ExpoLiveAudio", "✅ Audio focus gained/regained")
        if (isPausedByFocusLoss) {
          isPausedByFocusLoss = false
          hasAudioFocus = true
          
          // Notify JS layer to resume
          sendEvent("onInterruptionEnded", bundleOf("shouldResume" to true))
          Log.d("ExpoLiveAudio", "📤 Sent onInterruptionEnded event to JS layer")
        } else if (!hasAudioFocus) {
          // We got audio focus but weren't paused - just update the flag
          hasAudioFocus = true
          Log.d("ExpoLiveAudio", "ℹ️ Audio focus gained (was not paused)")
        }
      }
      
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
        // Can continue at lower volume (e.g., notification sound) - DON'T pause
        Log.d("ExpoLiveAudio", "ℹ️ Audio focus loss transient (can duck) - continuing at lower volume")
      }
    }
  }
  
  private fun requestAudioFocus(): Boolean {
    try {
      val context = appContext.reactContext ?: return false
      audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val audioAttributes = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
        
        audioFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
          .setAudioAttributes(audioAttributes)
          .setOnAudioFocusChangeListener(audioFocusChangeListener)
          .build()
        
        val result = audioManager?.requestAudioFocus(audioFocusRequest!!)
        hasAudioFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
      } else {
        @Suppress("DEPRECATION")
        val result = audioManager?.requestAudioFocus(
          audioFocusChangeListener,
          AudioManager.STREAM_VOICE_CALL,
          AudioManager.AUDIOFOCUS_GAIN
        )
        hasAudioFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
      }
      
      if (hasAudioFocus) {
        Log.i("ExpoLiveAudio", "🎧 Audio focus granted")
      } else {
        Log.w("ExpoLiveAudio", "⚠️ Audio focus request failed")
      }
      
      return hasAudioFocus
    } catch (e: Exception) {
      Log.e("ExpoLiveAudio", "Failed to request audio focus: ${e.message}", e)
      return false
    }
  }
  
  private fun abandonAudioFocus() {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        audioFocusRequest?.let { request ->
          audioManager?.abandonAudioFocusRequest(request)
        }
      } else {
        @Suppress("DEPRECATION")
        audioManager?.abandonAudioFocus(audioFocusChangeListener)
      }
      
      hasAudioFocus = false
      isPausedByFocusLoss = false
      audioFocusRequest = null
      audioManager = null
      
      Log.i("ExpoLiveAudio", "🎧 Audio focus abandoned")
    } catch (e: Exception) {
      Log.e("ExpoLiveAudio", "Error abandoning audio focus: ${e.message}", e)
    }
  }
  
  // MARK: - Cleanup
  
  private fun cleanup() {
    stopRecording()
    abandonAudioFocus()
    isInitialized = false
    Log.i("ExpoLiveAudio", "🧹 Cleaned up")
  }
}
