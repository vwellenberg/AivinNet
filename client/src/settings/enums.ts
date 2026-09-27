export enum SettingType {
  separators_input,
  select,
  multiselect,
  binary,
  button,
  root_dirs,
  free_number_input,
  locked_number_input,
  // Native <select>: for lists too long for the segmented `select` (hours, zones).
  dropdown,

  // custom components 👇
  quick_actions,
  profile,
  accounts,
  pairing,
  about,
  backup,
  secretinput,
}
