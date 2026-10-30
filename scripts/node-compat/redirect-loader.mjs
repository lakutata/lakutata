// The imports of the packages test.mjs redirects (--redirect), resolved from the directories given for them: see
// redirect.cjs

import path from 'node:path'
import {pathToFileURL} from 'node:url'

/**
 * The URL each package is resolved from: a module in the directory given for it
 */
const parents = Object.entries(JSON.parse(process.env.NODE_COMPAT_REDIRECT || '{}')).map(([name, directory]) => [name, pathToFileURL(path.join(directory, 'index.js')).href])

export async function resolve(specifier, context, next) {
    const redirected = parents.find(([name]) => specifier === name || specifier.startsWith(`${name}/`))
    return next(specifier, redirected ? {...context, parentURL: redirected[1]} : context)
}
