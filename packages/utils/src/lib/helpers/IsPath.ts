import {PathLike} from 'node:fs'
import {As} from './As.js'

/**
 * Tell whether a string is written as an explicit file system path, by its syntax only (the path is not looked up): an
 * absolute POSIX path (`/usr/bin`), a path relative to the current or the parent directory (`./a`, `../a/b`), or a
 * Windows path starting with `\` or with a drive and `\` (`C:\Windows`). A bare relative path (`a/b`, `file.txt`), a
 * home path (`~/x`), a drive with `/` (`C:/x`), a UNC path (`\\server\share`) and a URL are not, nor a path with a
 * character among `: * ? " < > |` or a line break after its start.
 * @param inp The value to test: a string, or a `Buffer` (read as its string, as `node:fs` accepts a `Buffer` path); a
 * `URL` gives `false`.
 * @returns `true` when the value has the syntax of an explicit path, `false` otherwise.
 * @example
 * ```typescript
 * import {IsPath} from 'lakutata/utils'
 *
 * console.log(IsPath('/var/log'), IsPath('./config.json'), IsPath('config.json'), IsPath('https://example.com'))
 * //true true false false
 * ```
 */
export function IsPath(inp: string | PathLike): boolean {
    try {
        const pathRegex: RegExp = new RegExp('^(\\/|\\.\\.?\\/|([A-Za-z]:)?\\\\)([^\\\\\\/:*?"<>|\\r\\n]+[\\\\\\/])*[^\\\\\\/:*?"<>|\\r\\n]*$')
        return pathRegex.test(As<string>(inp))
    } catch (e) {
        return false
    }
}
