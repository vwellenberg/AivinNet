<template>
  <div class="lost-in-subspace">
    <div class="lost-plate">
      <!-- Four of the style's basic shapes drift away once on arrival, like the
           shrug of an empty state (#143). Decoration only: aria-hidden. -->
      <span class="lost-shapes" aria-hidden="true">
        <i class="zig"></i>
        <i class="tri"></i>
        <i class="dot"></i>
        <i class="sq"></i>
      </span>
      <p class="lost-code">404</p>
      <h1 class="lost-title">Lost in Subspace</h1>
      <p class="lost-text">This signal doesn't come through.</p>
      <div class="lost-actions">
        <button class="btn-action btn-action-label lost-btn" :disabled="surprising" @click="surprise">
          <ShuffleSvg />
          Surprise me
        </button>
        <RouterLink class="lost-home" :to="{ name: Routes.Home }">
          <HomeSvg />
          Back to Home
        </RouterLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import { Routes } from '@/router'
import { getSurpriseAlbum } from '@/requests/home'
import { playFromAlbumCard } from '@/helpers/usePlayFrom'
import ShuffleSvg from '@/assets/icons/shuffle.svg'
import HomeSvg from '@/assets/icons/home.svg'

// "Surprise me" as on Home: one random album from the whole library, played
// from the top. The server picks (RAM only).
const surprising = ref(false)
async function surprise() {
    surprising.value = true
    try {
        const albumhash = await getSurpriseAlbum()
        if (albumhash) await playFromAlbumCard(albumhash, '')
    } finally {
        surprising.value = false
    }
}
</script>

<style lang="scss">
// The page's own motion, once on arrival (no `infinite`: a lost signal does not
// keep flickering while one reads it). Reduced motion is handled globally by
// Global/motion-policy.scss.
@keyframes lost-arrive {
    0% {
        opacity: 0;
        transform: translateY(8px);
    }

    100% {
        opacity: 1;
        transform: none;
    }
}

@keyframes lost-drift {
    0% {
        transform: translate(var(--sx), var(--sy)) rotate(160deg);
    }

    100% {
        transform: none;
    }
}

.lost-in-subspace {
    display: grid;
    place-items: center;
    min-height: 60vh;
    padding: 2.5rem 1rem;
}

// The text sits on a plate (`--mem-veil`) like every empty state (NoItems).
.lost-plate {
    position: relative;
    max-width: 25rem;
    padding: 1.5rem 2rem;
    text-align: center;
    background-color: var(--mem-veil);
    border: $candy-border;
    border-radius: $candy-radius;
    @include candy-shadow;
    color: $mem-content-text;
    animation: lost-arrive $motion-settle $motion-curve-back;

    p {
        margin: 0;
        word-break: break-word;
    }

    .lost-code {
        font-size: 0.85rem;
        font-weight: 700;
        color: $mem-content-faint;
        letter-spacing: 0.15em;
    }

    .lost-title {
        margin: 0.5rem 0;
        font-size: 1.5rem;
        font-weight: 700;
    }

    .lost-text {
        color: $mem-content-muted;
    }

    .lost-shapes {
        position: absolute;
        inset: 0;
        pointer-events: none;

        i {
            position: absolute;
            display: block;
            animation: lost-drift ($motion-settle * 1.4) $motion-curve-back;
        }

        // Sit on the top and bottom edge of the plate, half over it.
        .zig {
            left: 1.5rem;
            top: -6px;
            width: 34px;
            height: 12px;
            --sx: -16px;
            --sy: -14px;
            background: repeating-linear-gradient(-55deg, $mem-coral 0 4px, transparent 4px 9px);
        }

        .tri {
            right: 1.5rem;
            top: -10px;
            width: 0;
            height: 0;
            --sx: 14px;
            --sy: -16px;
            border-left: 11px solid transparent;
            border-right: 11px solid transparent;
            border-bottom: 19px solid $mem-blue;
        }

        .dot {
            left: 1.5rem;
            bottom: -9px;
            width: 17px;
            height: 17px;
            --sx: -13px;
            --sy: 15px;
            border-radius: $candy-radius-pill;
            background: $mem-teal;
        }

        .sq {
            right: 1.5rem;
            bottom: -8px;
            width: 15px;
            height: 15px;
            --sx: 15px;
            --sy: 13px;
            background: $mem-pink;
        }
    }

    .lost-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 0.75rem;
        margin-top: 1.25rem;
    }

    // "Surprise me" carries a label, so it takes its width from the content
    // (the same reset as the Home row's button).
    .lost-btn {
        width: auto;
        padding: 0 0.9rem;
        font-size: 0.85rem;
        font-weight: 700;
        gap: 0.4rem;

        svg {
            width: 1.1rem;
            height: 1.1rem;
        }
    }

    .lost-home {
        @include btn-primary($w: auto);
        font-size: 0.85rem;
        font-weight: 700;
        text-decoration: none;
        color: inherit;
    }
}
</style>
