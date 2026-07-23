import {
    glob,
    GlobOptionsWithFileTypesUnset,
    GlobOptions,
    GlobOptionsWithFileTypesFalse,
    GlobOptionsWithFileTypesTrue
} from 'glob'
import {Path} from 'path-scurry'

/**
 * Match files using the patterns the shell uses
 * @constructor
 * @see https://github.com/isaacs/node-glob
 */
export async function Glob(pattern: string | string[], options?: GlobOptionsWithFileTypesUnset): Promise<string[]>
export async function Glob(pattern: string | string[], options: GlobOptionsWithFileTypesTrue): Promise<Path[]>
export async function Glob(pattern: string | string[], options: GlobOptionsWithFileTypesFalse): Promise<string[]>
export async function Glob(pattern: string | string[], options?: GlobOptions): Promise<Path[] | string[]> {
    return options ? await glob(pattern, options) : await glob(pattern)
}
