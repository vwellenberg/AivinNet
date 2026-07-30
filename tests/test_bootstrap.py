"""Tests for the first-run bootstrap values."""

from swingmusic.utils.bootstrap import (
    ADMIN_PASSWORD_ENV,
    FALLBACK_ADMIN_PASSWORD,
    initial_admin_password,
)


class TestInitialAdminPassword:
    def test_falls_back_when_unset(self):
        assert initial_admin_password({}) == FALLBACK_ADMIN_PASSWORD

    def test_uses_the_environment_value(self):
        assert initial_admin_password({ADMIN_PASSWORD_ENV: "s3cret-planet"}) == "s3cret-planet"

    def test_strips_surrounding_whitespace(self):
        # systemd EnvironmentFile values pick up trailing newlines very easily,
        # and the resulting password would be untypeable.
        assert initial_admin_password({ADMIN_PASSWORD_ENV: "  s3cret-planet\n"}) == "s3cret-planet"

    def test_empty_value_falls_back_instead_of_setting_an_empty_password(self):
        assert initial_admin_password({ADMIN_PASSWORD_ENV: ""}) == FALLBACK_ADMIN_PASSWORD
        assert initial_admin_password({ADMIN_PASSWORD_ENV: "   "}) == FALLBACK_ADMIN_PASSWORD

    def test_reads_the_real_environment_by_default(self, monkeypatch):
        monkeypatch.setenv(ADMIN_PASSWORD_ENV, "from-os-environ")
        assert initial_admin_password() == "from-os-environ"

    def test_password_is_not_taken_from_a_similarly_named_variable(self):
        assert initial_admin_password({"ADMIN_PASSWORD": "wrong"}) == FALLBACK_ADMIN_PASSWORD
