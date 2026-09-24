"""
The silence padding is measured in the background, never in the request.

Regression: `/file/silence` decoded both audio files while the handler waited on
join(). bjoern serves one request at a time, so every track change with the
(default-on) silence skip froze the whole app for the length of two decodes.
"""

import os
import threading

from aivinnet.lib.silence import LEADING, MISSING, TRAILING, SilenceCache


def _file(tmp_path, name="a.flac", content=b"x"):
    path = tmp_path / name
    path.write_bytes(content)
    return str(path)


def test_lookup_never_measures_on_the_calling_thread(tmp_path):
    calls = []
    cache = SilenceCache(lambda kind, path: calls.append((kind, path)) or 7, autostart=False)
    path = _file(tmp_path)

    assert cache.lookup(LEADING, path) is MISSING
    assert calls == []

    cache.drain()

    assert calls == [(LEADING, path)]
    assert cache.lookup(LEADING, path) == 7


def test_asking_twice_before_the_result_measures_once(tmp_path):
    calls = []
    cache = SilenceCache(lambda kind, path: calls.append(path) or 7, autostart=False)
    path = _file(tmp_path)

    cache.lookup(TRAILING, path)
    cache.lookup(TRAILING, path)
    cache.drain()

    assert len(calls) == 1


def test_leading_and_trailing_are_separate_measurements(tmp_path):
    cache = SilenceCache(lambda kind, path: 1 if kind == LEADING else 2, autostart=False)
    path = _file(tmp_path)

    cache.lookup(LEADING, path)
    cache.lookup(TRAILING, path)
    cache.drain()

    assert cache.lookup(LEADING, path) == 1
    assert cache.lookup(TRAILING, path) == 2


def test_a_changed_file_is_measured_again(tmp_path):
    values = iter([10, 20])
    cache = SilenceCache(lambda kind, path: next(values), autostart=False)
    path = _file(tmp_path)

    cache.lookup(LEADING, path)
    cache.drain()
    assert cache.lookup(LEADING, path) == 10

    # Re-encoded: another size and another mtime.
    with open(path, "wb") as f:
        f.write(b"longer content")
    stat = os.stat(path)
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))

    assert cache.lookup(LEADING, path) is MISSING
    cache.drain()
    assert cache.lookup(LEADING, path) == 20


def test_a_failed_measurement_is_remembered_as_none(tmp_path):
    def broken(kind, path):
        raise RuntimeError("ffmpeg missing")

    cache = SilenceCache(broken, autostart=False)
    path = _file(tmp_path)

    cache.lookup(LEADING, path)
    cache.drain()

    # None, not MISSING: asking again must not queue the same failure forever.
    assert cache.lookup(LEADING, path) is None


def test_a_missing_file_is_none_and_not_queued(tmp_path):
    calls = []
    cache = SilenceCache(lambda kind, path: calls.append(path), autostart=False)

    assert cache.lookup(LEADING, str(tmp_path / "gone.flac")) is None
    cache.drain()
    assert calls == []


def test_oldest_results_are_dropped_past_maxsize(tmp_path):
    cache = SilenceCache(lambda kind, path: 5, maxsize=2, autostart=False)
    a, b, c = (_file(tmp_path, n) for n in ("a.mp3", "b.mp3", "c.mp3"))

    for p in (a, b, c):
        cache.lookup(LEADING, p)
    cache.drain()

    assert cache.lookup(LEADING, a) is MISSING
    assert cache.lookup(LEADING, c) == 5


def test_the_worker_thread_measures_and_is_a_daemon(tmp_path):
    done = threading.Event()

    def measure(kind, path):
        done.set()
        return 3

    cache = SilenceCache(measure)
    path = _file(tmp_path)

    assert cache.lookup(LEADING, path) is MISSING
    assert done.wait(5)
    assert cache._thread is not None and cache._thread.daemon

    for _ in range(100):
        if cache.lookup(LEADING, path) == 3:
            break
        threading.Event().wait(0.01)

    assert cache.lookup(LEADING, path) == 3
