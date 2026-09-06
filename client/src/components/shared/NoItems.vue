<template>
  <div v-if="flag" class="nothing rounded">
    <div>
      <!-- Das Achselzucken (#143). Vier Memphis-Formen stieben einmal
           auseinander und kommen zurück, während die Meldung mit den Schultern
           zuckt.

           Ein leerer Zustand ist eine kleine Enttäuschung, und er ist SELTEN —
           genau die Kombination, in der Verspieltheit sich nicht abnutzen kann
           und etwas abfedert. Rein dekorativ, deshalb `aria-hidden`: für einen
           Screenreader steht hier nichts, was der Text nicht schon sagt. -->
      <span class="nothing-shapes" aria-hidden="true">
        <i class="zig"></i>
        <i class="tri"></i>
        <i class="dot"></i>
        <i class="sq"></i>
      </span>
      <component :is="icon" />
      <div class="nothingtitle">
        <b>{{ title }}</b>
      </div>
      <p>
        {{ description }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  icon: any;
  flag: boolean;
  title: string;
  description: string;
}>();
</script>

<style lang="scss">
// Das Achselzucken: die Formen streuen einmal weg und kommen zurück, der
// Textblock zuckt. Alles einmalig — `animation` ohne `infinite`, damit der
// leere Zustand nicht anfängt zu zappeln, solange man ihn liest.
//
// Die Formen sitzen absolut über dem Block und fangen keine Klicks
// (`pointer-events: none`): sie liegen im Weg des Textes, nicht andersherum.
@keyframes nothing-shrug {
  0% {
    transform: translateY(0) rotate(0);
  }

  30% {
    transform: translateY(-7px) rotate(-4deg);
  }

  60% {
    transform: translateY(0) rotate(3deg);
  }

  100% {
    transform: translateY(0) rotate(0);
  }
}

@keyframes nothing-scatter {
  0% {
    transform: translate(0, 0) rotate(0) scale(1);
  }

  35% {
    transform: translate(var(--sx), var(--sy)) rotate(160deg) scale(1.25);
  }

  100% {
    transform: translate(0, 0) rotate(0) scale(1);
  }
}

.nothing {
  height: 100%;
  max-width: 25rem;
  margin: 0 auto;
  position: relative;

  > div {
    animation: nothing-shrug $motion-settle $motion-curve-back;
  }

  .nothing-shapes {
    position: absolute;
    inset: 0;
    pointer-events: none;

    i {
      position: absolute;
      display: block;
      animation: nothing-scatter ($motion-settle * 1.4) $motion-curve-back;
    }

    // Die vier Grundformen des Stils, in den Farben, die sie sonst auch tragen.
    // ⚠️ Über `var(--mem-…)` bzw. die Token, nie als Literal: sonst ist die
    // Bewegung beim nächsten Theme farblich falsch (#143, Theme-Abschnitt).
    .zig {
      left: 8%;
      top: 12%;
      width: 34px;
      height: 12px;
      --sx: -16px;
      --sy: -14px;
      background: repeating-linear-gradient(-55deg, $mem-coral 0 4px, transparent 4px 9px);
    }

    .tri {
      right: 10%;
      top: 8%;
      width: 0;
      height: 0;
      --sx: 14px;
      --sy: -16px;
      border-left: 11px solid transparent;
      border-right: 11px solid transparent;
      border-bottom: 19px solid $mem-blue;
    }

    .dot {
      left: 14%;
      bottom: 16%;
      width: 17px;
      height: 17px;
      --sx: -13px;
      --sy: 15px;
      border-radius: $candy-radius-pill;
      background: $mem-teal;
    }

    .sq {
      right: 12%;
      bottom: 18%;
      width: 15px;
      height: 15px;
      --sx: 15px;
      --sy: 13px;
      background: $mem-pink;
    }
  }
  display: grid;
  // Empty states are shown mostly at page level (over the page ground), so use
  // theme-aware colours. The few white-panel hosts (queue, right-sidebar
  // search) re-pin ink via local overrides in those components.
  color: $mem-content-text;

  p {
    word-break: break-word;
    color: $mem-content-muted;
  }

  .nothingtitle {
    // margin-top: 2.75rem;
    font-size: 1.15rem;
  }

  svg {
    height: 9rem;
  }

  & > * {
    margin: auto;
    text-align: center;
  }
}
</style>
