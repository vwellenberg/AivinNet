import { defineStore } from 'pinia'
import {
    MusicBrainzStatus,
    fetchMissingCovers,
    getMissingCoverCount,
    getMusicBrainzStatus,
} from '@/requests/musicbrainz'
import { NotifType, useToast } from '@/stores/notification'

const POLL_INTERVAL_MS = 2000

interface State {
    status: MusicBrainzStatus | null
    pollTimer: ReturnType<typeof setInterval> | null
    starting: boolean
    totalAlbums: number
    missingCount: number
    failedCount: number
    remainingCount: number
    countLoaded: boolean
}

export default defineStore('musicbrainz', {
    state: (): State => ({
        status: null,
        pollTimer: null,
        starting: false,
        totalAlbums: 0,
        missingCount: 0,
        failedCount: 0,
        remainingCount: 0,
        countLoaded: false,
    }),
    getters: {
        isRunning: (s) => !!s.status?.in_progress,
        progressPct(): number {
            if (!this.status || this.status.total === 0) return 0
            const done = this.status.fetched + this.status.failed
            return Math.min(100, Math.round((done / this.status.total) * 100))
        },
        progressText(): string {
            const s = this.status
            if (!s) return ''
            const done = s.fetched + s.failed
            if (s.in_progress) {
                return `${done}/${s.total} — ${s.fetched} ok, ${s.failed} fail`
            }
            if (s.total > 0) {
                return `Fertig: ${s.fetched}/${s.total} (${s.failed} fehlgeschlagen)`
            }
            return ''
        },
    },
    actions: {
        async refreshStatus() {
            this.status = await getMusicBrainzStatus()
            if (this.status && !this.status.in_progress) {
                this.stopPolling()
                // Refresh the missing count once a batch settles.
                this.refreshCount()
            }
        },
        async refreshCount() {
            const res = await getMissingCoverCount()
            if (res) {
                this.totalAlbums = res.total
                this.missingCount = res.missing
                this.failedCount = res.failed ?? 0
                this.remainingCount = res.remaining ?? res.missing
                this.countLoaded = true
            }
        },
        startPolling() {
            if (this.pollTimer) return
            this.pollTimer = setInterval(() => this.refreshStatus(), POLL_INTERVAL_MS)
        },
        stopPolling() {
            if (this.pollTimer) {
                clearInterval(this.pollTimer)
                this.pollTimer = null
            }
        },
        /**
         * Start a batch. limit = 0 means "all missing albums".
         * retryFailed = true also retries albums previously without a cover.
         */
        async startBatch(limit = 0, retryFailed = false) {
            if (this.starting || this.isRunning) return
            this.starting = true
            try {
                const res = await fetchMissingCovers(limit, retryFailed)
                if (res.status === 409 && res.runningStatus) {
                    this.status = res.runningStatus
                    this.startPolling()
                    return
                }
                if (!res.success) {
                    useToast().showNotification(
                        res.error || 'Batch konnte nicht gestartet werden',
                        NotifType.Error,
                    )
                    return
                }
                if (res.queued === 0) {
                    useToast().showNotification(
                        'Keine Alben ohne Cover',
                        NotifType.Info,
                    )
                    return
                }
                useToast().showNotification(
                    `Batch gestartet (${res.queued} Alben)`,
                    NotifType.Info,
                )
                await this.refreshStatus()
                this.startPolling()
            } finally {
                this.starting = false
            }
        },
    },
})
