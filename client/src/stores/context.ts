import { createPopper, VirtualElement } from "@popperjs/core";
import { defineStore } from "pinia";
import { ContextSrc } from "../enums";
import { Option } from "../interfaces";

function generateGetBoundingClientRect(x = 0, y = 0) {
  return () => ({
    width: 0,
    height: 0,
    top: y,
    right: x,
    bottom: y,
    left: x,
  });
}

export default defineStore("context-menu", {
  state: () => ({
    visible: false,
    options: {} as Option[],
    src: <null | ContextSrc>"",
    elem: <HTMLElement | null>null,
  }),
  actions: {
    showContextMenu(
      e: MouseEvent,
      getContextOptions: () => Promise<Option[]> | Option[],
      src: ContextSrc
    ) {
      if (this.visible) {
        this.hideContextMenu();
        return;
      }

      if (this.elem === null) {
        this.elem = document.getElementById("context-menu");
      }

      const virtualElement = {
        getBoundingClientRect: generateGetBoundingClientRect(e.x, e.y),
      } as VirtualElement;

      // Promise.resolve so plain-array getters work too — a sync getter used
      // to throw (".then is not a function") and silently show an empty menu.
      Promise.resolve(getContextOptions())
        .then((options) => {
          this.options = options;
        })
        .then(() => {
          createPopper(virtualElement, this.elem as HTMLElement, {
            placement: "right-start",
            modifiers: [
              {
                name: "flip",
                options: {
                  fallbackPlacements: ["left-start"],
                },
              },
            ],
            onFirstUpdate: () => {
              this.visible = true;
              this.src = src;
            },
          });
        });
    },
    hideContextMenu() {
      this.visible = false;
      this.src = null;
      this.options = [];
      this.elem ? (this.elem.style.transform = "scale(0)") : null;
    },
  },
});
