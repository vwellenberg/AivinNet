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

      // ⚠️ A click the KEYBOARD produced (Enter/Space on a button) carries no
      // pointer position: x and y are 0, so the menu opened in the top-left
      // corner of the window, far from the control that opened it. Anchor it
      // under that control instead (#137).
      //
      // Keyed on the coordinates, NOT on `detail === 0`: a mouse `contextmenu`
      // event reports detail 0 as well, and that first version pinned every
      // right-click menu to the row's left edge — measured 303px against a
      // pointer at 700.
      let { x, y } = e;
      const source = (e.currentTarget ?? e.target) as Element | null;
      if (x === 0 && y === 0 && source instanceof Element) {
        const box = source.getBoundingClientRect();
        x = box.left;
        y = box.bottom;
      }

      const virtualElement = {
        getBoundingClientRect: generateGetBoundingClientRect(x, y),
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
