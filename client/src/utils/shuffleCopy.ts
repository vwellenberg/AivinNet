/**
 * A shuffled copy of `items` (Fisher-Yates), leaving the input as it was. The
 * random source is a parameter so a test can make the order fixed.
 */
export function shuffledCopy<T>(items: readonly T[], random: () => number = Math.random): T[] {
    const out = [...items]
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
}
