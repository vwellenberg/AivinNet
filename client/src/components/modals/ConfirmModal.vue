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
        // No hover of its own: the pill role's is the hover (the shared token,
        // pointer-gated). The soft-pink fill that stood here kept only half of
        // it — the role, later in the bundle at the same specificity, still
        // flipped the label to `--mem-hover-text`: paper on the light fill in
        // the light theme, ink on #242424 in the dark one.
    }

    .confirm {
        // Destructive action — coral (danger), not the yellow active accent.
        background-color: $mem-coral;
        // Static light label on coral (the panel var would go dark in dark).
        color: $mem-panel-static;

        // Destructive keeps its coral under the pointer — and its label with
        // it: the role flips the text to `--mem-hover-text` (ink in the dark
        // theme). Gated like the role it overrides (Global/_buttons.scss,
        // HOVER IS POINTER-ONLY).
        @media (hover: hover) {
            &:hover {
                background-color: $mem-coral;
                color: $mem-panel-static;
                opacity: 0.9;
            }
        }
    }
}
</style>
