//Self-implemented (replaces the `is-glob` package dependency).

const GLOB_RE = /(?:^|[^\\])[*?]|\[[^\]]+\]|\{[^}]+\]/

/**
 * Whether a string is glob string or not
 * @param inp
 * @constructor
 */
export function IsGlobString(inp: string): boolean {
    return GLOB_RE.test(inp)
}
