/**
 * Whether a version (`'7.2.4'`, `'v2.10.3'`, `'2.11.0-beta.1'`) is at least another one (`'5.0'`); the parts missing
 * count as 0, the text after a number is ignored
 * @param version The version found.
 * @param minimum The version needed.
 */
export function versionAtLeast(version: string, minimum: string): boolean {
    const parts = (value: string): number[] => value.replace(/^v/i, '').split('.').map((part: string): number => parseInt(part, 10) || 0)
    const found: number[] = parts(version)
    const needed: number[] = parts(minimum)
    for (let index: number = 0; index < Math.max(found.length, needed.length); index++) {
        const difference: number = (found[index] ?? 0) - (needed[index] ?? 0)
        if (difference) return difference > 0
    }
    return true
}
