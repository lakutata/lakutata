/**
 * The global symbol the packed applications (the bundles and the executables of lakutata) are given by their first
 * code: the directory of their resources
 */
const PACKAGED: symbol = Symbol.for('lakutata.packaged')

/**
 * What a packed application is given
 */
type Packaged = {
    /**
     * The directory of the resources of the application, its files extracted first in a single executable
     */
    resources(): string
}

/**
 * Tell whether the application runs packed: bundled by `lakutata package bundle`, or inside a single executable built by
 * `lakutata package exe`.
 * @returns `true` when packed, `false` when it runs from its sources or its build (in development).
 * @example
 * ```typescript
 * import {isPackaged} from 'lakutata'
 *
 * //The updates are only checked by the released builds
 * if (isPackaged()) console.log('Running the released build')
 * ```
 */
export function isPackaged(): boolean {
    return !!(globalThis as Record<symbol, unknown>)[PACKAGED]
}

/**
 * Get the directory of the resources of a packed application: the files declared by the `lakutata.resources` field of
 * its package.json, at their `to` paths (extracted first when it runs in a single executable).
 * @returns The absolute path of the directory, or `undefined` when the application does not run packed: it then locates
 * its resources itself (in development, the directory they are built in).
 * @example
 * ```typescript
 * import path from 'node:path'
 * import {resourcesPath} from 'lakutata'
 *
 * //The web UI served by the application: its packed copy, or its build in development
 * const resources: string | undefined = resourcesPath()
 * const ui: string = resources ? path.join(resources, 'ui') : path.resolve('ui', 'dist')
 * ```
 */
export function resourcesPath(): string | undefined {
    return ((globalThis as Record<symbol, unknown>)[PACKAGED] as Packaged | undefined)?.resources()
}
