// Ambient typings for the untyped '@nextcss/color-tools' package.
// Only the members actually imported in this codebase are declared.
declare module '@nextcss/color-tools' {
    export function brightness(color: string): number
    export function colorShift(color: string, amount: number): string
}
