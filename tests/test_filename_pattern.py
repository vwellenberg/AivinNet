"""What a track's file is called after its tags (#144) — the pure half.

No filesystem here: the planner is handed the names already taken in a folder.
The cases are the ones that decide whether a rename is safe, not just pretty:
nothing may be overwritten, nothing may become a hidden dot-file (the indexer
would drop it), and an album that is only renumbered must still be renameable.
"""

import os

from aivinnet.lib import filename_pattern as fp


class TestCleanTitle:
    def test_separators_become_hyphens(self):
        assert fp.clean_title("AC/DC") == "AC-DC"
        assert fp.clean_title("Either\\Or") == "Either-Or"

    def test_a_colon_before_a_space_reads_as_a_dash(self):
        assert fp.clean_title("Star Trek: The Motion Picture") == "Star Trek - The Motion Picture"
        assert fp.clean_title("5:15") == "515"

    def test_characters_other_systems_reject_are_dropped(self):
        assert fp.clean_title('Why? "Because" <no> | *really*') == "Why Because no really"
        assert fp.clean_title("Tab\there\nnewline") == "Tab here newline"

    def test_a_title_never_turns_into_a_hidden_file(self):
        # The indexer skips dot-files: "...Und Null Sekunden" vanished that way.
        assert fp.clean_title("...Und Null Sekunden") == "Und Null Sekunden"
        assert fp.clean_title(".hidden") == "hidden"

    def test_trailing_dots_and_spaces_go(self):
        assert fp.clean_title("The End...  ") == "The End"

    def test_nothing_usable_is_empty(self):
        assert fp.clean_title("???") == ""
        assert fp.clean_title("   ") == ""


class TestTargetName:
    def test_the_pattern(self):
        assert fp.target_name("Game Lost", 3, 1, ".mp3") == "03 - Game Lost.mp3"

    def test_the_suffix_is_kept_as_it_is(self):
        assert fp.target_name("Song", 1, 1, ".FLAC") == "01 - Song.FLAC"

    def test_a_long_album_gets_wider_numbers_so_it_sorts(self):
        width = fp.number_width([1, 2, 150])
        assert width == 3
        assert fp.target_name("Song", 7, 1, ".mp3", width=width) == "007 - Song.mp3"
        assert fp.number_width([1, 2, 94]) == 2

    def test_only_a_multi_disc_album_carries_the_disc(self):
        assert fp.target_name("Song", 3, 2, ".mp3", multi_disc=True) == "2-03 - Song.mp3"
        assert fp.target_name("Song", 3, 2, ".mp3", multi_disc=False) == "03 - Song.mp3"

    def test_no_number_means_just_the_title(self):
        assert fp.target_name("Song", 0, 1, ".mp3") == "Song.mp3"
        assert fp.target_name("Song", None, None, ".mp3") == "Song.mp3"

    def test_no_usable_title_means_no_name(self):
        assert fp.target_name("", 3, 1, ".mp3") is None
        assert fp.target_name(None, 3, 1, ".mp3") is None
        assert fp.target_name("???", 3, 1, ".mp3") is None

    def test_a_windows_device_name_is_defused(self):
        assert fp.target_name("CON", 0, 1, ".mp3") == "CON_.mp3"
        # With a number in front it is an ordinary name.
        assert fp.target_name("CON", 1, 1, ".mp3") == "01 - CON.mp3"

    def test_the_limit_is_in_bytes_not_characters(self):
        name = fp.target_name("ä" * 400, 1, 1, ".mp3")
        assert name is not None
        assert len(name.encode("utf-8")) <= fp.MAX_NAME_BYTES
        # Cut on a character boundary, never half a UTF-8 sequence.
        name.encode("utf-8").decode("utf-8")
        assert name.endswith(".mp3")


D = "/music/Album"


def statuses(planned):
    return {p.filepath.rsplit("/", 1)[1]: (p.status, p.target) for p in planned}


