<template>
    <div class="confirm-modal">
        <div class="t-center" style="padding: 0 4rem">{{ text }}</div>
        <div class="buttons">
            <button class="cancel btn-pill" @click="cancelAction">Cancel</button>
            <button class="confirm btn-pill" @click="confirmAction">Delete</button>
        </div>
    </div>
</template>

<script setup lang="ts">
defineProps<{
    text: string
    confirmAction: () => void
    cancelAction: () => void
}>()
</script>

<style lang="scss">
.confirm-modal {
    .t-center {
        font-weight: 500;
    }

    .buttons {
        margin-top: 2rem;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
    }

    .cancel {
        background-color: $candy-white;
        // Panel-var fill (dark in dark) -> adaptive label, not the ink
        // default from the button base.
        color: $candy-text;

        &:hover {
            background-color: $candy-pink-soft;
        }
    }

    .confirm {
        // Destructive action — coral (danger), not the yellow active accent.
        background-color: $mem-coral;
        // Static light label on coral (the panel var would go dark in dark).
        color: $mem-panel-static;

        &:hover {
            background-color: $mem-coral;
            opacity: 0.9;
        }
    }
}
</style>
