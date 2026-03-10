package expo.modules.wearablescamera

import android.Manifest
import android.app.Application
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.core.os.bundleOf
import androidx.exifinterface.media.ExifInterface
import com.meta.wearable.dat.camera.StreamSession
import com.meta.wearable.dat.camera.startStreamSession
import com.meta.wearable.dat.camera.types.PhotoData
import com.meta.wearable.dat.camera.types.StreamConfiguration
import com.meta.wearable.dat.camera.types.StreamSessionState
import com.meta.wearable.dat.camera.types.VideoQuality
import com.meta.wearable.dat.core.Wearables
import com.meta.wearable.dat.core.selectors.AutoDeviceSelector
import com.meta.wearable.dat.core.selectors.DeviceSelector
import com.meta.wearable.dat.core.types.Permission
import com.meta.wearable.dat.core.types.PermissionStatus
import com.meta.wearable.dat.core.types.RegistrationState
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.interfaces.permissions.PermissionsResponseListener
import expo.modules.interfaces.permissions.PermissionsStatus
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import kotlin.coroutines.resume
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.suspendCancellableCoroutine

class ExpoWearablesCameraModule : Module() {
  companion object {
    private const val TAG = "ExpoWearablesCamera"
    private const val DEVICE_TIMEOUT_MS = 8000L
  }

  private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
  private var isInitialized = false
  private val permissionMutex = Mutex()
  private var permissionContinuation: CancellableContinuation<PermissionStatus>? = null
  private var permissionLauncher: ActivityResultLauncher<Permission>? = null
  private var permissionLauncherActivity: ComponentActivity? = null
  private var monitoringStarted = false
  private var registrationJob: Job? = null
  private var activeDeviceJob: Job? = null
  private val monitoringDeviceSelector: DeviceSelector = AutoDeviceSelector()
  private var lastRegistrationState: RegistrationState = RegistrationState.Unavailable()
  private var hasActiveDevice = false
  private var lastError: String? = null

  private val androidPermissions = arrayOf(
    Manifest.permission.BLUETOOTH,
    Manifest.permission.BLUETOOTH_CONNECT,
    Manifest.permission.INTERNET
  )