class TestPlan:
    def test_a_free_name_is_a_rename(self):
        result = fp.plan([(f"{D}/01.mp3", "01 - A.mp3")], {D: {"01.mp3"}})
        assert statuses(result) == {"01.mp3": (fp.RENAME, "01 - A.mp3")}
        assert result[0].target_path == os.path.join(D, "01 - A.mp3")

    def test_a_name_that_is_already_right_is_left_alone(self):
        result = fp.plan([(f"{D}/01 - A.mp3", "01 - A.mp3")], {D: {"01 - A.mp3"}})
        assert result[0].status == fp.UNCHANGED

    def test_nothing_is_ever_overwritten(self):
        result = fp.plan([(f"{D}/x.mp3", "01 - A.mp3")], {D: {"x.mp3", "01 - A.mp3"}})
        assert result[0].status == fp.CONFLICT

    def test_two_files_wanting_one_name_both_stay(self):
        result = fp.plan(
            [(f"{D}/a.mp3", "01 - Same.mp3"), (f"{D}/b.mp3", "01 - Same.mp3")],
            {D: {"a.mp3", "b.mp3"}},
        )
        assert {p.status for p in result} == {fp.CONFLICT}

    def test_a_renumbered_album_frees_its_own_names(self):
        # "02 - B" -> "03 - B" needs the current "03 - B" to move on to "04 - B"
        # first. The input order is the unhelpful one on purpose.
        result = fp.plan(
            [(f"{D}/02 - B.mp3", "03 - B.mp3"), (f"{D}/03 - B.mp3", "04 - B.mp3")],
            {D: {"02 - B.mp3", "03 - B.mp3"}},
        )
        assert [p.status for p in result] == [fp.RENAME, fp.RENAME]

    def test_a_swap_is_refused_rather_than_done_through_a_temporary_name(self):
        result = fp.plan(
            [(f"{D}/A.mp3", "B.mp3"), (f"{D}/B.mp3", "A.mp3")],
            {D: {"A.mp3", "B.mp3"}},
        )
        assert [p.status for p in result] == [fp.CONFLICT, fp.CONFLICT]

    def test_a_file_that_stays_blocks_its_name(self):
        # "keep.mp3" is not part of the batch; its name is not available.
        result = fp.plan([(f"{D}/x.mp3", "keep.mp3")], {D: {"x.mp3", "keep.mp3"}})
        assert result[0].status == fp.CONFLICT

    def test_names_that_differ_only_in_case_collide(self):
        # Two files on ext4, one file on a USB stick or a Mac.
        both = fp.plan(
            [(f"{D}/a.mp3", "01 - Intro.mp3"), (f"{D}/b.mp3", "01 - intro.mp3")],
            {D: {"a.mp3", "b.mp3"}},
        )
        assert {p.status for p in both} == {fp.CONFLICT}

        onto = fp.plan([(f"{D}/x.mp3", "01 - Intro.mp3")], {D: {"x.mp3", "01 - INTRO.mp3"}})
        assert onto[0].status == fp.CONFLICT

    def test_a_case_only_rename_is_allowed(self):
        result = fp.plan([(f"{D}/track.mp3", "Track.mp3")], {D: {"track.mp3"}})
        assert result[0].status == fp.RENAME

    def test_no_name_is_reported_not_guessed(self):
        result = fp.plan([(f"{D}/x.mp3", None)], {D: {"x.mp3"}})
        assert result[0].status == fp.NO_NAME
        assert result[0].target_path is None

    def test_the_same_name_in_two_folders_is_no_conflict(self):
        result = fp.plan(
            [("/m/A/x.mp3", "01 - A.mp3"), ("/m/B/x.mp3", "01 - A.mp3")],
            {"/m/A": {"x.mp3"}, "/m/B": {"x.mp3"}},
        )
        assert [p.status for p in result] == [fp.RENAME, fp.RENAME]

    def test_results_come_back_in_the_order_asked(self):
        wanted = [(f"{D}/{n}.mp3", f"0{n} - T.mp3") for n in (3, 1, 2)]
        result = fp.plan(wanted, {D: {"1.mp3", "2.mp3", "3.mp3"}})
        assert [p.filepath for p in result] == [path for path, _ in wanted]
