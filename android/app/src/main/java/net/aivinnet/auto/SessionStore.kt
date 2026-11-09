package net.aivinnet.auto

import android.content.SharedPreferences

/** Server URL and tokens, kept in the app's private SharedPreferences. */
class SessionStore(private val prefs: SharedPreferences) {

    val baseUrl: String? get() = prefs.getString(KEY_BASE_URL, null)
    val username: String? get() = prefs.getString(KEY_USERNAME, null)
    val accessToken: String? get() = prefs.getString(KEY_ACCESS, null)
    val refreshToken: String? get() = prefs.getString(KEY_REFRESH, null)

    val isLoggedIn: Boolean get() = accessToken != null && refreshToken != null

    fun saveLogin(baseUrl: String, username: String, accessToken: String, refreshToken: String) {
        prefs.edit()
            .putString(KEY_BASE_URL, baseUrl)
            .putString(KEY_USERNAME, username)
            .putString(KEY_ACCESS, accessToken)
            .putString(KEY_REFRESH, refreshToken)
            .apply()
    }

    fun saveTokens(accessToken: String, refreshToken: String) {
        prefs.edit()
            .putString(KEY_ACCESS, accessToken)
            .putString(KEY_REFRESH, refreshToken)
            .apply()
    }

    /** Logs out. The server URL stays, so the login form is pre-filled next time. */
    fun clear() {
        prefs.edit()
            .remove(KEY_ACCESS)
            .remove(KEY_REFRESH)
            .remove(KEY_USERNAME)
            .apply()
    }

    companion object {
        const val PREFS_NAME = "aivinnet_session"
        private const val KEY_BASE_URL = "base_url"
        private const val KEY_USERNAME = "username"
        private const val KEY_ACCESS = "access_token"
        private const val KEY_REFRESH = "refresh_token"
    }
}
