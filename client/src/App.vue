<template>
    <ContextMenu />
    <Modal />
    <Notification />
    <div id="drag-img" class="ellip2" style=""></div>
    <section
        id="app-grid"
        :class="{
            useSidebar: settings.use_sidebar && xl,
            NoSideBorders: settings.is_alt_layout || !xxl,
            is_alt_layout: settings.is_alt_layout,
        }"
    >
        <LeftSidebar v-if="!isMobile" />
        <NavBar />
        <div id="acontent" v-element-size="updateContentElemSize">
            <div id="contentresizer" ref="appcontent"></div>
            <BalancerProvider>
                <RouterView />
            </BalancerProvider>
        </div>
        <RightSideBar v-if="settings.use_sidebar && xl" />
        <BottomBar />
        <!-- <BubbleManager /> -->
    </section>
</template>

<script setup lang="ts">
// @libraries
import { vElementSize } from "@vueuse/components";
import { onStartTyping } from "@vueuse/core";
import { onBeforeUnmount, onMounted, Ref, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { BalancerProvider } from "vue-wrap-balancer";

// @stores
import useAuth from "@/stores/auth";
import useDeviceSync from "@/stores/devicesync";
import { content_height, content_width, isMobile, resizer_width } from "@/stores/content-width";
import useLyrics from "@/stores/lyrics";
import useModal from "@/stores/modal";
import useQueue from "@/stores/queue";
import useSettings from "@/stores/settings";
import useTracker from "@/stores/tracker";

// @utils
import handleShortcuts from "@/helpers/useKeyboard";
import { xl, xxl } from "./composables/useBreakpoints";

// @small-components
import ContextMenu from "@/components/ContextMenu.vue";
import Modal from "@/components/modal.vue";
import Notification from "@/components/Notification.vue";

// @app-grid-components
import BottomBar from "@/components/BottomBar/BottomBar.vue";
import LeftSidebar from "@/components/LeftSidebar/index.vue";
import NavBar from "@/components/nav/NavBar.vue";
import RightSideBar from "@/components/RightSideBar/Main.vue";

import { getAllSettings } from "@/requests/settings";
import { getRootDirs } from "@/requests/settings/rootdirs";
import { getLoggedInUser } from "./requests/auth";
// import BubbleManager from "./components/bubbles/BinManager.vue";

const appcontent: Ref<HTMLLegendElement | null> = ref(null);
const auth = useAuth();
const queue = useQueue();
const modal = useModal();
const lyrics = useLyrics();
const router = useRouter();
const settings = useSettings();
useTracker();

handleShortcuts(useQueue, useModal);

// Toggle the Spotify-style UI font based on the "Font" setting.
watch(
    () => settings.font,
    (font) => {
        document.body.classList.toggle("use-spotify-font", font === "spotify");
    },
    { immediate: true }
);

// Drive the Now Playing Lauflicht intensity from the setting. `off` hides it,
// `subtle` dims it (body.lauflicht-subtle), `normal` is full strength (no class).
watch(
    () => settings.np_lauflicht_level,
    (level) => {
        document.body.classList.toggle("lauflicht-off", level === "off");
        document.body.classList.toggle("lauflicht-subtle", level === "subtle");
    },
    { immediate: true }
);

// Auto dark mode: decide the theme from the time of day in Berlin BEFORE the
// watch below runs its immediate pass, so a reload never paints the wrong theme
// first. The setting is restored from persistence synchronously, so it is already
// known here. No-op unless the user turned Auto dark mode on.
settings.applyAutoTheme();

// ...and keep checking while the app stays open, or an app left running would
// still be in light mode well past 20:00. Cheap: one timer, one Intl read.
const autoThemeTimer = setInterval(() => settings.applyAutoTheme(), 5 * 60 * 1000);
onBeforeUnmount(() => clearInterval(autoThemeTimer));

// Memphis theme: body.theme-dark flips the --mem-* custom properties
// (Global/index.scss) to the classic-90s indigo dark look.
watch(
    () => settings.theme,
    (theme) => {
        document.body.classList.toggle("theme-dark", theme === "dark");
    },
    { immediate: true }
);

router.afterEach(() => {
    (document.getElementById("acontent") as HTMLElement).scrollTo(0, 0);
});

onStartTyping(() => {
    const elem = document.getElementById("globalsearch") as HTMLInputElement;
    elem.focus();
    elem.value = "";
});

function getContentSize() {
    const elem = document.getElementById("acontent") as HTMLElement;
    return {
        width: elem.offsetWidth,
        height: elem.offsetHeight,
    };
}

function updateContentElemSize({ width, height }: { width: number; height: number }) {
    // 1572 is the maxwidth of the #acontent. see app-grid.scss > $maxwidth
    const elem_width = appcontent.value?.offsetWidth || 0;

    content_width.value = elem_width;
    content_height.value = height;

    resizer_width.value = elem_width;
}

function handleRootDirsPrompt() {
    getRootDirs().then(dirs => {
        if (dirs.length) {
            settings.setRootDirs(dirs);
            return;
        }

        // Nothing configured yet. The prompt is a setup assistant: every control
        // in it writes root dirs or browses the server filesystem, and both are
        // admin-only on the backend. Shown to a guest it would be an undismissable
        // modal on every app start whose buttons all answer 403.
        if (auth.is_admin) {
            modal.showRootDirsPromptModal();
        }
    });
}

onMounted(async () => {
    const { width, height } = getContentSize();
    updateContentElemSize({ width, height });

    const res = await getLoggedInUser();

    if (res.status == 200) {
        auth.setUser(res.data);
    } else {
        return;
    }

    settings.initializeVolume();

    // Device sync: register this device and start the session poll loop.
    // Must never break app start (e.g. older backend without the endpoints).
    const ds = useDeviceSync();
    ds.register()
        .then(() => ds.startPolling())
        .catch(() => null);

    handleRootDirsPrompt();

    getAllSettings()
        .then(({ settings: data }) => {
            settings.mapDbSettings(data);
        })
        .then(() => {
            if (queue.currenttrack && !settings.use_lyrics_plugin) {
                lyrics.checkExists(queue.currenttrack.filepath, queue.currenttrack.trackhash);
            }
        });
});
</script>

<script lang="ts">
// Detect OS & browser agents and add class
import { defineComponent } from "vue";
import usePlayer from "./composables/usePlayer";

// Reveal the scrollbar only while the user is actively scrolling. Scroll events
// don't bubble, so we listen in the capture phase to catch inner scroll
// containers too. The `is-scrolling` class is removed shortly after scrolling
// stops, so the bar auto-hides again.
let scrollHideTimer: ReturnType<typeof setTimeout> | undefined;
function handleGlobalScroll(event: Event) {
    const el = document.documentElement;
    el.classList.add("is-scrolling");
    if (scrollHideTimer) clearTimeout(scrollHideTimer);
    scrollHideTimer = setTimeout(() => el.classList.remove("is-scrolling"), 700);

    // Drag the cover veil along with the content it belongs to. The veil is
    // painted as the background of `.v-scroll-page` — BEHIND the scroller,
    // because that is the only layer the scrollbar's transparent track lets
    // through (the full reasoning is on `.scroller` in app-grid.scss) — and a
    // background behind the scroller does not scroll on its own. This is what
    // buys back the "band scrolls away with the header" behaviour that the
    // veil had while it lived inside the scroller.
    //
    // ⚠️ The page's OWN scroller only. This fires in the capture phase for
    // every scroll container on the page, and the header carries horizontal
    // card rails — those have `scrollTop === 0` at all times, so reacting to
    // them would snap the veil back to the top of a page that is scrolled.
    const target = event.target as HTMLElement | null;
    if (!target?.classList?.contains("scroller")) return;
    const page = target.closest(".v-scroll-page") as HTMLElement | null;
    if (page) page.style.setProperty("--veil-scroll", `${target.scrollTop}px`);
}

export default defineComponent({
    name: "OsAndBrowserSpecificContent",
    mounted() {
        this.applyClassBasedOnAgent();
        window.addEventListener("scroll", handleGlobalScroll, { capture: true, passive: true });
    },
    beforeUnmount() {
        window.removeEventListener("scroll", handleGlobalScroll, true);
    },
    methods: {
        applyClassBasedOnAgent() {
            const userAgent = navigator.userAgent;
            const isWindows = /Win/.test(userAgent);
            const isLinux = /Linux/.test(userAgent) && !/Android/.test(userAgent);
            const isChrome = /Chrome/.test(userAgent) && /Google Inc/.test(navigator.vendor);
            if ((isWindows || isLinux) && isChrome) {
                document.documentElement.classList.add("designatedOS");
            } else {
                document.documentElement.classList.add("otherOS");
            }
        },
    },
});
</script>

<style lang="scss">
@import "./assets/scss/mixins.scss";
.designatedOS .r-sidebar {
    &::-webkit-scrollbar {
        display: none;
    }
}
</style>
