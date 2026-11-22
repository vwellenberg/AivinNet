import { SettingType } from "../enums";
import { Setting } from "@/interfaces/settings";

// The list itself is rendered by the custom component (SettingsView/Group.vue);
// this entry only carries the row's wording and its type.
const keyboard_shortcuts: Setting = {
  title: "Keyboard shortcuts",
  desc: "Every key the app answers to, and what it does.",
  type: SettingType.keyboard_shortcuts,
  state: null,
  action: () => undefined,
};

export default [keyboard_shortcuts];
