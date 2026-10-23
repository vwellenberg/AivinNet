export enum SettingType {
  separators_input,
  select,
  multiselect,
  binary,
  button,
  root_dirs,
  free_number_input,
  locked_number_input,
  // A slider with a live readout (tile size).
  range,
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
  // Settings → Home: show, hide and order the rows (#532).
  home_rows,
  // Settings → Home: the albums and artists marked "Not interested" (#531).
  home_not_interested,
}
