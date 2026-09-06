<template>
    <div class="settingsmodalcontent">
        <Group :group="settings" />
    </div>
</template>

<script setup lang="ts">
import Group from "@/components/SettingsView/Group.vue";
import { SettingGroup } from "@/interfaces/settings";

defineProps<{
    settings: SettingGroup;
}>();
</script>

<style lang="scss">
.settingsmodalcontent {
    width: 100%;
    padding: 0 1rem;
    height: 100%;
    // Fills the `1fr` row of .content; min-height:0 lets it scroll within the
    // modal box instead of overflowing past the viewport (the old
    // `100vh - Xrem` max-height pushed its bottom off-screen and got clipped).
    min-height: 0;
    overflow: auto;
    overflow-x: hidden;
    scrollbar-gutter: stable;
    -webkit-overflow-scrolling: touch;
}
</style>
