import { defineStore } from "pinia";

import useLyricsPlugin from "./plugins/lyrics";
import useQueue from "./queue";
import useSettings from "./settings";

import { LyricsLine } from "@/interfaces";
import { checkExists, getLyrics } from "@/requests/lyrics";
import { Routes, router } from "@/router";

// a custom error class called HasNoSyncedLyricsError
class HasUnSyncedLyricsError extends Error {
  constructor() {
    super("Lyrics are not synced");
    this.name = "HasNoSyncedLyricsError";
  }
}

export default defineStore("lyrics", {
  state: () => ({
    lyrics: <LyricsLine[]>[],
    currentLine: -1,
    ticking: false,
    // Handle of the pending "advance to the next line" timer, so that anything
    // which sets the line itself can cancel it — see setCurrentLine.
    nextLineTimer: <ReturnType<typeof setTimeout> | null>null,
    currentTrack: "",
    exists: false,
    synced: true,
    copyright: "",
    user_scrolled: false,
  }),
  actions: {
    async getLyrics(force = false) {
      const queue = useQueue();
      const track = queue.currenttrack;

      if (!force && this.currentTrack === track.trackhash) {
        this.sync();
        return;
      }

      // Through setCurrentLine, not by hand: a timer armed on the PREVIOUS
      // track would otherwise survive the change and advance blindly into the
      // lyrics that are about to be replaced.
      this.setCurrentLine(-1, false);
      this.copyright = "";
      this.synced = true;

      getLyrics(track.filepath, track.trackhash)
        .then((data) => {
          this.currentTrack = track.trackhash;

          if (data.error) {
            throw new Error(data.error);
          }

          this.synced = data.synced;
          this.lyrics = data.lyrics;
          this.copyright = data.copyright;
          this.exists = true;

          if (this.lyrics.length && !this.synced) {
            throw new HasUnSyncedLyricsError();
          }
        })
        .then(async () => {
          // Opening the view mid-track has to MARK the line it lands on, not
          // just scroll to it: the mark used to stay at -1 until the player's
          // next tick corrected it, so the page appeared with nothing playing.
          const line = this.calculateCurrentLine();
          this.setCurrentLine(line, false);

          if (line == -1) {
            return this.scrollToContainerTop();
          }

          this.scrollToCurrentLine();
        })
        .catch((e) => {
          const settings = useSettings();
          const plugin = useLyricsPlugin();

          // catch HasUnSyncedLyricsError instance
          if (e instanceof HasUnSyncedLyricsError) {
            if (!settings.lyrics_plugin_settings.overide_unsynced) return;
            plugin.searchLyrics();
          }

          this.exists = false;
          this.lyrics = <LyricsLine[]>[];
          this.copyright = "";

          if (settings.lyrics_plugin_settings.auto_download) {
            plugin.searchLyrics();
          }
        });
    },
    scrollToContainerTop() {
      const container = document.getElementById("lyricscontent");

      if (container) {
        container.scroll({
          top: 0,
          behavior: "smooth",
        });
      }
    },
    checkExists(filepath: string, trackhash: string) {
      if (router.currentRoute.value.name !== Routes.Lyrics) {
        this.lyrics = <LyricsLine[]>[];
      }

      checkExists(filepath, trackhash).then((data) => {
        this.exists = data.exists;
      });
    },
    /**
     * Advance to the next line WHEN IT STARTS.
     *
     * This used to fire 300ms early — a head start for the smooth scroll, paid
     * for by the mark itself: the highlighted line ran ahead of the music, and
     * once that line carries a scrubber (#486) the head start reads as a line
     * that lights up empty before it is sung. Scrolling arrives 300ms later
     * now; being on the wrong line is the louder error of the two.
     */
    /**
     * ⚠️ Cancels a pending advance FIRST. `ticking` is meant to stop a second
     * timer from being set, but it is cleared in more places than the timer is
     * (a seek, a correction, a track change) — so a call can land while one is
     * still in flight. Overwriting the handle would leave the old one running,
     * and it advances the line BLIND: one extra `++`, and the highlight is a
     * whole line ahead of the music for good. Measured: the mark left the line
     * ~290ms before it was sung, which reads exactly like a timer firing early
     * — the reason this was first mistaken for the 300ms head start below.
     */
    clearNextLineTimer() {
      // `ticking` means "an advance is pending", so it goes with the timer. It
      // used to be able to stay true without one — the callback only clears it
      // while playing, so pausing inside the arming window left it stuck, and
      // `updateLyricsPosition` never armed another timer for the rest of the
      // track.
      this.ticking = false;

      if (this.nextLineTimer === null) return;
      clearTimeout(this.nextLineTimer);
      this.nextLineTimer = null;
    },
    setNextLineTimer(duration: number) {
      this.clearNextLineTimer();
      this.ticking = true;
      this.nextLineTimer = setTimeout(() => {
        this.nextLineTimer = null;
        if (useQueue().playing) {
          this.currentLine++;
          this.ticking = false;
          this.scrollToCurrentLine();
        }
      }, duration);
    },
    /**
     * ⚠️ Also cancels a pending advance — this is the deliberate answer to
     * "which line is it", so a timer that was going to answer it differently
     * has to go. `setTimeout` only promises "not earlier": one can still be in
     * flight when the player's own `diff < 0` correction or a seek lands, and
     * it would then add a second advance on top of the right answer.
     */
    setCurrentLine(line: number, scroll = true) {
      this.clearNextLineTimer();
      this.currentLine = line;
      this.ticking = false;

      if (!scroll) return;
      setTimeout(() => {
        this.scrollToCurrentLine();
      }, 400);
    },
    scrollToCurrentLine(line: number = -1) {
      let lineToScroll = this.currentLine;

      if (line >= 0) {
        lineToScroll = line;
      }

      const third = window.innerHeight / 3;
      const two_thirds = third * 2;

      const elem = document.getElementById(`lyricsline-${lineToScroll}`);
      if (!elem) return;

      const { y } = elem.getBoundingClientRect();

      if (this.user_scrolled && (y < third || y > two_thirds)) {
        return;
      }

      this.setUserScrolled(false);
      elem.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "start",
      });
    },
    /**
     * The line being sung right now: the LAST one that has already started.
     * `-1` while playback is still before the first line.
     *
     * It used to look for the line NEAREST to the clock and subtract one, which
     * is a different question and answers it wrong for half of every interval:
     * at 34.0s between lines at 33.0s and 36.1s the nearest is the 33s line, so
     * minus one pointed at the line before the one being sung. Callers papered
     * over it by adding one back (player.ts) or not (sync) — so the same clock
     * produced two different answers depending on the path in.
     */
    calculateCurrentLine(atMillis?: number) {
      if (!this.synced || !this.lyrics || !this.lyrics.length) return -1;

      // Rounded, because callers reach this through seconds: `queue.seek` takes
      // `line.time / 1000` and the trip back lands just BELOW the integer for
      // about 1 % of centisecond stamps (2010ms and 4020ms among them). Clicking
      // such a line would then mark the line above it — and while paused nothing
      // ever corrects that.
      const millis = Math.round(atMillis ?? useQueue().duration.current * 1000);

      let line = -1;
      for (let i = 0; i < this.lyrics.length; i++) {
        if (this.lyrics[i].time > millis) break;
        line = i;
      }

      return line;
    },
    sync() {
      const line = this.calculateCurrentLine();
      this.setCurrentLine(line);
    },
    setLyrics(lyrics: LyricsLine[]) {
      this.lyrics = lyrics;
      this.synced = true;
      this.exists = true;
      this.currentTrack = useQueue().currenttrackhash;

      this.setCurrentLine(this.currentLine);
    },
    setUserScrolled(value: boolean) {
      this.user_scrolled = value;
    },
  },
  getters: {
    nextLineTime(): number {
      if (!this.lyrics) return 0;
      if (this.lyrics.length > this.currentLine + 1) {
        return this.lyrics[this.currentLine + 1].time;
      }

      return 0;
    },
  },
});
