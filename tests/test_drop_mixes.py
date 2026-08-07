"""
The migration that clears out what the removed mixes feature left in the
database.

Tested through its SQL statements rather than by running them, and that is a
deliberate constraint of this repo, not laziness: the unit-test lane runs with
sqlalchemy replaced by a MagicMock, so anything that reaches for a connection
drags the whole ORM in and fails on import. `test_albumhash_collapse.py` states
the same rule about its own migration.

What actually needs guarding is the DIFFERENCE between the two statements:

  * the `mix` table is DROPPED — nothing can read it any more,
  * the scrobbles are only UNLABELLED — the play happened, and that belongs in
    the listening history; only the label saying WHERE it came from is now
    meaningless.

Turning that second one into a DELETE would silently shorten the history, and
nothing else in the suite would notice. Hence these tests.

The statements are additionally executed for real against a copy of the live
database before deploying — see the PR.
"""

import re

import pytest

from aivinnet.utils.mix_cleanup import (
    SQL_COUNT_MIXES,
    SQL_DROP_TABLE,
    SQL_FIND_TABLE,
    SQL_UNLABEL_SCROBBLES,
)


class TestScrobbleStatement:
    """The one that must never turn destructive."""

    def test_updates_and_does_not_delete(self):
        assert SQL_UNLABEL_SCROBBLES.upper().startswith("UPDATE")
        assert "DELETE" not in SQL_UNLABEL_SCROBBLES.upper()

    def test_only_clears_the_source_column(self):
        # Exactly one assignment, and it is `source`.
        assignments = re.findall(r"SET\s+(.+?)\s+WHERE", SQL_UNLABEL_SCROBBLES, re.IGNORECASE)
        assert assignments == ["source = ''"]

    def test_is_restricted_to_mix_sources(self):
        assert "WHERE source LIKE 'mix:%'" in SQL_UNLABEL_SCROBBLES

    @pytest.mark.parametrize("other_source", ["pl:22", "al:abc", "ar:def", "fo:/music", "favorite", ""])
    def test_the_filter_does_not_match_other_sources(self, other_source):
        # The LIKE pattern as a plain prefix check — the same thing sqlite does
        # for a pattern whose only wildcard is a trailing %.
        prefix = re.search(r"LIKE '(.+?)%'", SQL_UNLABEL_SCROBBLES).group(1)
        assert not other_source.startswith(prefix)

    @pytest.mark.parametrize("mix_source", ["mix:a1.deadbeef", "mix:t2.cafebabe"])
    def test_the_filter_matches_mix_sources(self, mix_source):
        prefix = re.search(r"LIKE '(.+?)%'", SQL_UNLABEL_SCROBBLES).group(1)
        assert mix_source.startswith(prefix)


class TestTableStatements:
    def test_the_drop_is_guarded(self):
        # Databases created after the feature was removed never had the table.
        assert "IF EXISTS" in SQL_DROP_TABLE.upper()

    def test_the_drop_names_only_the_mix_table(self):
        tables = re.findall(r"DROP TABLE IF EXISTS (\w+)", SQL_DROP_TABLE, re.IGNORECASE)
        assert tables == ["mix"]

    def test_the_existence_check_looks_for_a_table(self):
        assert "sqlite_master" in SQL_FIND_TABLE
        assert "'mix'" in SQL_FIND_TABLE

    def test_the_count_runs_before_the_drop_and_targets_mix(self):
        # The report number would be meaningless if it counted anything else.
        assert SQL_COUNT_MIXES.upper().startswith("SELECT COUNT(*)")
        assert re.search(r"FROM\s+mix\b", SQL_COUNT_MIXES, re.IGNORECASE)


class TestNoOtherTableIsTouched:
    @pytest.mark.parametrize("statement", [SQL_FIND_TABLE, SQL_COUNT_MIXES, SQL_DROP_TABLE, SQL_UNLABEL_SCROBBLES])
    def test_statements_only_mention_mix_and_scrobble(self, statement):
        forbidden = ["track", "album", "artist", "playlist", "favorite", "user", "page"]
        lowered = statement.lower()

        for table in forbidden:
            assert table not in lowered, f"{table!r} has no business in this migration"
