"""
The startup banner lists URLs the user is expected to click.

Regression: with the default bind address the banner printed
`http://0.0.0.0:1970` first. 0.0.0.0 is a wildcard *bind* address, not a
destination — Windows refuses the connection and Chrome blocks it — so the most
prominent link in the banner was the one that never works.
"""

import pytest

from aivinnet import start_info_logger


class _Metadata:
    version = "9.9.9"


class _Paths:
    config_dir = "/tmp/aivinnet-config"


@pytest.fixture(autouse=True)
def _no_install(monkeypatch):
    # The fast lane has no installed distribution (Metadata.version reads it)
    # and must not create a real config folder (Paths() does).
    monkeypatch.setattr(start_info_logger, "Metadata", _Metadata)
    monkeypatch.setattr(start_info_logger, "Paths", _Paths)


@pytest.fixture
def lan_ip(monkeypatch):
    monkeypatch.setattr(start_info_logger, "get_ip", lambda: "192.168.0.251")


@pytest.mark.parametrize("wildcard", ["0.0.0.0", ""])
def test_wildcard_bind_lists_only_reachable_urls(wildcard, lan_ip, capsys):
    start_info_logger.log_startup_info(wildcard, 1970)
    out = capsys.readouterr().out

    assert "http://127.0.0.1:1970" in out
    assert "http://192.168.0.251:1970" in out
    assert "0.0.0.0" not in out
    assert "http://:1970" not in out


def test_ipv6_wildcard_lists_bracketed_ipv6_loopback(lan_ip, capsys):
    start_info_logger.log_startup_info("::", 1970)
    out = capsys.readouterr().out

    assert "http://[::1]:1970" in out
    assert "http://:::1970" not in out


def test_specific_ipv6_host_is_bracketed(lan_ip, capsys):
    start_info_logger.log_startup_info("fe80::1", 1970)
    out = capsys.readouterr().out

    assert "http://[fe80::1]:1970" in out


def test_wildcard_bind_without_lan_ip_still_lists_loopback(monkeypatch, capsys):
    monkeypatch.setattr(start_info_logger, "get_ip", lambda: None)
    start_info_logger.log_startup_info("0.0.0.0", 1970)
    out = capsys.readouterr().out

    assert "http://127.0.0.1:1970" in out
    assert "None" not in out


def test_specific_host_is_listed_as_is(lan_ip, capsys):
    start_info_logger.log_startup_info("192.168.0.251", 1970)
    out = capsys.readouterr().out

    assert "http://192.168.0.251:1970" in out
    assert "127.0.0.1" not in out


def test_banner_names_aivinnet(lan_ip, capsys):
    start_info_logger.log_startup_info("0.0.0.0", 1970)
    out = capsys.readouterr().out

    assert "AivinNet" in out
    assert "Swing Music" not in out


def test_container_lists_no_bridge_address(lan_ip, monkeypatch, capsys):
    # Inside Docker get_ip() answers with the bridge address (172.x), which the
    # host cannot open — it was the second link in the banner, and a dead one.
    monkeypatch.setenv(start_info_logger.CONTAINER_ENV, "1")
    start_info_logger.log_startup_info("0.0.0.0", 1970)
    out = capsys.readouterr().out

    assert "http://127.0.0.1:1970" in out
    assert "192.168.0.251" not in out
    assert "port you published" in out


def test_outside_a_container_no_container_hint(lan_ip, monkeypatch, capsys):
    monkeypatch.delenv(start_info_logger.CONTAINER_ENV, raising=False)
    start_info_logger.log_startup_info("0.0.0.0", 1970)
    out = capsys.readouterr().out

    assert "http://192.168.0.251:1970" in out
    assert "container" not in out


@pytest.mark.parametrize("found", [None, "/usr/bin/ffmpeg"])
def test_a_missing_ffmpeg_is_announced(found, lan_ip, monkeypatch, capsys):
    """Silence skipping is on by default and fails silently without ffmpeg (#197)."""
    monkeypatch.setattr(start_info_logger.shutil, "which", lambda name: found if name == "ffmpeg" else None)

    start_info_logger.log_startup_info("0.0.0.0", 1970)
    out = capsys.readouterr().out

    assert ("ffmpeg was not found" in out) is (found is None)


def test_avconv_counts_as_a_decoder(monkeypatch):
    """pydub prefers avconv over ffmpeg, so either one is enough."""
    monkeypatch.setattr(start_info_logger.shutil, "which", lambda name: "/usr/bin/avconv" if name == "avconv" else None)

    assert start_info_logger.has_ffmpeg() is True
