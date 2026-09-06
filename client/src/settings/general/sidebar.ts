import { SettingType } from "../enums";
import { Setting } from "@/interfaces/settings";

import useSettingsStore from "@/stores/settings";

const settings = useSettingsStore;

const use_sidebar: Setting = {
  title: "Toggle right sidebar",
  desc: "CTRL + B",
  type: SettingType.binary,
  state: () => settings().use_sidebar,
  action: () => settings().toggleDisableSidebar(),
};

const move_played_playlist_to_top: Setting = {
  title: "Move recently played playlist to top",
  desc: "Playing a playlist moves it to the top of its section in the library sidebar",
  type: SettingType.binary,
  state: () => settings().move_played_playlist_to_top,
  action: () => settings().toggleMovePlayedPlaylistToTop(),
};

export default [use_sidebar, move_played_playlist_to_top];
