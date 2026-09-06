<template>
    <!-- Autoplay-blocked group join: any tap counts as the unlocking gesture,
         but the button is the obvious target and reads as a real invitation
         rather than an error message. -->
    <div v-if="ds.needsGesture" class="gesture-overlay" @click="ds.completeGestureJoin()">
        <div class="card rounded">
            <DevicesSvg class="glyph" />
            <h3>Join group playback?</h3>
            <p>{{ subtitle }}</p>
            <button class="accept rounded-sm" @click.stop="ds.completeGestureJoin()">Start playing here</button>
            <button class="decline" @click.stop="decline()">Not now</button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import DevicesSvg from '@/assets/icons/devices.svg'
import useDeviceSync from '@/stores/devicesync'

const ds = useDeviceSync()

const subtitle = computed(() => {
    const host = ds.devices.find(d => d.joined && d.device_id !== ds.deviceId)
    return host
        ? `${host.name} wants this device to play along in sync.`
        : 'Another device wants this one to play along in sync.'
})

/** Decline: leave the group again and drop the prompt. */
function decline() {
    ds.needsGesture = false
    void ds.leave()
}
</script>

<style lang="scss">
.gesture-overlay {
    position: fixed;
    inset: 0;
    // Above the bottom bar and any modal backdrop — this prompt is the one
    // thing that needs a tap.
    z-index: 400;
    display: grid;
    place-items: center;
    padding: 1rem;
    background-color: rgba(0, 0, 0, 0.72);

    .card {
        display: grid;
        justify-items: center;
        gap: 0.75rem;
        width: 100%;
        max-width: 22rem;
        padding: 1.75rem 1.5rem;
        text-align: center;
        background-color: var(--mem-veil, #1d1d1d);
        border: $candy-border-w solid $mem-line;

        .glyph {
            width: 2.5rem;
            height: 2.5rem;

            path {
                fill: $brand-green;
            }
        }

        h3 {
            margin: 0;
            font-size: 1.1rem;
        }

        p {
            margin: 0;
            font-size: 0.9rem;
            opacity: 0.8;
        }

        button {
            border: none;
            cursor: pointer;
            font-weight: 700;
            width: 100%;

            &.accept {
                // Big enough for a thumb — this is the whole point of the prompt.
                // min-height, not padding: a global button height rule caps it
                // at 40px otherwise (measured).
                min-height: 3rem;
                padding: 1rem 1.25rem;
                font-size: 1rem;
                background-color: $brand-green;
                color: white;
            }

            &.decline {
                padding: 0.5rem;
                margin-top: -0.25rem;
                font-weight: 500;
                font-size: 0.85rem;
                background-color: transparent;
                color: inherit;
                opacity: 0.7;
                text-decoration: underline;
            }
        }
    }
}
</style>
