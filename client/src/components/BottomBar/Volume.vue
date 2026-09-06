<template>
    <div class="volume-control" @wheel.passive="handleMouseWheel">
        <!-- One glyph for both silent states (muted, or volume at 0) is right
             now that the button toggles AUDIBILITY rather than the mute flag:
             from here they are the same thing, and one tap gets sound back
             either way. The title says so. -->
        <button
            class="speaker-icon"
            :class="{ silent: settings.is_silent }"
            :title="settings.is_silent ? 'Unmute' : 'Mute'"
            @click="settings.toggleMute"
        >
            <VolumeMuteSvg v-if="settings.is_silent" />
            <VolumeMidSvg v-else-if="settings.volume > 0.5" />
            <VolumeLowSvg v-else />
        </button>
        <input
            class="volume-slider"
            type="range"
            name="volume"
            max="1"
            min="0"
            step="0.01"
            :value="settings.mute ? 0 : settings.volume"
            @input="changeVolume"
            :style="{
                backgroundSize: `${(settings.mute ? 0 : settings.volume) * 100}% 100%`,
            }"
        />
    </div>
</template>

<script setup lang="ts">
import VolumeLowSvg from '@/assets/icons/volume-low.svg'
import VolumeMidSvg from '@/assets/icons/volume-mid.svg'
import VolumeMuteSvg from '@/assets/icons/volume-mute.svg'
import useSettingsStore from '@/stores/settings'

const settings = useSettingsStore()

const changeVolume = (event: Event) => {
    const target = event.target as HTMLInputElement
    if (settings.mute) settings.toggleMute()
    settings.setVolume(parseFloat(target.value))
}

const handleMouseWheel = (event: WheelEvent) => {
    const delta = event.deltaY / 1000
    let newVolume = settings.volume - delta / 3

    if (newVolume > 1) newVolume = 1
    if (newVolume < 0) newVolume = 0

    settings.setVolume(newVolume)
}
</script>

<style lang="scss">
.b-bar .right-group .volume-control {
    display: flex;
    align-items: center;
    // Tighter than the bar's gap on purpose: the slider is the speaker's other
    // half, not a third neighbour. Same reasoning the token carries.
    gap: $bar-gap-tight;

    // Mute: the same plated role and the same footprint as every other bar
    // control. It used to be the odd one out at 2.25rem — the smallest button
    // in a bar whose next-smallest was 3rem.
    .speaker-icon {
        @include btn-action($size: $bar-control);
        // The speaker glyph is currentColor; drive it from the adaptive text
        // colour so it reads on the bar in both themes.
        color: $candy-text;

        // Silence is a STATE, and it wears the state box — the same yellow an
        // active shuffle or repeat wears. A crossed-out speaker in the quiet
        // role differs from a plain one by a few strokes; on a phone held in
        // landscape (>900px, so it gets this bar) that difference was missed
        // entirely, and a muted player just looked like a broken one. See #335.
        &.silent {
            @include btn-toggle-on;
        }
    }

    // Horizontal volume slider. Track pill, 2px ink border and the white
    // bordered thumb all come from the global range styling (ProgressBar.scss).
    // Only the played-volume fill is painted here — a flat teal band clipped by
    // the inline background-size from the current volume level.
    .volume-slider {
        width: 6rem;
        min-width: 4rem;
        margin-right: 0; // neutralise the global range's 15px right margin
        background-image: linear-gradient($mem-teal, $mem-teal);
        background-repeat: no-repeat;
        // background-size set inline from the current volume.
    }

    @include allPhones {
        .volume-slider {
            display: none;
        }
    }
}
</style>
