package net.aivinnet.auto

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.offline.DownloadService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import net.aivinnet.auto.databinding.ActivityMainBinding
import java.io.IOException

/**
 * The phone UI: sign in and out, and choose what is offline. Android Auto does the rest through
 * [PlaybackService].
 *
 * Offline choices are stored per account ([OfflineStore]), and every change is followed by a sync,
 * so the downloads start as soon as the requirements allow (Wi-Fi by default).
 */
@UnstableApi
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var api: AivinApi
    private lateinit var offline: OfflineEngine

    /** A mix or playlist the user can mark, as the server shows it (or as it was last synced). */
    private data class Candidate(val id: String, val name: String, val count: Int)

    // The media notification needs the permission on Android 13+. Denying it is harmless
    // here, so the result is ignored.
    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Edge-to-edge on every version, not only where Android 15+ forces it, so the insets
        // below are the single source of the margins. Without them the server field sat under
        // the status bar and was invisible.
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime(),
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        api = AivinApi.create(this)
        offline = OfflineEngine.get(this)
        binding.serverUrl.setText(api.store.baseUrl.orEmpty())
        binding.username.setText(api.store.username.orEmpty())

        binding.loginButton.setOnClickListener { login() }
        binding.logoutButton.setOnClickListener {
            // Logging out keeps the downloads: a new login as the same user reuses them.
            api.logout()
            render()
        }
        binding.syncButton.setOnClickListener { syncNow() }
        binding.deleteOfflineButton.setOnClickListener { confirmDeleteOffline() }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        render()
        // Not on a rotation: syncNow REPLACEs, and would cancel a running sync that keeps downloads alive.
        if (api.isLoggedIn && savedInstanceState == null) scheduleSync()
    }

    override fun onResume() {
        super.onResume()
        // Downloads run in the background, so the storage line is refreshed each time the screen shows.
        if (api.isLoggedIn) refreshOfflineStatus()
    }

    private fun login() {
        val server = binding.serverUrl.text.toString().trim()
        val username = binding.username.text.toString().trim()
        val password = binding.password.text.toString()
        if (server.isEmpty() || username.isEmpty() || password.isEmpty()) {
            binding.statusText.setText(R.string.status_fields_missing)
            return
        }

        binding.loginButton.isEnabled = false
        binding.statusText.setText(R.string.status_logging_in)
        lifecycleScope.launch {
            try {
                api.login(server, username, password)
                binding.password.setText("")
                render()
                scheduleSync()
            } catch (e: IOException) {
                binding.statusText.text = getString(R.string.status_login_failed, e.message.orEmpty())
            } finally {
                binding.loginButton.isEnabled = true
            }
        }
    }

    private fun render() {
        val store = api.store
        binding.statusText.text = if (store.isLoggedIn) {
            val status = getString(R.string.status_logged_in, store.username.orEmpty())
            val base = store.baseUrl.orEmpty()
            if (Transport.isUnencryptedRemote(base)) {
                status + "\n\n" + getString(R.string.warning_unencrypted)
            } else {
                status
            }
        } else {
            getString(R.string.status_logged_out)
        }
        binding.logoutButton.isEnabled = store.isLoggedIn

        val signedIn = store.isLoggedIn
        binding.offlineSection.visibility = if (signedIn) View.VISIBLE else View.GONE
        if (signedIn) {
            refreshOfflineStatus()
            loadCandidates()
        }
    }

    // region Offline

    /** Runs blocking file and database work off the main thread. */
    private suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) { block() }

    /**
     * Both schedules, with the current mobile-data switch: the 12 h cycle, and one run now (app start,
     * new login). Syncs are idempotent, so the extra run costs little.
     */
    private fun scheduleSync() = lifecycleScope.launch {
        val allowMobile = io { offline.store.load().allowMobile }
        OfflineScheduling.schedulePeriodic(this@MainActivity, allowMobile)
        OfflineScheduling.syncNow(this@MainActivity, allowMobile)
    }

    private fun syncNow() = lifecycleScope.launch {
        val allowMobile = io { offline.store.load().allowMobile }
        OfflineScheduling.syncNow(this@MainActivity, allowMobile)
        Toast.makeText(this@MainActivity, R.string.offline_sync_started, Toast.LENGTH_SHORT).show()
    }

    /** Marks or unmarks one playlist, then syncs so its tracks are fetched or removed. */
    private fun setOffline(candidateId: String, marked: Boolean) {
        val account = api.store.accountKey ?: return
        lifecycleScope.launch {
            val allowMobile = io {
                val next = offline.store.update {
                    if (marked) it.withOffline(account, candidateId) else it.withoutOffline(account, candidateId)
                }
                next.allowMobile
            }
            OfflineScheduling.syncNow(this@MainActivity, allowMobile)
            refreshOfflineStatus()
        }
    }

    /**
     * The mobile-data switch: the stored choice, the running service's requirements, and the two
     * schedules, so none of them keeps the old constraints.
     */
    private fun setAllowMobile(allowed: Boolean) = lifecycleScope.launch {
        io { offline.store.update { it.copy(allowMobile = allowed) } }
        DownloadService.sendSetRequirements(
            this@MainActivity,
            OfflineDownloadService::class.java,
            OfflineEngine.requirementsFor(allowed),
            false,
        )
        OfflineScheduling.schedulePeriodic(this@MainActivity, allowed)
        OfflineScheduling.syncNow(this@MainActivity, allowed)
    }

    /** The storage line and the progress line, from the stored state and the download index. */
    private fun refreshOfflineStatus() = lifecycleScope.launch {
        val account = api.store.accountKey ?: return@launch
        val (allowMobile, text) = io { statusFor(account) }
        binding.offlineStatus.text = text
        binding.mobileDataSwitch.setOnCheckedChangeListener(null)
        binding.mobileDataSwitch.isChecked = allowMobile
        binding.mobileDataSwitch.setOnCheckedChangeListener { _, checked -> setAllowMobile(checked) }
    }

    private fun statusFor(account: String): Pair<Boolean, String> {
        val state = offline.store.load()
        val wanted = state.snapshots(account).values.filterNotNull()
            .flatMapTo(HashSet()) { snapshot -> snapshot.tracks.map { it.trackhash } }
        val lines = try {
            val storage = getString(R.string.offline_status_storage, ByteFormat.storage(offline.storageBytes()))
            val completed = offline.completedTrackhashes()
            val progress = when {
                state.offlineIds(account).isEmpty() -> getString(R.string.offline_status_none)
                wanted.isEmpty() -> getString(R.string.offline_status_pending)
                else -> resources.getQuantityString(
                    R.plurals.offline_status_progress,
                    wanted.size,
                    wanted.count { it in completed },
                    wanted.size,
                )
            }
            "$storage\n$progress"
        } catch (e: IOException) {
            getString(R.string.offline_status_unreadable)
        }
        return state.allowMobile to lines
    }

    /**
     * The rows the user can mark: the mixes that exist and the playlists, as the server shows them.
     * When the server cannot be reached, the playlists already offline stay listed, so they can
     * still be unmarked.
     */
    private fun loadCandidates() = lifecycleScope.launch {
        val account = api.store.accountKey ?: return@launch
        val online = try {
            fetchCandidates()
        } catch (e: IOException) {
            emptyList()
        }
        val (marked, stored) = io {
            val state = offline.store.load()
            state.offlineIds(account) to state.snapshots(account)
        }
        val listedIds = online.map { it.id }.toSet()
        val fromStore = stored
            .filterKeys { it !in listedIds }
            .map { (id, snapshot) -> Candidate(id, snapshot?.name ?: id, snapshot?.tracks?.size ?: 0) }
        renderRows(online + fromStore, marked)
    }

    private suspend fun fetchCandidates(): List<Candidate> = withContext(Dispatchers.IO) {
        val mixes = MediaIds.MIX_IDS.mapNotNull { id ->
            api.playlist(id)?.takeIf { it.tracks.isNotEmpty() }?.let { Candidate(id, it.name, it.tracks.size) }
        }
        val playlists = api.playlists().map { Candidate(it.id, it.name, it.count) }
        mixes + playlists
    }

    private fun renderRows(candidates: List<Candidate>, marked: Set<String>) {
        binding.offlineList.removeAllViews()
        if (candidates.isEmpty()) {
            binding.offlineList.addView(TextView(this).apply { setText(R.string.offline_no_lists) })
            return
        }
        for (candidate in candidates) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dp(6), 0, dp(6))
            }
            val label = TextView(this).apply {
                text = getString(
                    R.string.offline_row_label,
                    candidate.name,
                    resources.getQuantityString(R.plurals.track_count, candidate.count, candidate.count),
                )
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
            val toggle = SwitchCompat(this).apply {
                isChecked = candidate.id in marked
                setOnCheckedChangeListener { _, checked -> setOffline(candidate.id, checked) }
            }
            row.addView(label)
            row.addView(toggle)
            binding.offlineList.addView(row)
        }
    }

    private fun confirmDeleteOffline() {
        AlertDialog.Builder(this)
            .setTitle(R.string.offline_delete_title)
            .setMessage(R.string.offline_delete_message)
            .setPositiveButton(R.string.offline_delete_confirm) { _, _ -> deleteOffline() }
            .setNegativeButton(R.string.offline_delete_cancel, null)
            .show()
    }

    /**
     * Removes every download and every mark. The sync lock is held so a sync running at this moment
     * cannot write its snapshots back after the store was emptied.
     */
    private fun deleteOffline() = lifecycleScope.launch {
        withContext(Dispatchers.IO) {
            offline.syncLock.withLock {
                offline.store.update { state -> OfflineState(allowMobile = state.allowMobile) }
            }
        }
        DownloadService.sendRemoveAllDownloads(this@MainActivity, OfflineDownloadService::class.java, false)
        refreshOfflineStatus()
        loadCandidates()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    // endregion
}
