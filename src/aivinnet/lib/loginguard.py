"""
Brute-force protection for the login endpoint.

Pure logic, no Flask: the HTTP half lives in `api/auth.py`. Kept here so it can
be tested in the fast lane, the same split as `lib/groupsession.py`.

Five constraints shaped this, and together they rule out the textbook answer:

1. **Never sleep.** On Linux the app runs under bjoern, which is evented and
   single-threaded, so "delay the answer by two seconds" would stop the whole
   app — including playback — for every other listener. The guard *refuses*
   immediately (429) instead of slowing an answer down.
2. **RAM only.** The counters must not touch the database on a path anyone can
   trigger from outside.
3. **Count by USERNAME, not by address.** Behind `tailscale serve` (or any
   reverse proxy) every remote listener arrives with the proxy's address, so an
   IP counter would lock out the household at once while an attacker coming
   from elsewhere keeps their own budget.
4. ⚠️ **A lockout is itself a denial of service, so it must stay SHORT.**
   Usernames are public (the login screen lists them when `usersOnLogin` is
   set), so a five-minute lockout, refreshed by eight requests, locks the only
   admin out of their own server for as long as someone keeps asking. It does
   not even take malice — a phone with a stale saved password retrying in the
   background does it too. Hence 60 seconds, and no escalation: the goal is to
   make guessing hopeless, not to punish. At 8 tries per minute any usable
   password is safe, and a locked-out human waits a minute.
5. **One attempt per account at a time.** `check_password` runs 100k PBKDF2
   rounds (~100 ms). Two things follow: a check-then-act gap of that length lets
   a hundred parallel requests through a counter that says 7 (the Windows path
   runs `waitress.serve(..., threads=100)`), and a hundred parallel hashes are
   their own denial of service. `begin_attempt` therefore hands out an
   exclusive slot per account, released by `finish_attempt`.

⚠️ **State is a small record per account, not a list of timestamps.** The list
version was wrong three ways at once — it anchored the lockout on the OLDEST
failure in the window (so an account could never lock a second time), it grew
without bound per account, and its eviction pass could delete the entry it had
just written. A `locked_until` stamp makes each of those a non-question.
"""

from dataclasses import dataclass, field
from threading import Lock
from time import monotonic

MAX_ATTEMPTS = 8
WINDOW_SECONDS = 300.0

# Deliberately short and non-escalating — see constraint 4 above.
LOCKOUT_SECONDS = 60.0

# An attacker can invent usernames, and every new one would otherwise add an
# entry for ever — a slow memory leak reachable from outside.
#
# ⚠️ The cap is a last resort, not the defence, because filling the table is the
# one way to make `_evict` drop a locked entry (see there). Two things keep that
# out of reach: `LoginBody.username` is bounded at 64 characters, so each record
# is ~200 bytes and 20k of them are ~4 MB; and every junk entry needs 8 requests
# and frees itself after LOCKOUT_SECONDS, so holding the table full means
# sustaining ~2700 requests/second against a server that handles one at a time.
# The attack that reaches this limit has already taken the server down by
# volume alone.
MAX_TRACKED = 20_000

# Defence in depth: the request model bounds this, but the guard is a library and
# should not depend on its caller's validation for a memory bound.
MAX_KEY_LENGTH = 64


@dataclass
class _Account:
    failures: int = 0
    window_start: float = 0.0
    locked_until: float = 0.0
    busy: bool = field(default=False)


_accounts: dict[str, _Account] = {}

# ⚠️ Not optional, and not only for the counter: the "one request at a time"
# premise holds for bjoern (Linux) but NOT for the Windows path, where waitress
# runs handlers in parallel.
_lock = Lock()


def _key(username: str) -> str:
    """What the table is keyed by. Bounded so one request cannot store a lot."""
    return username[:MAX_KEY_LENGTH]


def _retry_after(account: _Account, now: float) -> float:
    return max(0.0, account.locked_until - now)


def _evict(keep: str, now: float) -> None:
    """
    Make room, without handing an attacker an eraser.

    Two ways this goes wrong, both found by review rather than by thinking:
    evicting by age alone drops exactly the LOCKED accounts (a lockout is the
    oldest kind of entry), and evicting the entry just written lets a flood of
    junk names stop any account from ever being tracked. So: `keep` is never a
    candidate, idle accounts go first, and locked ones only if nothing else is
    left — soonest-to-expire first, since those cost the least.
    """
    over = len(_accounts) - MAX_TRACKED
    if over <= 0:
        return

    candidates = [name for name in _accounts if name != keep and not _accounts[name].busy]
    idle = [name for name in candidates if _retry_after(_accounts[name], now) == 0.0]
    locked = sorted(
        (name for name in candidates if _retry_after(_accounts[name], now) > 0.0),
        key=lambda name: _accounts[name].locked_until,
    )

    for name in (idle + locked)[:over]:
        _accounts.pop(name, None)


def seconds_until_retry(username: str, now: float | None = None) -> float:
    """How long this account must wait, or 0.0 if a login may be attempted."""
    now = monotonic() if now is None else now

    with _lock:
        account = _accounts.get(_key(username))
        return 0.0 if account is None else _retry_after(account, now)


def begin_attempt(username: str, now: float | None = None) -> float:
    """
    Claim the account's attempt slot.

    Returns 0.0 when the caller may go ahead and check the password — and it
    MUST then call `finish_attempt`, or the account stays busy. A positive
    return is the number of seconds to wait: the account is either locked out or
    already has an attempt in flight.
    """
    now = monotonic() if now is None else now
    key = _key(username)

    with _lock:
        account = _accounts.get(key)

        if account is not None:
            wait = _retry_after(account, now)
            if wait > 0:
                return wait
            if account.busy:
                # Another request is hashing this account's password right now.
                # One at a time, both to close the check-then-act gap and to keep
                # concurrent PBKDF2 work bounded.
                return 1.0
        else:
            account = _Account(window_start=now)
            _accounts[key] = account
            _evict(keep=key, now=now)

        account.busy = True
        return 0.0


def finish_attempt(username: str, success: bool, now: float | None = None) -> None:
    """Release the slot and record the outcome."""
    now = monotonic() if now is None else now
    key = _key(username)

    with _lock:
        account = _accounts.get(key)
        if account is None:
            return

        account.busy = False

        if success:
            _accounts.pop(key, None)
            return

        # A fresh window if the old one has run out.
        if now - account.window_start >= WINDOW_SECONDS:
            account.failures = 0
            account.window_start = now

        account.failures += 1

        if account.failures >= MAX_ATTEMPTS:
            account.locked_until = now + LOCKOUT_SECONDS
            # Start the next window empty, so the account can lock AGAIN later.
            # Anchoring on the stored failures instead was the bug that made the
            # first lockout the only one an account could ever have.
            account.failures = 0
            account.window_start = now


def clear(username: str) -> None:
    """Forget an account entirely (a successful login, or a test)."""
    with _lock:
        _accounts.pop(_key(username), None)


def reset_all() -> None:
    """Test helper — the module keeps process-wide state on purpose."""
    with _lock:
        _accounts.clear()
