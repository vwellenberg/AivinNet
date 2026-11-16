import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import Avatar from "@/components/shared/Avatar.vue";

// The settings list shows the user's picture and, when it fails to load, its
// own profile glyph — not the generated gradient avatar, which read as a
// placeholder. Everyone else keeps the generated one.
describe("Avatar fallback", () => {
  it("renders the host's fallback slot when the picture fails", async () => {
    const wrapper = mount(Avatar, {
      props: { name: "vw", size: 24, image: "vw.webp" },
      slots: { fallback: '<span class="stand-in">glyph</span>' },
    });
    expect(wrapper.find("img.avatar-image").exists()).toBe(true);

    await wrapper.find("img").trigger("error");

    expect(wrapper.find(".stand-in").exists()).toBe(true);
    expect(wrapper.find("img.avatar-image").exists()).toBe(false);
  });

  it("keeps the generated avatar without a fallback slot", async () => {
    const wrapper = mount(Avatar, { props: { name: "vw", size: 24 } });
    expect(wrapper.find("svg").exists()).toBe(true);
    expect(wrapper.find(".stand-in").exists()).toBe(false);
  });
});
