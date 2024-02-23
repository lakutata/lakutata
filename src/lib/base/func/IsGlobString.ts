import isGlob from 'is-glob'

export function IsGlobString(inp: string): boolean {
    return isGlob(inp)
}
