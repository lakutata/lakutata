import {existsSync} from 'node:fs'
import {fileURLToPath, pathToFileURL} from 'node:url'

/**
 * The request listener of the build of Nitro (preset node-listener)
 */
const entry = fileURLToPath(new URL('../.output/server/index.mjs', import.meta.url))

/**
 * The Nuxt application of the ui package, served by the service: undefined until it is built (in development, nuxt dev serves it)
 * @returns {((request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse, next: (error?: unknown) => void) => void) | undefined}
 */
export default function renderUI() {
    if (!existsSync(entry)) return undefined
    const loaded = import(pathToFileURL(entry).href).then((module) => module.listener)
    return (request, response, next) => {
        loaded.then((listener) => listener(request, response)).catch(next)
    }
}
