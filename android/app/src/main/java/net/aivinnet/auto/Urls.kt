package net.aivinnet.auto

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
