<template>
  <router-link class="swing-logo" :to="{ name: 'Home' }" title="Home">
    <div class="logo-orbit-wrapper">
      <img src="@/assets/icons/logos/logo-subspaceradio.png" alt="AivinNet" class="logo-img" />
      <span class="logo-orbit" aria-hidden="true">
        <i class="logo-orbit-spin"><i class="logo-moon"></i></i>
      </span>
    </div>
  </router-link>
</template>

<script setup lang="ts">
</script>

<style lang="scss">
.swing-logo {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.6rem;
  width: 100%;
  height: 100%;
  // The hover orbit reaches 5px past the planet — never clip it.
  overflow: visible;
}

// The one piece of chrome that is NOT a tile: the pixel planet stands on its
// own, no box around it.
//
// It used to sit on an ink fill, which was the only place in the app where ink
// was used as a SURFACE rather than as a line — and it read wrong in both
// themes: a hard black hole next to the white/blush chrome in light, and
// practically invisible in dark, where ink (#17171A) lands on the panel colour
// (#141416) and only the border kept the tile on screen (#318).
//
// Dropping the box is not just a subtraction: border + padding used to eat a
// third of the footprint, so the artwork goes from ~31px to the full 48px and
// the pixel art is finally legible.
.logo-orbit-wrapper {
  position: relative;
  // One chrome footprint, like every other control in the top bar it heads.
  // Its LOOK stays deliberately outside the roles (no plate, no shadow, the
  // orbit below) — only the box follows.
  width: $bar-control;
  height: $bar-control;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  // No candy-box/candy-raised here on purpose: an offset shadow needs a surface
  // to fall off, and there is none. The tilt below is the whole transition — on
  // the one curve in the system that anticipates, reserved for character
  // moments like this.
  transition: transform $motion-move $motion-curve-back;

  .logo-img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    // What replaces the frame: a hard 2px outline hugging the pixel silhouette,
    // in the theme's line colour (ink on paper, paper on the dark ground), so
    // the planet keeps an edge on both themes without a box. Four orthogonal
    // drop-shadows are enough — they apply cumulatively, so the diagonals come
    // out closed. No blur: this design has no soft edges.
    filter: drop-shadow(2px 0 0 $mem-line) drop-shadow(-2px 0 0 $mem-line)
      drop-shadow(0 2px 0 $mem-line) drop-shadow(0 -2px 0 $mem-line);
  }
}

// The orbit: the frame's job (marking the target) moves into the hover, where
// it can be a character moment instead of permanent furniture.
//
// Two nested elements on purpose. The ring carries the entrance (opacity +
// scale on a transition); the inner layer carries the rotation. Put both on one
// element and the keyframes' `transform` wins over the declared `scale(1)`, so
// the ring would pop in at full size instead of growing.
// It stays a CIRCLE, and that is a finding rather than a default. A flat,
// tilted ellipse was built and measured first, on the theory that a slanted
// path reads more like an orbit than a halo. It does — but it is smaller than
// the body it orbits, so it disappeared behind the planet and left two dashes
// sticking out at the sides. A path has to be bigger than what it goes around,
// and vertically there is no room for that: the planet is $bar-control (44px)
// in a 72px bar. On top of that, a moon on an ellipse needs `offset-path` to
// follow the ring, and Chromium and Firefox placed it in visibly different
// spots. A circle is rotationally symmetric, so the moon on the rotating layer
// below sits exactly on the ring in every engine, for free.
//
// What is left of that round: the radius. Measured against the bar's top edge,
// -7px left 5.5px of air and read as crowded; -5px leaves 7.5px.
.logo-orbit {
  position: absolute;
  inset: -5px;
  border: 2px dashed $mem-line;
  border-radius: 50%;
  opacity: 0;
  transform: scale(0.72);
  transition: opacity $motion-move $motion-curve, transform $motion-move $motion-curve-back;
  pointer-events: none;

  .logo-orbit-spin {
    position: absolute;
    inset: 0;
  }

  // A pixel moon riding the orbit — coral, the design's secondary accent and
  // the one accent the planet's own palette does not already carry.
  .logo-moon {
    position: absolute;
    top: -4px;
    left: 50%;
    margin-left: -3px;
    width: 6px;
    height: 6px;
    background-color: $mem-coral;
    border: 1px solid $mem-line;
  }
}

// Scoped to pointer devices: `:hover` latches after a tap on touch, which would
// leave the orbit parked around the planet for good. (The top bar hides the
// logo on phones entirely — this covers tablets and touch laptops.)
@media (hover: hover) {
  .swing-logo:hover .logo-orbit-wrapper {
    transform: rotate(-8deg);

    .logo-img {
      animation: logo-planet-spin 0.7s $motion-curve-settle;
    }

    .logo-orbit {
      opacity: 1;
      transform: scale(1);
    }

    .logo-orbit-spin {
      animation: logo-orbit-turn 3s linear infinite;
    }
  }
}

// Pressed: squeezed rather than pushed into its own shadow, because there is no
// shadow to push into — plus the tilt, so the press does not undo the flick.
.swing-logo:active .logo-orbit-wrapper {
  transform: scale(0.9) rotate(-8deg);
}

// The planet spins once per hover. Deliberately hover/press-driven rather than
// an ambient loop: an idle animation on the one element that is always on
// screen is exactly what stops being charming on the tenth viewing (see
// _motion.scss on why the long loops are not part of the scale).
@keyframes logo-planet-spin {
  from {
    transform: rotate(0deg) scale(1);
  }

  55% {
    transform: rotate(200deg) scale(1.12);
  }

  to {
    transform: rotate(360deg) scale(1);
  }
}

@keyframes logo-orbit-turn {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .swing-logo:hover .logo-orbit-wrapper {
    transform: none;

    .logo-img {
      animation: none;
    }

    // The ring still appears — it is the affordance, not the decoration. Only
    // the travelling parts stop.
    .logo-orbit-spin {
      animation: none;
    }
  }

  .swing-logo:active .logo-orbit-wrapper {
    transform: scale(0.94);
  }
}
</style>
