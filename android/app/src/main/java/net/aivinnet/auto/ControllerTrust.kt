package net.aivinnet.auto

/**
 * Who may browse the library through the exported media service. Plain Kotlin so the rule is
 * testable without Android.
 */
object ControllerTrust {

    /** Android Auto (phone projection, wired and wireless). */
    const val ANDROID_AUTO = "com.google.android.projection.gearhead"

    /**
     * @param packageVerified whether the package name was checked against the caller's uid — an
     *   unverified name is just a claim, so it never unlocks the allowlist.
     * @param systemTrusted Media3's own verdict: a system app or a holder of MEDIA_CONTENT_CONTROL.
     */
    fun mayBrowse(
        packageName: String,
        packageVerified: Boolean,
        systemTrusted: Boolean,
        ownPackage: String,
    ): Boolean {
        if (systemTrusted) return true
        if (!packageVerified) return false
        return packageName == ownPackage || packageName == ANDROID_AUTO
    }
}
