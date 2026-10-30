// Preloaded by the tests test.mjs runs with --redirect: the packages it names are loaded from the directories given for
// them (their node_modules, installed by the node program running the tests) instead of the ones of the repository,
// built for its Node.js (better-sqlite3) or written for a newer one. require is redirected here, import by
// redirect-loader.mjs.

const Module = require('node:module')
const path = require('node:path')

/**
 * The module each package is resolved from: one in the directory given for it
 */
const parents = new Map(Object.entries(JSON.parse(process.env.NODE_COMPAT_REDIRECT || '{}')).map(([name, directory]) => {
    const parent = new Module(path.join(directory, 'index.js'))
    parent.filename = path.join(directory, 'index.js')
    parent.paths = Module._nodeModulePaths(directory)
    return [name, parent]
}))

/**
 * The module a request is resolved from when it names a redirected package
 * @param request
 */
function parentOf(request) {
    for (const [name, parent] of parents) if (request === name || request.startsWith(`${name}/`)) return parent
    return undefined
}

const resolveFilename = Module._resolveFilename
Module._resolveFilename = function (request, from, ...rest) {
    return resolveFilename.call(this, request, parentOf(request) ?? from, ...rest)
}
