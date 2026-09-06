<template>
    <button class="devices-btn" :class="{ 'ds-joined': ds.joined }" :title="title" @click="modal.showDevicesModal()">
        <DevicesSvg />
    </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import DevicesSvg from '@/assets/icons/devices.svg'
import useDeviceSync from '@/stores/devicesync'
import useModal from '@/stores/modal'

const ds = useDeviceSync()
const modal = useModal()

const title = computed(() => (ds.joined ? 'Devices — group playback active' : 'Devices'))
</script>

<style lang="scss">
// THE WHOLE ANATOMY LIVES HERE — footprint, rest state and joined state.
//
// It used to live in the three hosts instead, and they had drifted into three
// different buttons: BottomBar/Right.vue (desktop) plated it with `btn-action`,
// BottomBar/Left.vue (phone bar) stripped it back to `border: none;
// background: transparent`, and NowPlaying/Header.vue set a bare 44px box with
// no role at all. So on a phone — the one device where group playback is the
// point — this was the only control in a row of plated ones with no surface,
// reported as "sieht nicht wie ein Button aus".
//
// A shared component takes its own role (see CLAUDE.md); patching it from the
// outside is the drift #90 exists to collect.
.devices-btn {
    // `$bar-control`, because every host is chrome: the player bar on both
    // desktop and phone, and the Now Playing header, which sizes to the player.
    @include btn-action($size: $bar-control);
    // The bar's glyph colour, like every control standing next to it (the
    // transport row and the aux group both restate this). It is NOT the role's
    // default `$mem-content-text`: the two agree in the light theme and differ
    // in the dark one — #ffffff against the row's #f4f2ed — so inheriting the
    // default would leave this one glyph brighter than its neighbours. The
    // phone bar used to state it here as `.bar-devices:not(.ds-joined)`, and
    // that line goes away with the rest of the host patch.
    color: $candy-text;

    // Joined = the app's other persistent on-state, so it wears the same box
    // shuffle and repeat do — accent fill, sprinkle, ink frame, offset shadow —
    // in the brand green rather than yellow. Yellow is taken: it means
    // "playing" (see styling.md).
    //
    // Unlike shuffle and repeat this does NOT pop on switching on, and that is
    // a property of the pairing rather than something to fix here: those sit on
    // `btn-quiet`, which carries no `btn-pop`, so the toggle's animation is the
    // element's first. Here the rest state is `btn-action`, which already
    // declares the identical `animation` shorthand — re-declaring the same
    // value does not restart an animation. Joining is a deliberate act with a
    // modal in front of it, so the fill switching is feedback enough.
    //
    // The offset shadow is the part that was missing. It arrived by accident
    // from the global button base until #244, so `candy-box()` alone LOOKED
    // complete while leaving the loudest filled control in the app the one
    // sitting flat on the bar — the exact hole `btn-toggle-on` was written to
    // close for shuffle and repeat.
    //
    // Its own hover block comes with the role too. Without it `.ds-joined`
    // (0,2,0, declared later) would beat the rest state's `:hover` and the
    // pointer would say nothing on the one control that is switched ON.
    &.ds-joined {
        @include btn-toggle-on($fill: $brand-green, $glyph-color: $mem-panel-static);
    }
}
</style>
