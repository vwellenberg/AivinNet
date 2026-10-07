<template>
    <div class="player-spinner circular"></div>
</template>

<style lang="scss">
// `spin` is the global keyframe in Global/basic.scss — this block used to
// declare a second copy of it, and turned it at its own speed.
.player-spinner {
    height: 1.35rem;
    aspect-ratio: 1;
    border: solid transparent;
    border-top: solid;
    border-left: solid;
    animation: spin $motion-spin linear infinite;
}
</style>
