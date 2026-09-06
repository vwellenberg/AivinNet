import { createApp, type Plugin } from "vue";
import { createPinia } from "pinia";

import { MotionPlugin } from "@vueuse/motion";
import WrapBalancer from "vue-wrap-balancer";

import {
  RecycleScroller,
  DynamicScroller,
  DynamicScrollerItem,
  // @ts-ignore
} from "vue-virtual-scroller";
import VWave from "v-wave";
import { autoAnimatePlugin } from "@formkit/auto-animate/vue";
import piniaPluginPersistedstate from "pinia-plugin-persistedstate";

import App from "./App.vue";
import { router } from "./router";
import vTooltip from "./directives/vTooltip";

import "./assets/scss/index.scss";
import "vue-virtual-scroller/dist/vue-virtual-scroller.css";

const app = createApp(App);
const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);

app.use(pinia);
app.use(router);
app.use(autoAnimatePlugin);
// One click ripple for the whole app instead of per-call-site settings.
//
// The ripple belongs to ROWS — nav items, playlist and pinned-album rows,
// folder headers, track rows. Buttons get the press feedback of their role
// (Global/_buttons.scss) and no ripple, so two effects never compete for the
// same element.
//
// `color` is the theme's ink line rather than v-wave's default `currentColor`:
// currentColor makes the ripple whatever the row's text happens to be, so a
// muted row rippled grey and the active yellow row rippled differently again.
// `duration` is the 0.35s TrackItem had already arrived at by hand, now the
// one value for everyone.
app.use(VWave as Plugin, {
  color: "var(--mem-line)",
  duration: 0.35,
});
app.use(MotionPlugin);

app.directive("tooltip", vTooltip);

app.component("WrapBalancer", WrapBalancer);
app.component("RecycleScroller", RecycleScroller);
app.component("DynamicScroller", DynamicScroller);
app.component("DynamicScrollerItem", DynamicScrollerItem);

app.mount("#app");
