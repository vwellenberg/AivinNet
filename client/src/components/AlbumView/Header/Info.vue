<template>
  <!-- Two children, like every detail head: the text, then the action row.
       The row is a direct child so the phone layout can move it into a strip
       under the whole plate (Global/detail-head.scss); `album-lead` keeps the
       title at the top and the meta line at the foot of the text column. -->
  <div class="album-info dh-body">
    <div class="album-lead dh-stack">
      <div class="top dh-text">
        <!-- <AlbumType :album="album" /> -->
        <div class="albumtype dh-type">{{ album.type }}</div>
        <!-- One line, ellipsed. Balancing the title over two lines made sense
             while the head was 18rem of free space; inside the plate every extra
             line pushes the whole head taller and stretches the media cell into a
             portrait crop with it. -->
        <div id="albumheadertitle" class="title dh-title ellip" :title="album.title">{{ album.title }}</div>
      </div>
      <div class="bottom">
        <Versions :versions="album.versions" />
        <div class="dh-text">
          <Stats :album="album" />
        </div>
      </div>
    </div>
    <Buttons />
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from "pinia";
import { onMounted } from "vue";
import { onBeforeRouteUpdate } from "vue-router";


import useAlbumStore from "@/stores/pages/album";
import updatePageTitle from "@/utils/updatePageTitle";

import Stats from "./Stats.vue";
import Buttons from "./Buttons.vue";
import Versions from "./Versions.vue";
import AlbumType from "./AlbumType.vue";

const store = useAlbumStore();

const { info: album } = storeToRefs(store);

const updateTitle = () => {
  updatePageTitle(album.value.title + " - " + album.value.albumartists[0].name);
};

onMounted(() => {
  updateTitle();
});

onBeforeRouteUpdate(() => {
  updateTitle();
});
</script>

<style lang="scss">
// Type, title and meta sizes come from `.dh-type` / `.dh-title` in the shared
// anatomy (Global/detail-head.scss). The ground halos that used to sit on the
// type and the meta line are gone with them: they existed because the text
// stood free on the doodle ground, and it now stands on a panel.
.album-info {
  .album-lead {
    flex: 1;
    justify-content: space-between;
  }

  .top {
    .albumtype {
      text-transform: capitalize;
    }

    .title {
      width: fit-content;
      cursor: text;
    }

    .artist {
      font-size: 1.15rem;
    }
  }

  .bottom {
    margin-top: $smaller;

    .stats2 {
      text-align: center;
      margin: 0;
    }

    .versions {
      margin-bottom: $medium;
      margin-left: -$smaller;

      // &:first-child {}
      // .master-flag {
      //   background-color: transparent !important;
      //   border: solid 1px !important;
      // }
    }
  }
}
</style>
