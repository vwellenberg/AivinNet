"""The Last.fm call, as it actually leaves the process.

`tests/test_outbound_timeouts.py` reads the source and demands a `timeout=`
somewhere in the call. That census cannot tell whether the value is sane or
whether it survives the `post()` wrapper every Last.fm call goes through, so
the runtime side is pinned here.

Why it matters twice over: `get_session_key()` posts from inside a request
(one stuck call freezes the single-threaded server), and `scrobble()` posts
from an `@background` thread, which is not a daemon and would keep the process
alive at shutdown.
"""

from types import SimpleNamespace

import pytest


@pytest.fixture()
def plugin(monkeypatch):
    """`post()` with the plugin's registry and config stubbed out — the subject
    here is the HTTP call, not plugin activation."""
    import aivinnet.plugins.lastfm as lastfm

    sent = []

    def fake_post(url, **kwargs):
        sent.append((url, kwargs))
        return SimpleNamespace(json=lambda: {"session": {"key": "sk"}}, status_code=200)

    monkeypatch.setattr(lastfm.requests, "post", fake_post)

    instance = SimpleNamespace(
        config=SimpleNamespace(
            lastfmApiKey="key",
            lastfmApiSecret="secret",
            lastfmSessionKeys={"1": "session"},
        ),
        current_userid=1,
    )
    instance.get_api_signature = lambda data: lastfm.LastFmPlugin.get_api_signature(instance, data)
    return lastfm, instance, sent


def test_a_scrobble_carries_a_deadline(plugin):
    lastfm, instance, sent = plugin

    lastfm.LastFmPlugin.post(instance, {"method": "track.scrobble"})

    ((_url, kwargs),) = sent
    connect, read = kwargs["timeout"]
    assert 0 < connect <= 10, "a connect that slow is a dead peer"
    assert 0 < read <= 30, "no answer by then is not worth an occupied thread"


def test_the_session_exchange_carries_it_too(plugin):
    """This one runs inside a request; without the deadline it freezes the app."""
    lastfm, instance, sent = plugin
    instance.post = lambda data, useSessionKey=True: lastfm.LastFmPlugin.post(
        instance, data, useSessionKey=useSessionKey
    )

    assert lastfm.LastFmPlugin.get_session_key(instance, "token") == "sk"

    ((url, kwargs),) = sent
    assert "timeout" in kwargs
    assert "sk=" not in url, "the session key cannot be sent before it exists"
