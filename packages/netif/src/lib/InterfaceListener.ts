import {Server as HTTPServer} from 'node:http'
import {createServer, type Server, type Socket} from 'node:net'
import type {IInterfaceListener} from '@lakutata/core'
import {NetIfNotSupportedException} from '../exceptions/NetIfNotSupportedException.js'
import {Attachment, type Target} from './Attachment.js'
import {type Family} from './Enforcement.js'
import {type NetworkInterface} from './NetworkInterface.js'

/**
 * The options of `listen()`.
 */
export interface ListenOptions {
    /**
     * The port. 0: one the system chooses, kept when the interface is listened on again.
     */
    port: number

    /**
     * The families listened on: `'IPv4'`, `'IPv6'` or `'both'` (by default). With `'both'`, a system without IPv6 is
     * listened on in IPv4.
     */
    family?: 'IPv4' | 'IPv6' | 'both'

    /**
     * `true`: the listening is refused (a `NetIfNotEnforcedException`) where the system cannot refuse the connections
     * reaching the addresses of the interface through another interface, and it stops while that guarantee is lost.
     * `false` by default: the best the system allows, told by `enforced`.
     */
    strict?: boolean

    /**
     * The length of the queue of the connections not accepted yet, 511 by default.
     */
    backlog?: number
}

/**
 * The events of an `InterfaceListener` and their arguments.
 */
export interface InterfaceListenerEvents {
    /**
     * The interface is listened on, after `listen()` and each time it is listened on again (an address added, the
     * interface plugged back).
     */
    listening: []

    /**
     * An error of a listening again (the port taken meanwhile…), retried a little later; with `strict`, the guarantee
     * lost (a `NetIfNotEnforcedException`). Without a listener of `error`, the error is thrown, as for a `net.Server`.
     */
    error: [error: Error]

    /**
     * Whether the connections coming through another interface are refused changed: its new value.
     */
    enforced: [enforced: boolean]

    /**
     * The listener was closed.
     */
    close: []
}

/**
 * Bun 1.4: whether its http server is an https one (Bun's https.Server is its http.Server, which answers a connection
 * given to it in plain HTTP even when it was made with keys: the connections of an https server cannot be given to it).
 * An internal symbol tells: its TLS options, null for a plain server; undefined when Bun has no such symbol.
 */
function bunTLS(server: Server): boolean | undefined {
    const symbol: symbol | undefined = Object.getOwnPropertySymbols(server).find((candidate: symbol): boolean => candidate.description === 'tls')
    if (!symbol) return undefined
    return !!(server as unknown as Record<symbol, unknown>)[symbol]
}

/**
 * The listening of a server on a network interface: `NetworkInterface.listen()`. The listener accepts the connections
 * and gives them to the server (`server.emit('connection', socket)`), which handles them as its own: the server itself
 * does not listen (its `address()` is `null`, its `close()` does not stop the listener; use the ones of the listener).
 * The interface is listened on again when its addresses change and when it is unplugged and plugged back; the
 * connections established are left to the server. It implements `IInterfaceListener` of `@lakutata/core`.
 * @example
 * ```typescript
 * import {createServer} from 'node:http'
 * import {type InterfaceListener, NetworkInterface} from '@lakutata/netif'
 *
 * const server = createServer((request, response) => response.end('ok'))
 * const listener: InterfaceListener = await new NetworkInterface('eth1').listen(server, {port: 8080})
 * console.log(listener.enforced, listener.addresses)
 * listener.on('error', error => console.error(error))
 * await listener.close()
 * ```
 */
export class InterfaceListener extends Attachment<InterfaceListenerEvents, Server> implements IInterfaceListener {

    /**
     * The server the connections are given to.
     */
    public readonly server: Server

    protected readonly stream: boolean = true

    readonly #backlog: number

    /**
     * Internal: made by `NetworkInterface.listen()` and `listenOn()`; `start()` listens.
     * @param networkInterface The interface.
     * @param server The server.
     * @param options The options of `listen()`.
     * @param ownsInterface Whether the interface is closed with the listener (`listenOn()`).
     */
    constructor(networkInterface: NetworkInterface, server: Server, options: ListenOptions, ownsInterface: boolean = false) {
        if (!server || typeof server.emit !== 'function') throw new TypeError('listen() takes a net.Server (http, https, http2, tls…)')
        if (process.versions.bun && server instanceof HTTPServer && bunTLS(server) !== false) {
            throw new NetIfNotSupportedException(bunTLS(server)
                ? 'The https server of Bun answers the connections given to it without TLS: in Bun, listen with http2.createSecureServer({key, cert, allowHTTP1: true}) or a tls.Server instead'
                : 'Whether this server of Bun uses TLS cannot be told, and the https server of Bun answers the connections given to it without TLS: in Bun, listen with an http server of a known version, http2.createSecureServer() or a tls.Server')
        }
        super(networkInterface, options, ownsInterface)
        this.server = server
        this.#backlog = options.backlog ?? 511
    }

    /**
     * Listens on the target: a server of the listener, the connections it accepts given to the server of the user
     */
    protected openHandle(target: Target, _family: Family): Promise<Server> {
        const settings: {allowHalfOpen?: boolean, pauseOnConnect?: boolean} = this.server as unknown as {allowHalfOpen?: boolean, pauseOnConnect?: boolean}
        const inner: Server = createServer({allowHalfOpen: !!settings.allowHalfOpen, pauseOnConnect: !!settings.pauseOnConnect, noDelay: true}, (socket: Socket): void => {
            this.server.emit('connection', socket)
        })
        if (typeof this.server.maxConnections === 'number') inner.maxConnections = this.server.maxConnections
        return new Promise((resolve: (server: Server) => void, reject: (error: Error) => void): void => {
            const failed = (error: Error): void => {
                inner.off('listening', listened)
                inner.close()
                reject(error)
            }
            const listened = (): void => {
                inner.off('error', failed)
                //Later errors of the socket: the ones of the listener
                inner.on('error', (error: Error): void => this.failed(error))
                resolve(inner)
            }
            inner.once('error', failed)
            inner.once('listening', listened)
            if ('fd' in target) {
                inner.listen({fd: target.fd, backlog: this.#backlog})
            } else {
                inner.listen({host: target.host, port: target.port, backlog: this.#backlog, exclusive: true})
            }
        })
    }

    protected portOf(handle: Server): number | undefined {
        const address: unknown = handle.address()
        return address && typeof address === 'object' ? (address as {port: number}).port : undefined
    }

    protected closeHandle(handle: Server): void {
        handle.close()
    }
}
