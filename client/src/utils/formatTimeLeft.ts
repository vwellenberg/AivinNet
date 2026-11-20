/**
 * How long is left, in words that fit a subtitle: "38 min", "1 h 12 min", "2 h".
 *
 * Whole minutes, never "0 min": anything left reads as at least a minute.
 * Returns "" for nothing (or no number), so a caller can drop the part.
 */
export default function formatTimeLeft(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return "";

  const minutes = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;

  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
