import type { LocationQueryRaw, RouteParamsRaw } from "vue-router";

import { Routes } from "@/router";
import useSearch from "@/stores/search";

import FolderSvg from "@/assets/icons/folder-1.svg";
import BookmarkSvg from "@/assets/icons/bookmark.svg";
import PlaylistSvg from "@/assets/icons/playlist-1.svg";
import SearchSvg from "@/assets/icons/search.svg";
import HomeSvg from "@/assets/icons/home.svg";
import ChartSvg from "@/assets/icons/chart.svg";

// A sidebar/bottom-bar navigation entry. Only `separator: true` entries omit
// the route fields; `icon` is `any` because that's what the `*.svg` module
// declaration exports.
//
// These entries used to carry an `iconClass` so NavButtons could scale each
// glyph individually — the icons came from three different sets and filled
// their viewBox by different amounts. They are one set now, so there is
// nothing left to correct and the field is gone.
interface NavItem {
  name?: string;
  route_name?: string;
  params?: RouteParamsRaw;
  query?: () => LocationQueryRaw;
  icon?: any;
  separator?: boolean;
  action?: () => void;
  // The entry's memphis fill. Declared HERE rather than as an `nth-child` rule
  // in the stylesheet: the list contains a separator, so a positional selector
  // would silently re-colour every entry below it the moment one is added or
  // moved. The value is a class suffix (`tint-teal` -> `.nav-item.tint-teal`).
  //
  // ⚠️ THE ORDER IS PART OF THE VALUE. Toned to pastel, green and teal sit
  // close enough that Home above Folders read as one colour twice — so the
  // sequence alternates warm and cool and keeps the two red-ish fills (pink,
  // coral) apart:
  //
  //   green · lavender · coral  —  separator —  teal · pink · yellow
  //
  // Moving an entry means checking its new neighbours, not just its own fill.
  tint?: string;
}

const folder = {
  name: "folders",
  route_name: Routes.folder,
  params: { path: "$home" },
  icon: FolderSvg,
  tint: "tint-lavender",
};

const favorites = {
  name: "favorites",
  route_name: Routes.favorites,
  icon: BookmarkSvg,
  tint: "tint-teal",
};

const playlists = {
  name: "playlists",
  route_name: Routes.playlists,
  icon: PlaylistSvg,
  tint: "tint-pink",
};

const home = {
  name: "home",
  route_name: Routes.Home,
  icon: HomeSvg,
  // Brand green, and it is the only entry that gets it: home is where the app
  // starts. Blush moved out of this list entirely — it is the hover colour now,
  // and a row that wears its own hover state permanently reads as broken.
  tint: "tint-green",
};

export const menus: NavItem[] = [
  home,
  folder,
  {
    name: "search",
    route_name: Routes.search,
    params: { page: "top" },
    query: () => ({ q: useSearch().query }),
    icon: SearchSvg,
    tint: "tint-coral",
  },
  {
    separator: true,
  },
  favorites,
  playlists,
  {
    name: "stats",
    route_name: Routes.Stats,
    icon: ChartSvg,
    tint: "tint-yellow",
  },
];
