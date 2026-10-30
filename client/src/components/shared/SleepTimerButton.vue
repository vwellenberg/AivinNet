<template>
  <button
    class="sleep-timer-btn"
    :class="{ active: sleep.active }"
    :title="title"
    :aria-label="title"
    @click="openMenu"
  >
    <SleepSvg />
    <span v-if="sleep.active" class="sleep-timer-label">{{ sleep.label }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { ContextSrc } from '@/enums'
import type { Option } from '@/interfaces'
import useContextStore from '@/stores/context'
import useDeviceSync from '@/stores/devicesync'
import useSleepTimer from '@/stores/sleepTimer'
import { SLEEP_MINUTES } from '@/utils/sleepTimer'

import SleepSvg from '@/assets/icons/sleep.svg'

const sleep = useSleepTimer()
const ds = useDeviceSync()

const title = computed(() =>
  sleep.active ? `Sleep timer: ${sleep.label} — tap to change or cancel` : 'Sleep timer'
)

/**
 * Off (only while a timer runs), the four clock choices, and the two that end
 * with the track. In a group only the device that books the group's next track
 * can end on a track boundary, so there they are offered to that device only.
 */
function options(): Option[] {
  const items: Option[] = []
  if (sleep.active) items.push({ label: 'Off', action: () => sleep.cancel() })

  for (const minutes of SLEEP_MINUTES) {
    items.push({ label: `${minutes} min`, action: () => sleep.arm({ kind: 'minutes', minutes }) })
  }

  if (!ds.joined || ds.isScrobbleLeader) {
    items.push({ label: 'End of song', action: () => sleep.arm({ kind: 'song' }) })
    items.push({ label: 'End of album', action: () => sleep.arm({ kind: 'album' }) })
  }
  return items
}

function openMenu(e: MouseEvent) {
  useContextStore().showContextMenu(e, options, ContextSrc.SleepTimer)
}
</script>

<style lang="scss">
// The sleep timer's anatomy, owned here like DevicesButton's: a bar control
// (`$bar-control`, btn-action) at rest. While a timer runs it wears the on-state
// box that shuffle and repeat wear, and widens to fit its label.
.sleep-timer-btn {
  @include btn-action($size: $bar-control);
  color: $candy-text;

  &.active {
    @include btn-toggle-on;
    width: auto;
    min-width: $bar-control;
    padding: 0 0.6rem;
  }
}

.sleep-timer-label {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
</style>
