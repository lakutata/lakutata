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
 * Whether the application runs packed: bundled (lakutata package bundle) or in an executable (lakutata package exe)
 */
export function IsPackaged(): boolean {
    return !!(globalThis as Record<symbol, unknown>)[PACKAGED]
}

/**
 * The directory of the resources of a packed application (the "lakutata.resources" of its package.json, by their "to"),
 * undefined when it does not run packed: the application gives its own then (in development, the directory they are
 * built in)
 * @example
 * const ui: string = ResourcesPath() ? path.join(ResourcesPath()!, 'ui') : path.join(uiPackage, 'dist')
 */
export function ResourcesPath(): string | undefined {
    return ((globalThis as Record<symbol, unknown>)[PACKAGED] as Packaged | undefined)?.resources()
}
