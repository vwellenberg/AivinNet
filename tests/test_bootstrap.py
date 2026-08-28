"""Tests for the first-run bootstrap values."""

from aivinnet.utils.bootstrap import (
    ADMIN_PASSWORD_ENV,
    initial_admin_password,
)


class TestInitialAdminPassword:
    def test_uses_the_environment_value_and_reports_it_as_configured(self):
        assert initial_admin_password({ADMIN_PASSWORD_ENV: "s3cret-planet"}) == ("s3cret-planet", False)

    def test_strips_surrounding_whitespace(self):
        # systemd EnvironmentFile values pick up trailing newlines very easily,
        # and the resulting password would be untypeable.
        assert initial_admin_password({ADMIN_PASSWORD_ENV: "  s3cret-planet\n"}) == ("s3cret-planet", False)

    def test_reads_the_real_environment_by_default(self, monkeypatch):
        monkeypatch.setenv(ADMIN_PASSWORD_ENV, "from-os-environ")
        assert initial_admin_password() == ("from-os-environ", False)

    def test_generates_when_unset_instead_of_using_a_known_default(self):
        # THE regression guard for this module. Upstream shipped `admin` here and
        # every install path except install.sh came up with it, on a server that
        # binds 0.0.0.0. Anything constant, guessable or short is the bug.
        password, generated = initial_admin_password({})

        assert generated is True
        assert password not in {"admin", "password", "aivinnet", ""}
        assert len(password) >= 16

    def test_generated_passwords_are_not_reused(self):
        first, _ = initial_admin_password({})
        second, _ = initial_admin_password({})

        assert first != second

    def test_empty_value_generates_instead_of_setting_an_empty_password(self):
        for blank in ("", "   "):
            password, generated = initial_admin_password({ADMIN_PASSWORD_ENV: blank})

            assert generated is True
            assert password

    def test_password_is_not_taken_from_a_similarly_named_variable(self):
        password, generated = initial_admin_password({"ADMIN_PASSWORD": "wrong"})

        assert generated is True
        assert password != "wrong"
