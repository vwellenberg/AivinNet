/**
 * Listening per device on the stats page (#541): the server's shares as words.
 * A device is named from the registry; the two rows that are not a device say
 * what they are. Shares are rounded to whole percent, as the skip quote does.
 */

import type { DeviceRow } from '@/requests/stats'

export function devicePercent(share: number): string {
    if (!Number.isFinite(share)) return '—'
    return `${Math.round(share * 100)} %`
}

/** The bar's fill, clamped to the track. */
export function barWidth(share: number): string {
    if (!Number.isFinite(share)) return '0%'
    return `${Math.min(100, Math.max(0, Math.round(share * 100)))}%`
}

/** The row's label: the registered name, or what the other two kinds are. */
export function deviceLabel(row: Pick<DeviceRow, 'kind' | 'name'>): string {
    if (row.kind === 'device') return row.name || 'Unnamed device'
    if (row.kind === 'other') return 'Other device'
    return 'No device recorded'
}
