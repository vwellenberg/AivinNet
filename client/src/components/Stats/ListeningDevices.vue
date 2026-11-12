<template>
    <!-- Listening per device (#541): each device's share of the time listened over
         the period. Devices are recorded from #541 on; older plays are shown as
         "No device recorded", and the note says so. -->
    <section v-if="devices && devices.total" class="listening-devices">
        <h3 class="section-title">Listening per device</h3>
        <div class="devices-plate">
            <ol class="devices-list">
                <li
                    v-for="(row, i) in devices.devices"
                    :key="rowKey(row)"
                    class="devices-row"
                    :style="{ '--device-accent': accentAt(i) }"
                >
                    <span class="devices-icon" aria-hidden="true"><DevicesSvg /></span>
                    <div class="devices-text">
                        <span class="devices-label" :title="deviceLabel(row)">{{ deviceLabel(row) }}</span>
                        <div class="devices-bar" aria-hidden="true">
                            <span :style="{ width: barWidth(row.share) }"></span>
                        </div>
                    </div>
                    <div class="devices-figures">
                        <span class="devices-share">{{ devicePercent(row.share) }}</span>
                        <span class="devices-time">{{ formatSeconds(row.seconds, true) }}</span>
                    </div>
                </li>
            </ol>
            <p class="devices-note">
                Devices are recorded from this version on. Plays before that count as "No device recorded", and a device
                since removed as "Other device".
            </p>
        </div>
    </section>
</template>

<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'

import { DeviceRow, DevicesPayload, getListeningDevices } from '@/requests/stats'
import DevicesSvg from '@/assets/icons/devices.svg'
import formatSeconds from '@/utils/useFormatSeconds'
import { accentAt } from '@/utils/statAccents'
import { barWidth, deviceLabel, devicePercent } from '@/utils/listeningDevices'

const props = defineProps<{ period: string }>()

const devices = ref<DevicesPayload | null>(null)

function rowKey(row: DeviceRow): string {
    return `${row.kind}:${row.device_id ?? ''}`
}

// As the skip quote does: a period clicked through quickly must not paint the
// answer to an earlier one, and a page left must not be painted into at all.
let asked = 0
onUnmounted(() => (asked = -1))

watch(
    () => props.period,
    async period => {
        const ask = ++asked
        const res = await getListeningDevices(period)
        if (ask !== asked) return
        devices.value = res.status === 200 ? res.data : null
    },
    { immediate: true }
)
</script>

<style lang="scss">
.listening-devices {
    margin-top: 2rem;

    .section-title {
        @include mem-sticker;
        margin: 0 0 1rem 0;
        font-size: 1.15rem;
        font-weight: 700;
    }

    .devices-plate {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        max-width: 100%;
        padding: 1rem;
        background-color: var(--mem-veil);
        border: $candy-border;
        border-radius: $candy-radius;
        @include candy-shadow;
        color: $mem-content-text;
    }

    // The rows on a panel card, like the skip rankings beside them.
    ol {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        margin: 0;
        padding: 0.75rem;
        list-style: none;
        background-color: $mem-panel;
        border: $candy-border;
        border-radius: $candy-radius-sm;
        color: $mem-text;
    }

    .devices-row {
        display: grid;
        grid-template-columns: 2.5rem minmax(0, 1fr) auto;
        align-items: center;
        gap: 0.75rem;
        padding: 0.35rem;
        border-radius: $candy-radius-sm;
    }

    // The device's own accent: its badge and its bar wear the same colour.
    .devices-icon {
        display: grid;
        place-items: center;
        width: 2.5rem;
        height: 2.5rem;
        // A look without accent badges (Boring): the glyph alone, in white.
        background-color: var(--look-stat-badge-fill, var(--device-accent));
        border: $candy-border;
        border-radius: $candy-radius-sm;
        color: var(--look-stat-badge-text, #{$mem-ink});

        svg {
            width: 1.4rem;
            height: 1.4rem;
        }
    }

    .devices-text {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        min-width: 0;
    }

    .devices-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 600;
    }

    .devices-bar {
        height: 0.5rem;
        border-radius: 999px;
        background-color: rgba(127, 127, 127, 0.25);
        overflow: hidden;

        span {
            display: block;
            height: 100%;
            border-radius: inherit;
            background-color: var(--look-stat-bar, var(--device-accent));
        }
    }

    .devices-figures {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
    }

    .devices-share {
        font-size: 1.1rem;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
    }

    .devices-time {
        font-size: 0.85rem;
        white-space: nowrap;
        opacity: 0.8;
    }

    .devices-note {
        margin: 0;
        padding-top: 0.75rem;
        border-top: $mem-hairline-w dashed $mem-line;
        font-size: 0.8rem;
        opacity: 0.7;
    }
}
</style>
