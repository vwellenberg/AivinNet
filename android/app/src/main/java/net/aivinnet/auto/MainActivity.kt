package net.aivinnet.auto

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import net.aivinnet.auto.databinding.ActivityMainBinding
import java.io.IOException

/** The phone UI: sign in and out. Android Auto does the rest through [PlaybackService]. */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var api: AivinApi

    // The media notification needs the permission on Android 13+. Denying it is harmless
    // here, so the result is ignored.
    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        api = AivinApi.create(this)
        binding.serverUrl.setText(api.store.baseUrl.orEmpty())
        binding.username.setText(api.store.username.orEmpty())

        binding.loginButton.setOnClickListener { login() }
        binding.logoutButton.setOnClickListener {
            api.logout()
            render()
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        render()
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
            getString(R.string.status_logged_in, store.username.orEmpty())
        } else {
            getString(R.string.status_logged_out)
        }
        binding.logoutButton.isEnabled = store.isLoggedIn
    }
}
