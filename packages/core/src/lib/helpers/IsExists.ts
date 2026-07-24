import {PathLike, constants} from 'fs'
import {access} from 'node:fs/promises'

/**
 * Returns `true` if the path exists, `false` otherwise.
 * @param path
 * @constructor
 */
export async function IsExists(path: PathLike): Promise<boolean> {
    try {
        await access(path, constants.F_OK)
        return true
    } catch (e) {
        return false
    }
}
