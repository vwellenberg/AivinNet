<template>
    <div class="card-placeholder" :class="{ with_helptext }">
        <div class="image rounded-sm holder"></div>
        <div class="help holder"></div>
        <div class="name holder"></div>
        <div class="itemcount holder"></div>
    </div>
</template>

<script setup lang="ts">
defineProps<{
    with_helptext?: boolean;
}>()
</script>

<style lang="scss">
@keyframes candyPulse {
    0%,
    100% {
        opacity: 1;
    }

    50% {
        opacity: 0.55;
    }
}


.card-placeholder {
    padding: $medium;

    .holder {
        background-color: $candy-pink-soft;
        animation: candyPulse 1.7s ease-in-out infinite;
    }

    .image {
        width: 100%;
        aspect-ratio: 1;
        background-color: $candy-pink-soft;
    }

    .help,
    .itemcount {
        margin-top: $small;
        height: 1rem;
        border-radius: $smaller;
    }

    .help {
        height: 0;
    }

    .itemcount {
        width: 100%;
    }

    .name {
        width: 80%;
        border-radius: $smaller;
        height: 1rem;
        margin-top: $small;
    }

    &.with_helptext {
        .help {
            height: 1rem;
            width: 70%;
        }

        .name {
            width: 100%;
        }

        .itemcount {
            width: 85%;
        }
    }
}
</style>