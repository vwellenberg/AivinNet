<template>
  <div class="root-dirs-prompt">
    <h3 class="t-center">Where do you want to look for music?</h3>
    <div class="options-group">
      <!-- Each card is a choice, so each is a button (#137). -->
      <button
        v-for="option in options"
        :key="option.id"
        type="button"
        class="option"
        @click="option.action()"
      >
        <b>{{ option.title }}</b>
        <div class="info">{{ option.info }}</div>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";

import { addRootDirs, getRootDirs } from "@/requests/settings/rootdirs";
import useModalStore from "@/stores/modal";
import useSettingsStore from "@/stores/settings";

const settings = useSettingsStore();

const modal = useModalStore();
const emit = defineEmits<{
  (e: "hideModal"): void;
}>();

const root_dirs: string[] = [];
const options = ref<any[]>([]);

onMounted(() => {
  getRootDirs()
    .then((res) => root_dirs.push(...res))
    .then(() => {
      settings.setRootDirs(root_dirs);

      options.value = [
        {
          id: "$home",
          title: "Home directory",
          info: "Scan all folders in your home directory.",
          action: () =>
            addRootDirs(["$home"], [])
              .then(() => settings.setRootDirs(["$home"]))
              .then(() => emit("hideModal")),
        },
        {
          id: "wtf",
          title: "Specific directories",
          info: "Select folders to scan for music.",
          action: () => modal.showSetRootDirsModal(),
        },
      ];
    });
});
</script>

<style lang="scss">
.root-dirs-prompt {
  .option {
    // Restated for the <button> (#137).
    display: block;
    width: 100%;
    text-align: left;
    font: inherit;
    padding: 1.25rem;
    position: relative;
    // The row plate, like the settings rows (handDrawnPlates.test.ts): frame
    // and fill used to come from `candy-box` with a pointer on top — no
    // shadow, no press, and a hover on `$candy-pink-deep`, which is YELLOW,
    // the "playing" signal. No hatch, for the settings rows' reason: two lines
    // of type per row, and every row here is a choice.
    @include mem-row-plate($candy-radius-sm, $hatch: false);
    margin-top: 1.25rem;
    cursor: pointer;
    // The choices step in one under the other — the shared arrival, where
    // they used to slide 100px up on a JS spring that ignored reduced motion
    // (see `.m-content` in modal.vue). No extra wait for the plate: they only
    // mount after getRootDirs() answers, when the modal is long up.
    @include mem-arrival($beyond: drop);

    &:hover {
      @include mem-row-plate-hover($hatch: false);
    }

    .info {
      margin-top: $smaller;
      font-size: small;
      font-weight: 500;
    }
  }
}
</style>
