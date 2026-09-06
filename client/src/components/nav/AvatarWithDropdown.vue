<template>
    <div ref="avatarRef" class="avatar">
        <button
            class="img circular"
            type="button"
            aria-label="Account menu"
            aria-haspopup="menu"
            :aria-expanded="isOpen"
            @click="toggle"
        >
            <!-- 44 = the chrome footprint ($bar-control). The CSS below is the
                 authority on the rendered size; this only keeps the generated
                 fallback avatar from being drawn at a smaller raster. -->
            <Avatar :name="auth.user.username || ''" :size="44" :image="auth.user.image" />
        </button>
        <Transition name="profiledrop-fade">
            <ProfileDropdown v-if="isOpen" @close="close" />
        </Transition>
    </div>
</template>

<script setup lang="ts">
import { onClickOutside } from '@vueuse/core'
import { ref } from 'vue'

import useAuth from '@/stores/auth';
const auth = useAuth()

import Avatar from '../shared/Avatar.vue';
import ProfileDropdown from './ProfileDropdown.vue';

const isOpen = ref(false)
const avatarRef = ref<HTMLElement>()

function toggle() {
    isOpen.value = !isOpen.value
}

function close() {
    isOpen.value = false
}

// Tap/click anywhere outside the avatar closes the dropdown.
// (Pure CSS :hover left the menu stuck open on touch devices, where it
// overlapped the settings modal and blocked it from closing.)
onClickOutside(avatarRef, () => {
    isOpen.value = false
})
</script>

<style lang="scss">
.avatar {
    position: relative;
    aspect-ratio: 1;
    cursor: pointer;
    transition: background-color 0.2s ease-out, color 0.2s ease-out;

    display: grid;
    place-items: center;
    border-radius: 40%;

    // The quiet role, at the chrome footprint: the artwork covers the whole
    // control, so there is no plate to raise — but hover and press must be the
    // same gesture as the toggle standing next to it. Hand-written, this was a
    // 36px box with `scale(1.05)` on hover and no press answer at all, in a row
    // where every neighbour used 1.06 / 0.98.
    //
    // It is a <button> because it opens a menu: as a <div> it was unreachable
    // by keyboard, announced nothing, and could not carry `aria-expanded`.
    .img {
        @include btn-quiet($size: $bar-control, $radius: 50%);

        // White circle with the candy border; the image/generated avatar
        // fills it (border-box, so the visible artwork sits inside the ring).
        // The 100% overrides the role's 1.5rem glyph size — this control's
        // "glyph" is a portrait that fills its box, not an icon inside it.
        img,
        svg {
            width: 100%;
            height: 100%;
            border: $candy-border;
            border-radius: 50%;
            // The "white circle" behind the avatar art — keep it static light so
            // the ring stays a light disc in dark (pairs with the paper border).
            background-color: $mem-panel-static;
        }
    }

    .profiledrop-fade-enter-active,
    .profiledrop-fade-leave-active {
        transition: opacity 0.2s ease-out, transform 0.2s ease-out;
    }

    .profiledrop-fade-enter-from,
    .profiledrop-fade-leave-to {
        opacity: 0;
        transform: translateY(0.5rem);
    }

    @include allPhones {
        height: unset;
        background-color: transparent;
    }
}
</style>
