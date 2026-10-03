import type nextModule from 'next'
import {readFileSync} from 'node:fs'
import type {IncomingMessage, Server, ServerResponse} from 'node:http'
import {createRequire} from 'node:module'
import path from 'node:path'
import type {Duplex} from 'node:stream'
import {fileURLToPath} from 'node:url'

export type RenderOptions = {
    /**
     * Compile the pages on demand, with the hot reload (development)
     */
    dev?: boolean
    /**
     * The standalone build of next (.next/standalone, made by npm run build): the one in the resources of the application
     * packed (lakutata package exe), which has next and what it loads; the ui package (and its next) by default
     */
    standalone?: string
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
 * The directory of the Next.js application: the one of the standalone build (written in its ui.json by
 * server/standalone.ts), or the ui package
 * @param options
 */
function Directory(options: RenderOptions): string {
    if (!options.standalone) return fileURLToPath(new URL('../../', import.meta.url))
    const {dir} = JSON.parse(readFileSync(path.join(options.standalone, 'ui.json'), 'utf8')) as { dir: string }
    return path.join(options.standalone, dir)
}

/**
 * The Next.js application of the ui package, served by the service
 * @param options
 */
export default function renderUI(options: RenderOptions = {}): UIHandler {
    const dir: string = Directory(options)
    //Required from the application: the one of the standalone build is not bundled with the service
    const createNextServer = createRequire(path.join(dir, 'package.json'))('next') as typeof nextModule.default
    //The configuration of the standalone build is the one it was built with (next.config.ts is not in it)
    const conf = options.standalone ? JSON.parse(readFileSync(path.join(dir, '.next', 'required-server-files.json'), 'utf8')).config : undefined
    if (conf) process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(conf)
    const application = createNextServer({dev: !options.standalone && (options.dev ?? false), dir: dir, conf: conf})
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
