package net.aivinnet.auto

import java.net.URI
import java.net.URLEncoder

/** Stream URL of `GET /file/<trackhash>/legacy?filepath=…` (api/stream.py). */
object StreamUrls {

    fun build(baseUrl: String, trackhash: String, filepath: String): String {
        // URLEncoder writes a space as `+`; the path wants %20, which every decoder reads
        // the same way. It also encodes `/` as %2F, which Flask decodes back.
        val encoded = URLEncoder.encode(filepath, "UTF-8").replace("+", "%20")
        return "${baseUrl.trimEnd('/')}/file/$trackhash/legacy?filepath=$encoded"
    }
}

object ServerUrl {

    /**
     * Turns what the user typed into a base URL without trailing slash.
     * A bare `192.168.1.10:1970` gets `http://`, because the home servers speak plain HTTP.
     */
    fun normalize(input: String): String {
        val trimmed = input.trim().trimEnd('/')
        if (trimmed.isEmpty()) return ""
        return if ("://" in trimmed) trimmed else "http://$trimmed"
    }
}

/**
 * Whether the URL sends password and tokens unencrypted over the internet: plain `http` to a
 * host that is not on the LAN or a VPN. In the car the phone is on mobile data, so this is the
 * case worth a warning. LAN (RFC 1918), loopback, `.local`/`.lan` names and CGNAT/Tailscale
 * (100.64/10, WireGuard-encrypted) count as private.
 */
object Transport {
    fun isUnencryptedRemote(baseUrl: String): Boolean {
        val uri = runCatching { URI(baseUrl) }.getOrNull() ?: return false
        if (!uri.scheme.equals("http", ignoreCase = true)) return false
        val host = uri.host?.lowercase() ?: return false
        return !isPrivateHost(host)
    }

    private fun isPrivateHost(host: String): Boolean {
        if (host == "localhost" || host.endsWith(".local") || host.endsWith(".lan")) return true
        val parts = host.split('.').mapNotNull { it.toIntOrNull() }
        if (parts.size != 4 || host.count { it == '.' } != 3) return false
        val (a, b) = parts[0] to parts[1]
        return a == 10 || a == 127 ||
            (a == 172 && b in 16..31) ||
            (a == 192 && b == 168) ||
            (a == 100 && b in 64..127)
    }
}
