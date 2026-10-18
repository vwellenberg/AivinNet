import { SettingType } from "@/settings/enums";

export interface SettingOption {
  title: string;
  value: any;
}

export interface Setting {
  title?: string;
  desc?: string;
  type: SettingType;
  options?: SettingOption[];
  inactive?: () => boolean;
  action: (arg0?: any) => any;
  state: (() => any) | null;
  button_text?: () => string;
  defaultAction?: () => void;
  show_if?: () => boolean;
  experimental?: boolean;
  new?: boolean;
  // SettingType.range: the slider's bounds and how its value is printed.
  range?: { min: number; max: number; step: number; format?: (value: number) => string };
  // Hold the settings modal see-through while the control is held, so the page
  // behind it can be judged live (utils/settingsPeek.ts).
  peek?: boolean;
  // A small in-row preview under the control, for when the page behind has
  // nothing to show.
  preview?: "tiles";
}

export interface SettingGroup {
  title?: string;
  desc?: string;
  settings: Setting[];
  show_if?: () => boolean;
  experimental?: boolean;
  icon?: string;
}

export interface SettingCategory {
  title: string;
  groups: SettingGroup[];
  show_if?: () => boolean;
}
