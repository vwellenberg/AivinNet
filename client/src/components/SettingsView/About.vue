<template>
    <div class="aboutswingmusic">
        <div class="version">AivinNet v{{ clientVersion }}</div>
        <div v-if="settings.version" class="server-version">Server v{{ settings.version }}</div>
        <p class="blurb">
            AivinNet is a fork of
            <a href="https://github.com/swingmx/swingmusic" target="_blank"><u>Swing Music</u></a>
            — a self-hosted music player for your local library.
        </p>
        <div class="links">
            <h2>Links</h2>
            <div class="flex">
                <a href="https://github.com/vwellenberg/AivinNet" target="_blank">
                    <button class="btn-pill">Backend (GitHub)</button>
                </a>
                <a href="https://github.com/vwellenberg/AivinNet-Client" target="_blank">
                    <button class="btn-pill">Frontend (GitHub)</button>
                </a>
                <a href="https://github.com/swingmx/swingmusic" target="_blank">
                    <button class="btn-pill">Upstream: Swing Music</button>
                </a>
            </div>
        </div>
        <!--
            The recovery path for a corrupt persisted store. It used to hang off
            the top-bar title block, which only rendered in the layout the "Use
            no sidebar layout" setting switched to — i.e. it had been
            unreachable for every default user long before that setting was
            removed. About is where a user looks for it.
        -->
        <ClientReset />
    </div>
</template>

<script setup lang="ts">
import useSettings from '@/stores/settings'
import pkg from '../../../package.json'
import ClientReset from './ClientReset.vue'

const settings = useSettings()
const clientVersion = pkg.version
</script>

<style lang="scss">
// One step for this pane, so the blocks sit on a rhythm instead of on whatever
// each one happened to bring. The pills below used to gap by 1rem among
// themselves while "Reset client" followed at ZERO — measured: rows at y=344 and
// y=404 (16px apart), the reset pill at y=448 against a row ending at 448, close
// enough for the pills' offset shadow to touch it.
$about-step: 1rem;

.aboutswingmusic {
    padding: $small;

    .version {
        font-size: 1.5rem;
        font-weight: bold;
        margin-bottom: $smaller;
    }

    .server-version {
        font-size: 0.85rem;
        opacity: 0.55;
        margin-bottom: $small;
        border-bottom: solid 1px $separator;
        padding-bottom: 1rem;
    }

    // Was two <br> tags — the same spacing spelled as content, which no rule can
    // see and no rhythm can include.
    .blurb {
        margin: 0 0 $about-step * 2;
    }

    .links .flex {
        flex-wrap: wrap;
        margin-top: $small;
        gap: $about-step;
    }

    // The reset pill is its own group — a destructive action, not a link — so it
    // takes TWO steps: the same rhythm, but reading as a separate block rather
    // than as a fourth entry under the "Links" heading.
    .clientreset {
        margin-top: $about-step * 2;
    }

    h2 {
        margin-top: 0;
        margin-bottom: $smaller;
    }
}
</style>