  override fun definition() = ModuleDefinition {
    Name("ExpoWearablesCamera")
    Events("onWearablesStatus")

    OnDestroy {
      registrationJob?.cancel()
      activeDeviceJob?.cancel()
      permissionLauncher?.unregister()
      permissionLauncher = null
      permissionLauncherActivity = null
      monitoringStarted = false
    }

    AsyncFunction("initialize") { promise: Promise ->
      try {
        val context = appContext.reactContext ?: throw IllegalStateException("Missing context")
        if (!isInitialized) {
          Wearables.initialize(context)
          isInitialized = true
        }
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("INIT_ERROR", "Failed to initialize Wearables SDK: ${e.message}", e)
      }
    }

    AsyncFunction("requestAndroidPermissions") { promise: Promise ->
      try {
        val permissionsManager = appContext.permissions
          ?: throw IllegalStateException("Permissions module is not available")
        permissionsManager.askForPermissions(
          PermissionsResponseListener { permissionsMap ->
            val allGranted = permissionsMap.values.all { it.status == PermissionsStatus.GRANTED }
            promise.resolve(allGranted)
          },
          *androidPermissions
        )
      } catch (e: Exception) {
        promise.reject(
          "ANDROID_PERMISSION_ERROR",
          "Failed to request Android permissions: ${e.message}",
          e
        )
      }
    }

    AsyncFunction("startMonitoring") { promise: Promise ->
      scope.launch {
        try {
          ensureInitialized()
          if (monitoringStarted) {
            promise.resolve(null)
            return@launch
          }
          monitoringStarted = true

          registrationJob =
            launch {
              try {
                Wearables.registrationState.collect { state ->
                  val oldName = lastRegistrationState::class.simpleName ?: "Unknown"
                  val newName = state::class.simpleName ?: "Unknown"
                  Log.i(TAG, "registrationState changed: $oldName -> $newName")
                  lastRegistrationState = state
                  emitStatus()
                }
              } catch (e: Exception) {
                lastError = e.message
                emitStatus()
              }
            }

          activeDeviceJob =
            launch {
              try {
                monitoringDeviceSelector.activeDevice(Wearables.devices).collect { device ->
                  hasActiveDevice = device != null
                  emitStatus()
                }
              } catch (e: Exception) {
                lastError = e.message
                emitStatus()
              }
            }

          emitStatus()
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject("MONITOR_ERROR", "Failed to start monitoring: ${e.message}", e)
        }
      }
    }

    AsyncFunction("getStatus") { promise: Promise ->
      try {
        val status = bundleOf(
          "registrationState" to (lastRegistrationState::class.simpleName ?: "Unknown"),
          "registrationStateDetail" to lastRegistrationState.toString(),
          "hasActiveDevice" to hasActiveDevice,
          "lastError" to lastError
        )
        promise.resolve(status)
      } catch (e: Exception) {
        promise.reject("STATUS_ERROR", "Failed to get status: ${e.message}", e)
      }
    }

    AsyncFunction("requestWearablesCameraPermission") { promise: Promise ->
      scope.launch {
        try {
          ensureInitialized()
          val status = ensureCameraPermission()
          val statusValue = if (status == PermissionStatus.Granted) "granted" else "denied"
          promise.resolve(statusValue)
        } catch (e: Exception) {
          promise.reject("PERMISSION_ERROR", "Failed to request camera permission: ${e.message}", e)
        }
      }
    }

    AsyncFunction("startRegistration") { promise: Promise ->
      scope.launch {
        try {
          ensureInitialized()
          val currentState = lastRegistrationState::class.simpleName ?: "Unknown"
          Log.i(TAG, "startRegistration called, current state: $currentState")
          val context = appContext.reactContext ?: throw IllegalStateException("Missing context")
          Wearables.startRegistration(context)
          Log.i(TAG, "startRegistration succeeded, awaiting callback from Meta AI")
          promise.resolve(null)
        } catch (e: Exception) {
          Log.e(TAG, "startRegistration error: ${e.message}", e)
          promise.reject(
            "REGISTRATION_ERROR",
            "Failed to start registration with Meta AI: ${e.message}",
            e
          )
        }
      }
    }

    AsyncFunction("awaitRegistration") { promise: Promise ->
      scope.launch {
        try {
          ensureInitialized()
          ensureRegistered()
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject(
            "REGISTRATION_WAIT_ERROR",
            "Failed while waiting for registration: ${e.message}",
            e
          )
        }
      }
    }

    AsyncFunction("getRegistrationState") { promise: Promise ->
      try {
        val state = lastRegistrationState::class.simpleName ?: "Unknown"
        promise.resolve(state)
      } catch (e: Exception) {
        promise.reject("REGISTRATION_STATE_ERROR", "Failed to get registration state: ${e.message}", e)
      }
    }

    AsyncFunction("capturePhotoToTempFile") { promise: Promise ->
      scope.launch {
        try {
          ensureInitialized()
          ensureRegistered()

          val permissionStatus = ensureCameraPermission()
          if (permissionStatus != PermissionStatus.Granted) {
            throw IllegalStateException("Camera permission not granted")
          }

          val context = appContext.reactContext ?: throw IllegalStateException("Missing context")
          val application = context.applicationContext as? Application
            ?: throw IllegalStateException("Missing application")

          val deviceSelector: DeviceSelector = AutoDeviceSelector()
          val activeDevice =
            withTimeoutOrNull(DEVICE_TIMEOUT_MS) {
              deviceSelector.activeDevice(Wearables.devices).first { it != null }
            } ?: throw IllegalStateException("No active wearable device found")

          Log.i(TAG, "✅ Active device selected: $activeDevice")

          val streamSession =
            Wearables.startStreamSession(
              application,
              deviceSelector,
              StreamConfiguration(videoQuality = VideoQuality.LOW, 24)
            )

          val photoData = try {
            val streaming =
              withTimeoutOrNull(DEVICE_TIMEOUT_MS) {
                streamSession.state.first { it == StreamSessionState.STREAMING }
              }
            if (streaming != StreamSessionState.STREAMING) {
              throw IllegalStateException("Stream did not start")
            }

            val result = streamSession.capturePhoto()
            result.getOrNull() ?: throw IllegalStateException("Photo capture failed")
          } finally {
            streamSession.close()
          }

          val timestampMs = System.currentTimeMillis()
          val (tempFile, width, height) =
            when (photoData) {
              is PhotoData.Bitmap -> {
                val fileName = "meta-photo-$timestampMs.jpg"
                val tempFile = File(context.cacheDir, fileName)
                FileOutputStream(tempFile).use { stream ->
                  photoData.bitmap.compress(Bitmap.CompressFormat.JPEG, 90, stream)
                }
                Triple(tempFile, photoData.bitmap.width, photoData.bitmap.height)
              }
              is PhotoData.HEIC -> {
                val fileName = "meta-photo-$timestampMs.heic"
                val tempFile = File(context.cacheDir, fileName)
                val bytes = byteBufferToBytes(photoData.data)
                FileOutputStream(tempFile).use { stream ->
                  stream.write(bytes)
                }
                val (width, height) = readImageBounds(bytes)
                Triple(tempFile, width, height)
              }
            }

          promise.resolve(
            mapOf(
              "localPath" to tempFile.absolutePath,
              "width" to width,
              "height" to height,
              "sizeBytes" to tempFile.length(),
              "timestamp" to (timestampMs / 1000L)
            )
          )
        } catch (e: Exception) {
          promise.reject("CAPTURE_ERROR", "Failed to capture photo: ${e.message}", e)
        }
      }
    }
  }

