package com.example.mobile

import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.util.TimeZone

class MainActivity: FlutterFragmentActivity() {
    private val TIMEZONE_CHANNEL = "com.selectphoto/native_timezone"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, TIMEZONE_CHANNEL).setMethodCallHandler { call, result ->
            if (call.method == "getNativeTimeZone") {
                try {
                    val tzId = TimeZone.getDefault().id
                    result.success(tzId)
                } catch (e: Exception) {
                    result.error("TIMEZONE_ERROR", e.message, null)
                }
            } else {
                result.notImplemented()
            }
        }
    }
}
