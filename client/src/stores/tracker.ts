import { ref } from "vue";
import { defineStore } from "pinia";

import useQueue from "./queue";
import useDeviceSync from "./devicesync";
import useHome from "./home";
import { audioSource } from "./player";
import { FromOptions } from "@/enums";
import useTracklist, { From } from "@/stores/queue/tracklist";
import { celebrateMilestone, type Milestone } from "@/utils/milestones";
import { getOrCreateDeviceId } from "@/utils/deviceSync/deviceId";

let enableCall = true;
let throttleTimeout: number = 1000;

function throttle(
  callback: CallableFunction,
  interval: number = throttleTimeout
) {
  return function (...args: any[]) {
    if (!enableCall) return;
    enableCall = false;

    // @ts-ignore
    callback.apply(this, args);
    setTimeout(() => (enableCall = true), interval);
  };
}

function getSource(source: From) {
  switch (source.type) {
    case FromOptions.album:
      return `al:${source.albumhash}`;
    case FromOptions.artist:
      return `ar:${source.artisthash}`;
    case FromOptions.folder:
      return `fo:${source.path}`;
    case FromOptions.playlist:
      return `pl:${source.id}`;
    case FromOptions.playlistFolder:
      return `pf:${source.id}`;
    case FromOptions.search:
      return `q:${source.query}`;
    case FromOptions.favorite:
      return `favorite`;
    default:
      return "";
  }
}

// The server drops shorter plays as skips and answers 400 — don't send them
// at all. The same rule as `lib/play_floor.py` (#882): 5 s, but a track that is
// itself shorter counts once it ran to the end. Play time is added once a
// second here, so a track that ran through reports up to 2 s less than its
// length. Unknown length (0): the plain 5 s.
export const MIN_LOGGED_SECONDS = 5;
const TICK_TOLERANCE_SECONDS = 2;

export function minLoggedSeconds(trackSeconds: number): number {
  if (!trackSeconds) return MIN_LOGGED_SECONDS;
  return Math.trunc(Math.min(MIN_LOGGED_SECONDS, Math.max(1, trackSeconds - TICK_TOLERANCE_SECONDS)));
}

/** What the log worker passes back (public/workers/logtrack.js). */
type LogAnswer = { logged?: boolean; milestone?: Milestone | null };

export function sendLogData(
  trackhash: string,
  duration: number,
  from: From,
  timestamp: number,
  trackSeconds = 0
) {
  const seconds = Math.round(duration / 1000);
  if (seconds < minLoggedSeconds(trackSeconds)) return;

  if (window.Worker) {
    const worker = new Worker("/workers/logtrack.js");
    // The worker answers once the server has taken the play: `logged`, and a
    // milestone (#545) when this play was one.
    worker.onmessage = (e: MessageEvent<LogAnswer>) => {
      const { logged, milestone } = e.data;
      // The server has already dropped the song from its "Almost complete" card
      // (almost_complete_played), but Home fetches only when it opens: mirror it
      // here so the card goes at once. Only after the server took the play: one
      // it refused stays missing there, and the card would come back.
      if (logged) useHome().notePlayed(trackhash);
      if (milestone) celebrateMilestone(milestone);
    };

    const source = getSource(from);
    // #541: the same id the device-sync registry knows this browser by. In a group only
    // the scrobble leader gets here, so the play is attributed to the leader's device.
    const deviceId = getOrCreateDeviceId();
    worker.postMessage({ trackhash, duration: seconds, source, timestamp, deviceId });
  }
}

export default defineStore(
  "playTracker",
  () => {
    const duration = ref(0);
    const trackhash = ref("");
    // The track's own length (s): a short one counts once it ran through (#882).
    const trackSeconds = ref(0);
    const timestamp = ref(0);

    const key = ref(0);
    const prevKey = ref(0);

    // @ts-ignore
    const from = ref({
      type: null,
      path: "",
      name: "",
    } as From);

    let prev_date = 0;
    let can_submit = true;

    // player.ts re-assigns on every track start and cannot remove the previous
    // listener, so without this each play added one more for the whole session.
    const wiredElements = new WeakSet<HTMLAudioElement>();

    const queue = useQueue();

    function resetData() {
      from.value = useTracklist().from;
      duration.value = 0;
      trackhash.value = queue.currenttrack.trackhash;
      trackSeconds.value = queue.currenttrack.duration || 0;
      prev_date = Date.now();
      timestamp.value = 0;
    }

    function updateDuration() {
      const now = Date.now();
      const diff = now - prev_date;

      if (diff > throttleTimeout * 1.75) {
        return (prev_date = now);
      }

      duration.value += diff;
      prev_date = now;
      timestamp.value = Math.floor(now / 1000);
    }

    function lockSubmit() {
      can_submit = false;

      setTimeout(() => {
        can_submit = true;
      }, 1000);
    }

    function submitData() {
      // Group mode: exactly one device (the scrobble leader) submits play data.
      // Non-leaders DISCARD instead of defer: reset the accumulation like a
      // real submit would, otherwise duration keeps growing against a stale
      // trackhash and a later leadership change / solo fallback would submit
      // one grossly inflated bogus scrobble.
      const ds = useDeviceSync();
      if (ds.joined && !ds.isScrobbleLeader) {
        resetData();
        prevKey.value = key.value;
        return;
      }

      if (!can_submit) return;
      lockSubmit();
      sendLogData(trackhash.value, duration.value, from.value, timestamp.value, trackSeconds.value);
      resetData();
      prevKey.value = key.value;
    }

    // Track the queue's current track from here on — hash, length AND source —
    // with nothing pending: no earlier play left for the key-change flush to send.
    function adoptCurrentTrack() {
      resetData();
      prevKey.value = key.value;
    }

    function reassignEventListener() {
      // A fresh session (nothing persisted) with a queue already there. Taking
      // only the hash left `from` at {type: null}, and that play went out with
      // source "".
      if (trackhash.value == "" && queue.currenttrackhash) adoptCurrentTrack();

      const element = audioSource.playingSource;
      if (wiredElements.has(element)) return;
      wiredElements.add(element);

      element.addEventListener(
        "timeupdate",
        throttle(() => {
          if (audioSource.playingSource.paused) {
            prev_date = 0;
          }

          if (
            key.value !== prevKey.value &&
            trackhash.value !== "" &&
            duration.value > 1000 &&
            can_submit
          ) {
            submitData();
          }

          updateDuration();
        })
      );
    }

    function changeKey() {
      prevKey.value = key.value;
      key.value = Math.random();

      // A new track starts. The timeupdate flush sends what was played before
      // it — but when nothing was (a fresh tracker, or `ended` just submitted
      // and reset), there is no previous play: it would send the NEW track ~2 s
      // in (fresh: with source ""), or the finished one a second time, timed
      // with the new track's first seconds. Above a short track's floor (#882)
      // the server took both. So start tracking the new track right here.
      if (duration.value === 0) adoptCurrentTrack();
    }

    return {
      trackhash,
      trackSeconds,
      timestamp,
      duration,
      from,
      key,
      prevKey,
      submitData,
      reassignEventListener,
      changeKey,
      resetData,
    };
  },
  {
    persist: true,
  }
);
