<template>
    <!-- Listening per device (#541): each device's share of the time listened over
         the period. Devices are recorded from #541 on; older plays are shown as
         "No device recorded", and the note says so. -->
    <section v-if="devices && devices.total" class="listening-devices">
        <h3 class="section-title">Listening per device</h3>
        <div class="devices-plate">
            <ol class="devices-list">
                <li v-for="row in devices.devices" :key="rowKey(row)" class="devices-row">
                    <div class="devices-line">
                        <span class="devices-label">{{ deviceLabel(row) }}</span>
                        <span class="devices-share">{{ devicePercent(row.share) }}</span>
                    </div>
                    <div class="devices-bar" aria-hidden="true">
                        <span :style="{ width: barWidth(row.share) }"></span>
                    </div>
                    <span class="devices-time">{{ formatSeconds(row.seconds, true) }}</span>
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
import formatSeconds from '@/utils/useFormatSeconds'
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
        gap: 0.9rem;
        max-width: 100%;
        padding: 1rem;
        background-color: var(--mem-veil);
        border: $candy-border;
        border-radius: $candy-radius;
        @include candy-shadow;
        color: $mem-content-text;
    }

    ol {
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .devices-row {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        padding: 0.2rem 0;
    }

    .devices-line {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        font-weight: 600;
    }

    .devices-share {
        font-variant-numeric: tabular-nums;
    }

    .devices-bar {
        height: 0.5rem;
        border-radius: 999px;
        background-color: rgba(127, 127, 127, 0.25);
        overflow: hidden;

        span {
            display: block;
            height: 100%;
            background-color: $mem-teal;
        }
    }

    .devices-time,
    .devices-note {
        font-size: 0.85rem;
        opacity: 0.8;
    }

    .devices-note {
        margin: 0;
    }
}
</style>
