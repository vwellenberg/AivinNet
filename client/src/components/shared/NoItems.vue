<template>
  <div v-if="flag" class="nothing rounded">
    <div class="nothing-plate">
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

  // Die Meldung liegt auf einer Platte wie jeder Text auf dem Doodle-Grund
  // (styling.md, `--mem-veil`). Sie stand nackt darauf, und „No results" war
  // genau dort unlesbar, wo eine Form unter den Wörtern durchlief. Die Formen
  // richten sich an der Platte aus und stieben aus ihren Ecken.
  .nothing-plate {
    position: relative;
    padding: 1.5rem 2rem;
    background-color: var(--mem-veil);
    border: $candy-border;
    border-radius: $candy-radius;
    @include candy-shadow;
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
    // Sie sitzen AUF dem oberen und unteren Plattenrand, halb überstehend:
    // innerhalb der Platte lag der Punkt mitten in der Beschreibung
    // („We●an't find …"). Nur oben/unten, je 1.5rem von der Ecke — seitlich
    // überstehend (plus 16px Streuung) liefen sie am Handy, wo die Platte so
    // breit ist wie ihr Wirt, über dessen Kante; in einem `overflow: auto`-Wirt
    // (die Suchspalte) hieße das ein horizontaler Scrollbalken während der
    // Animation. Den Überstand nach oben und unten fängt `padding-block` ab.
    // ⚠️ Über `var(--mem-…)` bzw. die Token, nie als Literal: sonst ist die
    // Bewegung beim nächsten Theme farblich falsch (#143, Theme-Abschnitt).
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
  display: grid;
  // Raum für die Formen, die über den oberen und unteren Plattenrand ragen
  // (bis 10px plus 16px Streuung).
  padding-block: 1.75rem;
  // Die Platte ist `--mem-veil` und wechselt mit dem Theme, also auch die
  // Schrift darauf: theme-abhängige Farben, kein festes Ink.
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