  private fun ensureInitialized() {
    if (!isInitialized) {
      val context = appContext.reactContext ?: throw IllegalStateException("Missing context")
      Wearables.initialize(context)
      isInitialized = true
    }
  }

  private suspend fun ensureCameraPermission(): PermissionStatus {
    val current = Wearables.checkPermissionStatus(Permission.CAMERA).getOrNull()
    if (current == PermissionStatus.Granted) {
      return current
    }
    return requestWearablesPermission(Permission.CAMERA)
  }

  private suspend fun ensureRegistered() {
    val state = Wearables.registrationState.first()
    if (state is RegistrationState.Registered) {
      return
    }

    val context = appContext.reactContext ?: throw IllegalStateException("Missing context")
    Wearables.startRegistration(context)

    val registered =
      withTimeoutOrNull(DEVICE_TIMEOUT_MS) {
        Wearables.registrationState.first { it is RegistrationState.Registered }
      }

    if (registered !is RegistrationState.Registered) {
      throw IllegalStateException("Wearables registration not completed")
    }
  }

  private suspend fun requestWearablesPermission(permission: Permission): PermissionStatus {
    return permissionMutex.withLock {
      withContext(Dispatchers.Main) {
        val activity = appContext.activityProvider?.currentActivity as? ComponentActivity
          ?: throw IllegalStateException("Missing activity")

        ensurePermissionLauncher(activity)

        suspendCancellableCoroutine { continuation ->
          permissionContinuation = continuation
          continuation.invokeOnCancellation { permissionContinuation = null }
          permissionLauncher?.launch(permission)
            ?: continuation.resume(PermissionStatus.Denied)
        }
      }
    }
  }

  private fun ensurePermissionLauncher(activity: ComponentActivity) {
    if (permissionLauncher != null && permissionLauncherActivity === activity) return

    permissionLauncher?.unregister()
    permissionLauncher = null
    permissionLauncherActivity = activity

    val key = "ExpoWearablesCameraPermission_${activity.hashCode()}"
    permissionLauncher =
      activity.activityResultRegistry.register(key, Wearables.RequestPermissionContract()) { result ->
        val permissionStatus = result.getOrDefault(PermissionStatus.Denied)
        permissionContinuation?.resume(permissionStatus)
        permissionContinuation = null
      }
  }

  private fun byteBufferToBytes(buffer: java.nio.ByteBuffer): ByteArray {
    val duplicate = buffer.slice()
    val bytes = ByteArray(duplicate.remaining())
    duplicate.get(bytes)
    return bytes
  }

  private fun readImageBounds(bytes: ByteArray): Pair<Int, Int> {
    val options = BitmapFactory.Options()
    options.inJustDecodeBounds = true
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    return Pair(options.outWidth.coerceAtLeast(0), options.outHeight.coerceAtLeast(0))
  }

  private fun decodeHeicToBitmap(buffer: java.nio.ByteBuffer): Bitmap {
    val bytes = byteBufferToBytes(buffer)
    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    val transform = getTransform(getExifInfo(bytes))
    return applyTransform(bitmap, transform)
  }

  private fun getExifInfo(heicBytes: ByteArray): ExifInterface? {
    return try {
      ByteArrayInputStream(heicBytes).use { inputStream -> ExifInterface(inputStream) }
    } catch (e: IOException) {
      Log.w(TAG, "Failed to read EXIF from HEIC", e)
      null
    }
  }

  private fun getTransform(exifInfo: ExifInterface?): Matrix {
    val matrix = Matrix()
    if (exifInfo == null) return matrix

    when (
      exifInfo.getAttributeInt(
        ExifInterface.TAG_ORIENTATION,
        ExifInterface.ORIENTATION_NORMAL
      )
    ) {
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> {
        matrix.postRotate(90f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
      ExifInterface.ORIENTATION_TRANSVERSE -> {
        matrix.postRotate(270f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
      ExifInterface.ORIENTATION_NORMAL,
      ExifInterface.ORIENTATION_UNDEFINED -> {
        // No transformation needed
      }
    }

    return matrix
  }

  private fun applyTransform(bitmap: Bitmap, matrix: Matrix): Bitmap {
    if (matrix.isIdentity) return bitmap
    return try {
      val transformed = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
      if (transformed != bitmap) {
        bitmap.recycle()
      }
      transformed
    } catch (e: OutOfMemoryError) {
      Log.e(TAG, "Failed to apply transformation due to memory", e)
      bitmap
    }
  }

  private fun emitStatus() {
    val stateName = lastRegistrationState::class.simpleName ?: "Unknown"
    Log.i(TAG, "emitStatus: registrationState=$stateName, hasActiveDevice=$hasActiveDevice, lastError=$lastError")
    sendEvent(
      "onWearablesStatus",
      bundleOf(
        "registrationState" to stateName,
        "registrationStateDetail" to lastRegistrationState.toString(),
        "hasActiveDevice" to hasActiveDevice,
        "lastError" to lastError
      )
    )
  }
}

