import { onMounted, onUnmounted, ref } from 'vue'

import { getRewindYears, RewindYears } from '@/requests/stats'

/**
 * The years a Rewind opens for, which of them the user has seen to the end,
 * and the one still announcing itself (#572). Asked once per mount; `null`
 * until the server answers (or when it does not), so nothing is announced on
 * a guess. `ask: false` skips the request (Home outside January).
 */
export default function useRewindYears(ask = true) {
    const info = ref<RewindYears | null>(null)

    let alive = true
    onUnmounted(() => (alive = false))

    onMounted(async () => {
        // A caller that could not show the answer anyway does not ask.
        if (!ask) return
        const res = await getRewindYears()
        if (alive && res.status === 200) info.value = res.data
    })

    return info
}
