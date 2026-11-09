package net.aivinnet.auto

import android.content.Context
import android.content.SharedPreferences
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Any failed call to the AivinNet server. It is an IOException, so OkHttp and Media3 pass it on. */
open class AivinException(message: String) : IOException(message)

/** Not signed in, or the refresh token was refused. The car shows "sign in on the phone". */
class AuthExpiredException :
    AivinException("Anmeldung abgelaufen. Bitte auf dem Telefon neu anmelden.")

class ServerException(val code: Int, message: String) : AivinException(message)

/**
 * Refreshes the access token with the refresh token. Only one refresh runs at a time, and a
 * caller whose token was already replaced by another thread just retries with the new one.
 */
internal class AuthManager(
    private val store: SessionStore,
    private val plain: OkHttpClient,
) {
    @Synchronized
    fun refreshAfter(usedAccessToken: String): Boolean {
        val current = store.accessToken
        if (current != null && current != usedAccessToken) return true

        val base = store.baseUrl
        val refresh = store.refreshToken
        if (base == null || refresh == null) {
            store.clear()
            return false
        }

        val request = Request.Builder()
            .url("$base/auth/refresh")
            .header("Authorization", "Bearer $refresh")
            .post(ByteArray(0).toRequestBody(null))
            .build()

        return try {
            plain.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    store.clear()
                    return false
                }
                val tokens = AivinJson.parseLogin(response.body?.string().orEmpty())
                store.saveTokens(tokens.accessToken, tokens.refreshToken)
                true
            }
        } catch (e: IOException) {
            // Specified behaviour: a failed refresh counts as logged out.
            store.clear()
            false
        }
    }
}

/** Adds the bearer token to every request. A 401 triggers one refresh and one retry. */
internal class AuthInterceptor(
    private val store: SessionStore,
    private val auth: AuthManager,
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val token = store.accessToken ?: throw AuthExpiredException()

        val first = chain.proceed(original.withBearer(token))
        if (first.code != 401) return first
        first.close()

        if (!auth.refreshAfter(token)) throw AuthExpiredException()
        val fresh = store.accessToken ?: throw AuthExpiredException()
        return chain.proceed(original.withBearer(fresh))
    }

    private fun Request.withBearer(token: String): Request =
        newBuilder().header("Authorization", "Bearer $token").build()
}

/**
 * Client for the AivinNet server. Every function suspends and runs on Dispatchers.IO.
 *
 * [authedClient] is what the player streams with too, so playback and browsing share one
 * refresh logic.
 */
class AivinApi private constructor(
    val store: SessionStore,
    private val plainClient: OkHttpClient,
    val authedClient: OkHttpClient,
) {

    val isLoggedIn: Boolean get() = store.isLoggedIn

    /** Signs in and stores the server URL and both tokens. Throws [AivinException] on failure. */
    suspend fun login(serverUrl: String, username: String, password: String): LoginResult =
        withContext(Dispatchers.IO) {
            val base = ServerUrl.normalize(serverUrl)
            if (base.toHttpUrlOrNull() == null) throw AivinException("Ungültige Server-URL")

            val body = JSONObject()
                .put("username", username)
                .put("password", password)
                .toString()
                .toRequestBody(JSON_TYPE)
            val request = Request.Builder().url("$base/auth/login").post(body).build()

            val (code, text) = execute(plainClient, request)
            if (code !in 200..299) throw loginError(code)

            val tokens = AivinJson.parseLogin(text)
            store.saveLogin(base, username, tokens.accessToken, tokens.refreshToken)
            tokens
        }

    fun logout() = store.clear()

    suspend fun playlists(): List<PlaylistSummary> = withContext(Dispatchers.IO) {
        val (code, text) = authedGet("/playlists?no_images=true")
        if (code !in 200..299) throw ServerException(code, "Playlists nicht abrufbar (HTTP $code)")
        AivinJson.parsePlaylists(text)
    }

    /** Null when the server does not know the id (404), e.g. a mix the user does not have. */
    suspend fun playlist(id: String): PlaylistDetail? = withContext(Dispatchers.IO) {
        val (code, text) = authedGet("/playlists/$id?limit=-1")
        when {
            code == 404 -> null
            code !in 200..299 -> throw ServerException(code, "Playlist nicht abrufbar (HTTP $code)")
            else -> AivinJson.parsePlaylistDetail(id, text)
        }
    }

    suspend fun logPlay(play: ScrobblePlay) = withContext(Dispatchers.IO) {
        val base = requireBaseUrl()
        val body = JSONObject()
            .put("trackhash", play.trackhash)
            .put("timestamp", play.timestamp)
            .put("duration", play.duration)
            .put("source", play.source)
            .toString()
            .toRequestBody(JSON_TYPE)
        val request = Request.Builder().url("$base/logger/track/log").post(body).build()
        val (code, _) = execute(authedClient, request)
        if (code !in 200..299) throw ServerException(code, "Play nicht gemeldet (HTTP $code)")
    }

    /** The server URL, or [AuthExpiredException] when nobody is signed in. */
    fun requireBaseUrl(): String = store.baseUrl?.takeIf { store.isLoggedIn }
        ?: throw AuthExpiredException()

    private fun authedGet(path: String): Pair<Int, String> {
        val request = Request.Builder().url(requireBaseUrl() + path).get().build()
        return execute(authedClient, request)
    }

    private fun execute(client: OkHttpClient, request: Request): Pair<Int, String> =
        client.newCall(request).execute().use { response ->
            response.code to response.body?.string().orEmpty()
        }

    private fun loginError(code: Int): AivinException = when (code) {
        401 -> ServerException(code, "Falsches Passwort")
        404 -> ServerException(code, "Benutzer nicht gefunden")
        429 -> ServerException(code, "Zu viele Fehlversuche, bitte kurz warten")
        else -> ServerException(code, "Server antwortete mit HTTP $code")
    }

    companion object {
        private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()

        /** Each caller (the service, the activity) builds its own instance; they share the prefs. */
        fun create(context: Context): AivinApi {
            val prefs: SharedPreferences =
                context.applicationContext.getSharedPreferences(SessionStore.PREFS_NAME, Context.MODE_PRIVATE)
            val store = SessionStore(prefs)
            val plain = OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(10, TimeUnit.SECONDS)
                .writeTimeout(10, TimeUnit.SECONDS)
                .build()
            val authed = plain.newBuilder()
                .addInterceptor(AuthInterceptor(store, AuthManager(store, plain)))
                .build()
            return AivinApi(store, plain, authed)
        }
    }
}
