import {PathLike} from 'node:fs'
import {As} from './As.js'

/**
 * Whether input string is path or not
 * @param inp
 * @constructor
 */
export function IsPath(inp: string | PathLike): boolean {
    try {
        const pathRegex: RegExp = new RegExp('^(\\/|\\.\\.?\\/|([A-Za-z]:)?\\\\)([^\\\\\\/:*?"<>|\\r\\n]+[\\\\\\/])*[^\\\\\\/:*?"<>|\\r\\n]*$')
        return pathRegex.test(As<string>(inp))
    } catch (e) {
        return false
    }
}
