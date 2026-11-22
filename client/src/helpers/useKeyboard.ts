import useQueue from "@/stores/queue";
import useModal from "@/stores/modal";
import useContextMenu from "@/stores/context";
import useSettings from "@/stores/settings";
import { controlOwnsKey, focusCameFromKeyboard, trackFocusOrigin } from "@/utils/keyOwnership";
import { handleFindShortcut } from "@/utils/pageFind";
import { isQuickPlayShortcut, openQuickPlay } from "@/stores/quickPlay";
import { closeShortcutsHelp, shortcutsHelpOpen, toggleShortcutsHelp } from "@/stores/shortcutsHelp";

let key_down_fired = "";

function resetKeyFired() {
  key_down_fired = "";
}

export default function (queue: typeof useQueue, modal: typeof useModal) {
  const q = queue();
  trackFocusOrigin();

  window.addEventListener("keydown", (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;

    // Before the input check: Cmd/Ctrl+F inside the page's own search field
    // selects it again rather than opening the browser's find over it. Not while
    // the shortcut list is up: the page's search would take focus behind it.
    if (!shortcutsHelpOpen.value && handleFindShortcut(e)) return;

    // Quick play (Ctrl/Cmd+P): also before the input check, so it works while a
    // text field has focus. preventDefault suppresses the browser's print dialog.
    // Not over a modal (the login after a 401, a dialog mid-edit): the box would
    // sit on top of it. The print dialog stays suppressed either way.
    if (isQuickPlayShortcut(e)) {
      e.preventDefault();
      if (!modal().visible && !shortcutsHelpOpen.value) openQuickPlay();
      return;
    }

    if (e.altKey) return;
    const ctrlKey = e.ctrlKey;
    const shiftKey = e.shiftKey;

    const no_text_selection = !window.getSelection()?.toString();

    function focusedOnInput() {
      const targett = target as HTMLInputElement;

      return (
        (targett.tagName === "INPUT" && targett.type !== "range") ||
        targett.tagName === "TEXTAREA"
      );
    }

    function triggerSeek() {
      if (shiftKey) return false;
      if (ctrlKey) return true;
    }

    if (focusedOnInput()) {
      if (e.key == "Escape") {
        target.blur();
      }

      return;
    }

    // The shortcut list is up. It answers Esc and ? and nothing else, so Space or
    // an arrow cannot play or seek behind it. Ctrl/Cmd combinations are not taken.
    if (shortcutsHelpOpen.value) {
      if (e.key === "Escape" || (e.key === "?" && !ctrlKey && !e.metaKey)) {
        closeShortcutsHelp();
      }
      return;
    }

    // A control the keyboard landed on keeps Space and Enter — see keyOwnership.ts
    // for why this used to break every button in the app.
    if (controlOwnsKey(target, e.key, focusCameFromKeyboard())) return;

    if (key_down_fired == e.key.toLowerCase()) {
      return;
    }

    function setKeyFired() {
      key_down_fired = e.key.toLowerCase();
    }

    switch (e.key.toLowerCase()) {
      case "arrowright":
        {
          const doSeek = triggerSeek();

          if (doSeek) {
            e.preventDefault();
            q.seek(q.duration.current + 10);
            return;
          }

          setTimeout(() => {
            // fire event after 1 second
            resetKeyFired();
          }, 1000);

          if (no_text_selection) {
            q.playNext();
          }
        }
        break;

      case "arrowleft":
        {
          const doSeek = triggerSeek();

          if (doSeek) {
            e.preventDefault();
            q.seek(q.duration.current - 10);
            return;
          }

          if (no_text_selection) {
            q.playPrev();
          }

          setTimeout(() => {
            resetKeyFired();
          }, 1000);
        }

        break;

      case " ": // space
        {
          e.preventDefault();
          q.playPause();
        }

        break;

      case "b": {
        if (!ctrlKey) return;
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();

        const { toggleDisableSidebar } = useSettings();
        toggleDisableSidebar();
        setKeyFired();
        break;
      }

      case "?": {
        // Shift is not refused: ? is Shift+/ on a US layout, Shift+ß on a German one.
        if (ctrlKey || e.metaKey) break;
        if (modal().visible) break;
        toggleShortcutsHelp();
        break;
      }

      case "escape": {
        const m = modal();
        const c = useContextMenu();

        if (m.visible) {
          m.hideModal();
        }

        if (c.visible) {
          c.hideContextMenu();
        }
      }
    }

    setKeyFired();
  });
}

window.addEventListener("keyup", () => {
  resetKeyFired();
});
