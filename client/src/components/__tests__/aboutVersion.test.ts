import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// ONE PRODUCT VERSION, AND IT IS THE RELEASE.
//
// Two version numbers meet in this pane, and they follow different schemes:
//
//   the RELEASE      CalVer, e.g. 2026.9.0 — what a user downloaded, reported
//                    by the server (settings store)
//   the WEB CLIENT   SemVer, e.g. 1.7.50 — a build number from package.json,
//                    bumped by hand because the client is deployed on its own
//
// They used to sit the other way round: the client's number in bold as "AivinNet
// v1.7.50", the release small underneath as "Server v…". Someone installing
// release v2026.9.0 therefore read a completely different number in the app —
// and the one that matters for "which version do I have?" was the small one.
// ---------------------------------------------------------------------------

const ABOUT = readFileSync("src/components/SettingsView/About.vue", "utf-8");

describe("About: versions", () => {
  it("shows the release as THE version", () => {
    expect(ABOUT).toMatch(/class="version">AivinNet\{\{ settings\.version/);
  });

  it("does not put the client's build number in that line", () => {
    const headline = /class="version">[^<]*/.exec(ABOUT)?.[0] ?? "";
    expect(headline).not.toContain("clientVersion");
  });

  it("keeps the client build visible, named for what it is", () => {
    // The client is deployed separately here, so its number answers "did my
    // deploy land?" — it just must not pose as the product version.
    expect(ABOUT).toMatch(/class="build">Web client build \{\{ clientVersion \}\}/);
  });
});
