
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
 * `util.format`).
 */
export type DebugHandler = (namespace: string, args: unknown[]) => void

let debugHandler: DebugHandler | undefined

/**
 * Send the debug messages of the WebRTC implementation (ICE, DTLS, SCTP, TURN) to a handler, to find out why a
 * connection fails; they are dropped by default.
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
    debugHandler = handler
}

/**
 * The logging function of a module: it does nothing while no handler is set
 */
export function debug(namespace: string): (...args: unknown[]) => void {
    return (...args: unknown[]): void => {
        if (debugHandler) debugHandler(namespace, args)
    }
}
