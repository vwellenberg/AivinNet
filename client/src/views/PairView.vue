<template>
    <div class="pair-view">
        <div class="card rounded">
            <img src="/logo-fill.light.svg" alt="AivinNet" class="logo" />
            <template v-if="state === 'working'">
                <div class="spinner"></div>
                <p>Pairing this device…</p>
            </template>
            <template v-else-if="state === 'failed'">
                <h3>Pairing failed</h3>
                <p>The pairing code is invalid or has already been used. Open Settings → Pair device on the other device to get a fresh code.</p>
                <button class="rounded-sm" @click="goHome">Go to login</button>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import { pairWithCode } from '@/requests/auth'

const route = useRoute()
const state = ref<'working' | 'failed'>('working')

function goHome() {
    // Full reload: after a successful redeem the auth cookie is set and the
    // app boots logged in; on failure this simply lands on the login modal.
    window.location.replace(window.location.origin)
}

onMounted(async () => {
    const code = typeof route.query.code === 'string' ? route.query.code : ''

    if (!code) {
        state.value = 'failed'
        return
    }

    const res = await pairWithCode(code)

    if (res.status === 200) {
        goHome()
        return
    }

    state.value = 'failed'
})
</script>

<style lang="scss">
.pair-view {
    display: grid;
    place-items: center;
    height: 100%;
    padding: 1rem;

    .card {
        max-width: 24rem;
        padding: 2rem;
        text-align: center;
        background-color: var(--mem-veil, rgba(0, 0, 0, 0.2));
        display: grid;
        gap: 1rem;
        justify-items: center;

        .logo {
            width: 4rem;
            height: 4rem;
        }

        button {
            padding: 0.75rem 1.5rem;
            background-color: $brand-green;
            color: white;
            border: none;
            cursor: pointer;
        }
    }

    .spinner {
        width: 2rem;
        height: 2rem;
        border: 3px solid transparent;
        border-top-color: $brand-green;
        border-radius: 50%;
        animation: pairspin 0.8s linear infinite;
    }

    @keyframes pairspin {
        to {
            transform: rotate(360deg);
        }
    }
}
</style>
