import {PathLike, constants} from 'fs'
import {access} from 'node:fs/promises'

/**
 * Tell whether a file or a directory exists at a path. A path which cannot be checked (a parent directory without
 * permission) is reported as missing; a symbolic link is followed, so a broken link is missing too.
 * @param path The path: a string (relative to the current working directory), a `Buffer` or a `file:` URL.
 * @returns A promise of `true` when the path exists, `false` otherwise; it never rejects.
 * @example
 * ```typescript
 * import {PathExists} from 'lakutata/utils'
 *
 * if (!(await PathExists('./config.json'))) console.log('No configuration file, using the defaults')
 * ```
 */
export async function PathExists(path: PathLike): Promise<boolean> {
    try {
        await access(path, constants.F_OK)
        return true
    } catch (e) {
        return false
    }
}
