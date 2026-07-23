import isGlob from 'is-glob'

/**
 * Whether a string is glob string or not
 * @param inp
 * @constructor
 */
export function IsGlobString(inp: string): boolean {
    return isGlob(inp)
}
