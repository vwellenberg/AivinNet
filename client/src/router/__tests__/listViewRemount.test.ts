import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

import { router, Routes } from "@/router";

// Albums and Artists are one component on two routes. It chooses its store in
// setup from the route name, and Vue Router reuses a component instance when
// only the route changes — so Albums -> Artists kept showing albums under the
// Artists entry until something else re-rendered (reported 2026-10-05, after
// both went into the navigation). The fix: both routes carry `meta.remount`,
// and App.vue keys the routed view by route name for such routes.

describe("album/artist list views get their own instance", () => {
  it("both routes ask for a remount", () => {
    for (const name of [Routes.AlbumList, Routes.ArtistList]) {
      const record = router.getRoutes().find(r => r.name === name);
      expect(record, name).toBeDefined();
      expect(record!.meta.remount, name).toBe(true);
    }
  });

  it("App.vue keys the routed view by name for exactly those routes", () => {
    const app = readFileSync("src/App.vue", "utf-8");
    expect(app).toMatch(/<RouterView v-slot="\{ Component, route \}">/);
    expect(app).toContain(':key="route.meta.remount ? route.name : undefined"');
  });
});
