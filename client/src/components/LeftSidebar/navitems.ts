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
  // ⚠️ THE ORDER IS PART OF THE VALUE. Toned to pastel, two neighbouring
  // fills that are too alike read as one colour twice (green above teal did
  // exactly that). So neighbours must be measurably apart — navOrder.test.ts
  // computes the CIE76 distance of the real pastels from _candy.scss and
  // wants ≥ 20 — and the two red-ish fills (pink, coral) never touch:
  //
  //   sea · pink · gold  —  separator  —  orchid · kraft
  //
  // (Since 2026-11-14. Stats stands before Folders on purpose: gold next to
  // kraft measured ΔE 18.5 in the Lagune scheme, under the 20 the rule asks.
  // Phone bar: sea · coral · gold · pink · kraft.)
  //
  // (2026-10-04, user picks: Home takes the doodle teal, Favorites gold,
  // Folders the folder kraft, Stats the doodle orchid.) This replaced a
  // warm/cool alternation rule, which stood for the same intent but could
  // no longer be met by these colours.
  //
  // Moving an entry means checking its new neighbours, not just its own fill.
  tint?: string;
}

const folder = {
  name: "folders",
  route_name: Routes.folder,
  params: { path: "$home" },
  icon: FolderSvg,
  tint: "tint-kraft",
};

const favorites = {
  name: "favorites",
  route_name: Routes.favorites,
  icon: BookmarkSvg,
  tint: "tint-gold",
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
  // The doodle teal (the background art's own colour): home is where the app
  // starts. Blush moved out of this list entirely — it is the hover colour now,
  // and a row that wears its own hover state permanently reads as broken.
  tint: "tint-sea",
};

const search = {
  name: "search",
  route_name: Routes.search,
  params: { page: "top" },
  query: () => ({ q: useSearch().query }),
  icon: SearchSvg,
  tint: "tint-coral",
};

const stats = {
  name: "stats",
  route_name: Routes.Stats,
  icon: ChartSvg,
  tint: "tint-orchid",
};

// Albums and Artists were sidebar entries from 2026-10-04 to 2026-11-14 (the
// user's test). They are reached from Home's Browse Library block again, on
// every screen, and the list pages name themselves (AlbumListView/ListHeader).

// ZIELE oben, WERKZEUGE unten — das ist die Bedeutung des Trenners.
//
// Oben stehen die Orte, an die man WILL (Start, die eigenen Listen, das
// Gemerkte); unten das Stöbern im Dateibaum plus die Statistik als
// Gelegenheitsbesuch.
//
// Seit 2026-11-14 (Nutzer) schlanker: Albums und Artists sind wieder Unterseiten
// von Home (Browse Library), und die Suche steht am Desktop nur noch in der
// Top-Bar — ein zweiter Eintrag dafür war doppelt. Vorher stand der Trenner zwischen zwei Gruppen, die
// niemand benennen konnte (`home · folders · search` gegen `favorites ·
// playlists · stats`) — und Playlists, eines der häufigsten Ziele, lag an
// fünfter Stelle hinter zwei Werkzeugen.
//
// Diese Liste ist die SEITENLEISTE. Das Telefon hat seine eigene, unten.
//
// (`MobileNav.vue` liest diese Liste ebenfalls, hat aber keinen Aufrufer —
// toter Code, der beim Suchen in die Irre führt.)
export const menus: NavItem[] = [
  home,
  playlists,
  favorites,
  {
    separator: true,
  },
  stats,
  folder,
];

// Die Navigationszeile am Telefon: fünf Plätze, eigene Reihenfolge
// (Nutzerentscheidung 2026-10-24).
//
// Am Telefon gibt es keine Seitenleiste, die Suche ist also nicht „ein
// Werkzeug unter dem Trenner", sondern der zweithäufigste Weg in die
// Bibliothek — und stand dort bisher an vierter Stelle. Deshalb direkt hinter
// Home, mittig unter dem Daumen. Albums, Artists und Stats haben hier keinen
// Platz; Albums und Artists sind über Homes Browse-Library-Block erreichbar
// (seit 2026-11-14 auch am Desktop der einzige Weg), Stats über das
// Konto-Menü am Avatar (seit 2026-11-26, nur am Telefon; nav/ProfileDropdown.vue).
//
// Früher war das keine eigene Liste, sondern `menus` mit per CSS
// ausgeblendeten Einträgen (`phoneHidden`, `:last-child`). Damit hing die
// Telefon-Reihenfolge an der Seitenleiste, und jede Umsortierung dort
// entschied stillschweigend mit, was am Telefon erscheint.
//
// ⚠️ Auch hier gilt die Farbregel (navOrder.test.ts): Favoriten (Gold) steht
// zwischen Suche (Koralle) und Playlists (Pink), damit die beiden Rottöne
// sich nicht berühren.
export const phoneMenus: NavItem[] = [home, search, favorites, playlists, folder];
