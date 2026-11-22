<template>
    <!-- Settings → General → Keyboard shortcuts: the same list as the ? overlay. -->
    <div class="keyboard-shortcuts">
        <p class="ks-note">
            Press <kbd class="shortcut-kbd">?</kbd> on any page to open this list over it.
        </p>
        <ShortcutList />
    </div>
</template>

<script setup lang="ts">
import ShortcutList from '@/components/shared/ShortcutList.vue'
</script>

<style lang="scss">
.keyboard-shortcuts {
    display: grid;
    gap: $large;

    .ks-note {
        margin: 0;
        font-size: 14px;
        color: $candy-text-muted;
    }
}
</style>
