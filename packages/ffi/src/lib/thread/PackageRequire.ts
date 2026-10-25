/**
 * The require of the package (createRequire(import.meta.url) in the ES modules, require in CommonJS), written by the
 * build (scripts/worker.mjs) in place of this one: it resolves koffi for the worker threads, from the package (in a
 * packed application, from its native tree)
 */
export const packageRequire: NodeJS.Require | undefined = undefined
