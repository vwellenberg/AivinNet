"""
The login brute-force guard.

Time is injected rather than slept: the whole point of the module is that the
server never waits (bjoern is single-threaded), so a test that sleeps would be
both slow and a poor description of what it checks.

Four of these are regressions for defects the first two drafts shipped — each is
marked. They are the reason the state is a small record per account rather than
a list of timestamps.
"""

import pytest

from aivinnet.lib import loginguard


@pytest.fixture(autouse=True)
def clean_state():
    loginguard.reset_all()
    yield
    loginguard.reset_all()


def fail_once(username: str, at: float):
    """One complete failed login: claim the slot, then report failure."""
    assert loginguard.begin_attempt(username, now=at) == 0.0
    loginguard.finish_attempt(username, success=False, now=at)


def fail_times(username: str, count: int, at: float):
    for _ in range(count):
        fail_once(username, at)


def test_a_fresh_account_may_try():
    assert loginguard.seconds_until_retry("ada", now=1000.0) == 0.0


def test_below_the_limit_stays_open():
    fail_times("ada", loginguard.MAX_ATTEMPTS - 1, at=1000.0)

    assert loginguard.seconds_until_retry("ada", now=1000.0) == 0.0


def test_hitting_the_limit_locks_the_account():
    fail_times("ada", loginguard.MAX_ATTEMPTS, at=1000.0)

    assert loginguard.seconds_until_retry("ada", now=1000.0) == pytest.approx(loginguard.LOCKOUT_SECONDS)


def test_the_lock_expires():
    fail_times("ada", loginguard.MAX_ATTEMPTS, at=1000.0)
    later = 1000.0 + loginguard.LOCKOUT_SECONDS + 1

    assert loginguard.seconds_until_retry("ada", now=later) == 0.0


def test_the_lock_re_arms_after_it_expires():
    """REGRESSION. The first version anchored the lockout on the OLDEST failure
    in the window, so after one 60-second pause an account could never lock
    again — "8 guesses, one pause, then unlimited"."""
    fail_times("ada", loginguard.MAX_ATTEMPTS, at=1000.0)
    after_lock = 1000.0 + loginguard.LOCKOUT_SECONDS + 1

    fail_times("ada", loginguard.MAX_ATTEMPTS, at=after_lock)

    assert loginguard.seconds_until_retry("ada", now=after_lock) == pytest.approx(loginguard.LOCKOUT_SECONDS)


def test_failures_age_out_of_the_window():
    """Eight wrong tries spread over a day must not add up to a lockout."""
    for i in range(loginguard.MAX_ATTEMPTS * 3):
        moment = 1000.0 + i * (loginguard.WINDOW_SECONDS + 1)
        assert loginguard.seconds_until_retry("ada", now=moment) == 0.0
        fail_once("ada", moment)


def test_a_lock_is_per_account():
    """The reason this counts usernames and not addresses: one account under
    attack must never lock out the rest of the household."""
    fail_times("ada", loginguard.MAX_ATTEMPTS, at=1000.0)

    assert loginguard.seconds_until_retry("grace", now=1000.0) == 0.0


def test_a_successful_login_clears_the_history():
    fail_times("ada", loginguard.MAX_ATTEMPTS - 1, at=1000.0)

    loginguard.begin_attempt("ada", now=1000.0)
    loginguard.finish_attempt("ada", success=True, now=1000.0)
    fail_times("ada", loginguard.MAX_ATTEMPTS - 1, at=1000.0)

    assert loginguard.seconds_until_retry("ada", now=1000.0) == 0.0


def test_only_one_attempt_per_account_at_a_time():
    """`check_password` is ~100 ms of PBKDF2. Without an exclusive slot, a
    hundred parallel requests all pass a counter that says 7 — and run a hundred
    hashes at once."""
    assert loginguard.begin_attempt("ada", now=1000.0) == 0.0

    assert loginguard.begin_attempt("ada", now=1000.0) > 0

    loginguard.finish_attempt("ada", success=False, now=1000.0)
    assert loginguard.begin_attempt("ada", now=1000.0) == 0.0


def test_the_slot_is_released_even_when_the_attempt_fails():
    fail_once("ada", 1000.0)

    assert loginguard.begin_attempt("ada", now=1000.0) == 0.0


def test_invented_usernames_cannot_grow_the_table_without_bound():
    """An attacker can make up names; the table must not be a memory leak."""
    for i in range(loginguard.MAX_TRACKED + 500):
        fail_once(f"nobody-{i}", 1000.0 + i)

    assert len(loginguard._accounts) <= loginguard.MAX_TRACKED


def test_a_flood_of_invented_names_cannot_clear_a_lockout():
    """REGRESSION. Evicting by age alone drops exactly the LOCKED accounts — a
    lockout is the oldest kind of entry — so junk could unlock the account
    actually under attack."""
    fail_times("ada", loginguard.MAX_ATTEMPTS, at=1000.0)
    assert loginguard.seconds_until_retry("ada", now=1000.0) > 0

    for i in range(loginguard.MAX_TRACKED + 500):
        fail_once(f"nobody-{i}", 1001.0 + i * 0.001)

    assert loginguard.seconds_until_retry("ada", now=1001.0) > 0, "the flood released the account under attack"


def test_a_full_table_of_locked_junk_cannot_stop_an_account_being_tracked():
    """REGRESSION. Eviction ran right after inserting the new name, and that
    name — one failure, not locked — was always the first candidate. With the
    table full of locked junk it was evicted immediately, so the account being
    attacked was never tracked at all."""
    for i in range(loginguard.MAX_TRACKED):
        fail_times(f"junk-{i}", loginguard.MAX_ATTEMPTS, at=1000.0)

    fail_times("ada", loginguard.MAX_ATTEMPTS, at=1000.0)

    assert loginguard.seconds_until_retry("ada", now=1000.0) > 0, "a full table let the guard be bypassed"


def test_state_per_account_stays_constant_size():
    """REGRESSION. The timestamp list grew without bound per account and was
    copied on every call under the global lock — quadratic CPU from an
    unauthenticated endpoint."""
    for i in range(5000):
        fail_once("ada", 1000.0 + i * (loginguard.WINDOW_SECONDS + 1))

    # One small record, whatever happened.
    assert len(loginguard._accounts) == 1
    assert loginguard._accounts["ada"].failures <= loginguard.MAX_ATTEMPTS


def test_a_very_long_username_cannot_store_a_lot():
    """REGRESSION. The guard REMEMBERS the name until the window expires, and the
    app sets no MAX_CONTENT_LENGTH — unbounded keys turned a few thousand
    requests into gigabytes held for the life of the process."""
    huge = "x" * 5_000_000
    fail_once(huge, 1000.0)

    stored = list(loginguard._accounts)
    assert len(stored) == 1
    assert len(stored[0]) <= loginguard.MAX_KEY_LENGTH


def test_a_truncated_key_still_tracks_the_same_account():
    """Truncation must not become a way to dodge the counter."""
    name = "y" * (loginguard.MAX_KEY_LENGTH + 20)
    fail_times(name, loginguard.MAX_ATTEMPTS, at=1000.0)

    assert loginguard.seconds_until_retry(name, now=1000.0) > 0


def test_a_short_lockout_is_the_point():
    """Usernames are public, so a long lockout is a denial of service against
    the account's real owner. Pin the intent, not just the current number."""
    assert loginguard.LOCKOUT_SECONDS <= 120.0
