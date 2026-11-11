import { createApp } from "vue";
import { createPinia } from "pinia";

import {
  RecycleScroller,
  DynamicScrollerItem,
  // @ts-ignore
} from "vue-virtual-scroller";
import { autoAnimatePlugin } from "@formkit/auto-animate/vue";
import piniaPluginPersistedstate from "pinia-plugin-persistedstate";

import App from "./App.vue";
import { router } from "./router";
import vTooltip from "./directives/vTooltip";
import vContextMenu from "./directives/vContextMenu";
import vWave from "./directives/vWave";
import vTip from "./directives/vTip";
import { installArrivalLatch } from "./utils/arrivalLatch";
import TypedDynamicScroller from "./components/shared/TypedDynamicScroller.vue";
import { installTouchActive } from "./utils/touchActive";
import { installImageRetry } from "./utils/imageRetry";

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
// Its colour is the theme's ink line rather than currentColor: currentColor
// made the ripple whatever the row's text happens to be, so a muted row
// rippled grey and the active yellow row rippled differently again. The 0.35 s
// duration is the one value for everyone. See directives/vWave.ts.
app.directive("wave", vWave);

app.directive("tooltip", vTooltip);
// Hover hints in the app's look for icon-only buttons (directives/vTip.ts).
app.directive("tip", vTip);
// Right-click, the context-menu key AND a touch long-press — iOS fires no
// `contextmenu` for a touch. See directives/vContextMenu.ts.
app.directive("context-menu", vContextMenu);

// Song rows and tiles make their entrance once, not on every move the virtual
// scroller makes with them. See utils/arrivalLatch.ts.
installArrivalLatch();

// The press is the touch feedback of every button role, and iOS Safari only
// shows `:active` when <body> listens for touches. See utils/touchActive.ts.
installTouchActive();

// A cover that failed during a server restart loads again once it is back,
// instead of staying a broken-image icon. See utils/imageRetry.ts.
installImageRetry();

app.component("RecycleScroller", RecycleScroller);
// One view pool per component, so a recycled view never turns a card row into
// a head and rebuilds it. See utils/typedScroller.ts.
app.component("DynamicScroller", TypedDynamicScroller);
app.component("DynamicScrollerItem", DynamicScrollerItem);

app.mount("#app");
