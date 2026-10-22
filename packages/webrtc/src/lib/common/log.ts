
export class WeriftError extends Error {
    message!: string
    payload?: object
    path?: string

    constructor(props: Pick<WeriftError, 'message' | 'payload' | 'path'>) {
        super(props.message)
    }

    toJSON() {
        return {
            message: this.message,
            payload: JSON.parse(JSON.stringify(this.payload)),
            path: this.path
        }
    }
}

/**
 * Receives the debug messages of the WebRTC implementation: the namespace of the module (`webrtc/ice/ice`,
 * `webrtc/sctp/sctp`…), then the arguments given to the logging function (a format string first, as with
 * `util.format`). The messages of the worker threads of a media server (`SFU` with `workers`) come already formatted,
 * as one string starting with the number of the thread (`[thread 0] …`).
 */
export type DebugHandler = (namespace: string, args: unknown[]) => void

let debugHandler: DebugHandler | undefined

/**
 * Told when a handler is set or removed (the worker threads of the media server send their messages to the handler of
 * the main thread while there is one)
 */
export const debugHandlerWatchers: Set<(set: boolean) => void> = new Set()

/**
 * Whether a handler is set
 */
export function hasDebugHandler(): boolean {
    return !!debugHandler
}

/**
 * Send the debug messages of the WebRTC implementation (ICE, DTLS, SCTP, TURN), including those of the worker threads of
 * a media server, to a handler, to find out why a connection fails; they are dropped by default.
 * @param handler The handler, or undefined to drop them again.
 * @example
 * ```typescript
 * import {format} from 'node:util'
 * import {setDebugHandler} from '@lakutata/webrtc'
 *
 * //The messages of ICE only
 * setDebugHandler((namespace: string, args: unknown[]): void => {
 *     if (namespace.startsWith('webrtc/ice')) console.debug(namespace, format(...args))
 * })
 * ```
 */
export function setDebugHandler(handler: DebugHandler | undefined): void {
    const changed: boolean = !!debugHandler !== !!handler
    debugHandler = handler
    if (changed) for (const watcher of debugHandlerWatchers) watcher(!!handler)
}

/**
 * The logging function of a module: it does nothing while no handler is set
 */
export function debug(namespace: string): (...args: unknown[]) => void {
    return (...args: unknown[]): void => {
        if (debugHandler) debugHandler(namespace, args)
    }
}
