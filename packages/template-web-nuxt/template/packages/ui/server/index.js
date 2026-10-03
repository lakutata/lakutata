import {existsSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

/**
 * The build of Nitro of the ui package (preset node-listener)
 */
const OUTPUT = fileURLToPath(new URL('../.output', import.meta.url))

/**
 * The Nuxt application of the ui package, served by the service: undefined until it is built (in development, nuxt dev serves it)
 * @param {{output?: string}} [options] the build of Nitro: the one of the ui package by default, the one of the resources
 * of the application packed (lakutata executable)
 * @returns {((request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse, next: (error?: unknown) => void) => void) | undefined}
 */
export default function renderUI(options = {}) {
    const entry = path.join(options.output ?? OUTPUT, 'server', 'index.mjs')
    if (!existsSync(entry)) return undefined
    //Required (the ES modules of Node.js 22): the applications packed are CommonJS, which import no file
    const loaded = Promise.resolve().then(() => createRequire(entry)(entry).listener)
    return (request, response, next) => {
        loaded.then((listener) => listener(request, response)).catch(next)
    }
}
