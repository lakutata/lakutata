import nextModule from 'next'
import type {IncomingMessage, Server, ServerResponse} from 'node:http'
import type {Duplex} from 'node:stream'
import {fileURLToPath} from 'node:url'

export type RenderOptions = {
    /**
     * Compile the pages on demand, with the hot reload (development)
     */
    dev?: boolean
}

/**
 * The handler of the pages: given as the fallback of the express adapter, the paths of the actions are not given to it
 */
export type UIHandler = ((request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void) => void) & {
    /**
     * Give the upgrades of the connections of next (the hot reload) to it
     * @param server
     */
    attach(server: Server): void
}

/**
 * The function creating a Next.js server: next is a CommonJS module, its default export is the function
 */
const createNextServer: typeof nextModule.default = (nextModule as unknown as { default?: typeof nextModule.default }).default ?? (nextModule as unknown as typeof nextModule.default)

/**
 * The Next.js application of the ui package, served by the service
 * @param options
 */
export default function renderUI(options: RenderOptions = {}): UIHandler {
    const application = createNextServer({dev: options.dev ?? false, dir: fileURLToPath(new URL('../../', import.meta.url))})
    //Prepared once: in development it compiles, on the path of a request the first one would time out
    const prepared: Promise<void> = application.prepare()
    const handle = application.getRequestHandler()
    const handler = ((request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void): void => {
        prepared.then((): Promise<void> => handle(request, response)).catch(next)
    }) as UIHandler
    handler.attach = (server: Server): void => {
        server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
            if (!request.url?.startsWith('/_next/')) return
            prepared.then((): unknown => application.getUpgradeHandler()(request, socket, head)).catch((): unknown => socket.destroy())
        })
    }
    return handler
}
