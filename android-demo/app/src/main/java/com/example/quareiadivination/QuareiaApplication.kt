package com.example.quareiadivination

import android.app.Application

/** Initializes process-wide services before any Activity can be restored. */
class QuareiaApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        TelemetryController.init(this)
    }
}
