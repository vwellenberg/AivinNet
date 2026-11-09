package net.aivinnet.auto

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ControllerTrustTest {

    private val own = "net.aivinnet.auto"

    @Test
    fun `android auto may browse when its package name is verified`() {
        assertTrue(ControllerTrust.mayBrowse(ControllerTrust.ANDROID_AUTO, true, false, own))
    }

    @Test
    fun `an unverified claim to be android auto is not enough`() {
        assertFalse(ControllerTrust.mayBrowse(ControllerTrust.ANDROID_AUTO, false, false, own))
    }

    @Test
    fun `the app itself may browse`() {
        assertTrue(ControllerTrust.mayBrowse(own, true, false, own))
    }

    @Test
    fun `system controllers may browse`() {
        assertTrue(ControllerTrust.mayBrowse("com.android.systemui", false, true, own))
    }

    @Test
    fun `any other app and legacy controllers may not browse`() {
        assertFalse(ControllerTrust.mayBrowse("com.example.snoop", true, false, own))
        assertFalse(ControllerTrust.mayBrowse("android.media.session.MediaController", false, false, own))
    }
}

class RefreshRulesTest {

    @Test
    fun `an expired or revoked refresh token ends the session`() {
        assertTrue(RefreshRules.isRefused(401))
        assertTrue(RefreshRules.isRefused(422))
    }

    @Test
    fun `server hiccups keep the session`() {
        assertFalse(RefreshRules.isRefused(500))
        assertFalse(RefreshRules.isRefused(502))
        assertFalse(RefreshRules.isRefused(503))
    }
}
