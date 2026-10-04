import useSettings from "../../stores/settings";

/**
 * Unloads an audio element without loading anything else.
 *
 * ⚠️ Not `audio.src = ""`: an empty `src` resolves to the PAGE's URL. Firefox
 * then really requests `/`, gets index.html and logs "HTTP Content-Type of
 * text/html is not supported" on every track change — noise that reads like a
 * server bug. And whatever the browser, it fires `error` on the element, which
 * the player treats as "this track can't load".
 */
export function releaseSource(audio: HTMLAudioElement) {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

/** The fade still running on an element, so a new one can stop it first. */
const runningFades = new WeakMap<HTMLAudioElement, () => void>();

/**
 * Stops a fade still running on `audio` — and the release a fade-out would do
 * at its end. Returns whether there was one.
 */
export function cancelFade(audio: HTMLAudioElement) {
  const cancel = runningFades.get(audio);
  if (!cancel) return false;
  cancel();
  return true;
}

/**
 * Cross-fades the volume of an HTMLAudioElement over a specified duration.
 * @param audio - The HTMLAudioElement to cross-fade.
 * @param duration - The duration of the cross-fade in milliseconds. Default is 1000ms.
 * @param start_volume - The starting volume of the audio. Default is 0.
 * @param then_destroy - Specifies whether to destroy the audio element after the cross-fade ends. Default is false.
 */
export function crossFade({
  audio,
  duration = 1000,
  start_volume = 0,
  then_destroy = false,
}: {
  audio: HTMLAudioElement;
  duration?: number;
  start_volume?: number;
  then_destroy?: boolean;
}) {
  let interval: any = null;
  const { volume, use_crossfade } = useSettings();

  // ⚠️ One fade per element. With two elements taking turns, a quick second
  // skip hands the element still fading OUT (and due to be released at the
  // end) back to the player for the new track: the old fade kept turning it
  // down and then unloaded the track that was playing — an `error`, so
  // "Can't load" and a skip to the next track.
  cancelFade(audio);

  if (audio.muted || duration < 1000 || !use_crossfade) {
    audio.volume = volume;
    endCrossfade();
    return;
  }

  audio.volume = start_volume;
  const fadeStepTime = 100;
  const fadeSteps = duration / fadeStepTime;
  const volumeStep = volume / fadeSteps;
  const is_up = start_volume == 0;

  function incrementOrDecrement() {
    const v = audio.volume;
    const newVolume = is_up ? v + volumeStep : v - volumeStep;

    if (newVolume > 1) {
      audio.volume = 1;
      return;
    }

    if (newVolume < 0) {
      audio.volume = 0;
      return;
    }

    audio.volume = newVolume;
  }

  let counter = 0;

  runningFades.set(audio, () => {
    clearInterval(interval);
    runningFades.delete(audio);
  });

  interval = setInterval(() => {
    if (counter == fadeSteps) {
      return endCrossfade();
    }

    incrementOrDecrement();
    counter++;
  }, fadeStepTime);

  function endCrossfade() {
    clearInterval(interval);
    runningFades.delete(audio);

    if (then_destroy) {
      releaseSource(audio);
    }
  }
}
