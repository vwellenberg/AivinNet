/**
 * Display helpers for a folder row on the folder page (FolderItem.vue).
 *
 * Libraries are often sorted by a numeric prefix — `025-AI`, `100-Musicians`,
 * `950-Hörbücher`. As one string the prefix is the loudest part of the name,
 * and in a column of them every row starts with the same three digits of
 * noise. Split, the number becomes a small ordinal above the name, and the
 * name itself reads first.
 */
export interface FolderLabel {
  /** The numeric prefix, or "" when the name has none. */
  ordinal: string
  /** What is left to read, with underscores shown as spaces. */
  title: string
}

// Digits, then at least one separator, then something left over. A name that
// IS a number ("2024") or ends at the separator ("025-") keeps its full text —
// splitting it would leave an empty title.
const ORDINAL = /^(\d+)[-_ .]+(.+)$/

export function folderLabel(name: string): FolderLabel {
  const match = ORDINAL.exec(name)
  if (!match) return { ordinal: '', title: name.replace(/_/g, ' ') }
  return { ordinal: match[1], title: match[2].replace(/_/g, ' ') }
}

/** Narrowest gauge fill in percent, so a folder with one file still shows one. */
export const FOLDER_GAUGE_MIN = 6

/**
 * How full a folder's size gauge is, 0–100, relative to the biggest folder in
 * the same list.
 *
 * LOGARITHMIC, because folder sizes span orders of magnitude: on a real
 * library the list ran from 3 to 7,662 files, and on a linear scale everything
 * but the biggest folder collapsed to a sliver. On a log scale 30, 300 and
 * 3,000 files are three clearly different steps — which is the question the
 * gauge answers ("small, medium or huge?"), not the exact ratio.
 *
 * An empty folder (or an unknown count) has no gauge at all: 0.
 */
export function folderGauge(count: number, max: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0
  if (!Number.isFinite(max) || max <= 0) return 100
  const share = Math.log(count + 1) / Math.log(Math.max(max, count) + 1)
  return Math.round(Math.max(FOLDER_GAUGE_MIN, Math.min(100, share * 100)))
}
