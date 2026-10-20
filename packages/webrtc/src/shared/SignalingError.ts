/**
 * The error of a signaling request the server refused or did not answer: its `errno` is the one of the server's
 * exception (`E_SIGNALING_DENIED`, `E_SIGNALING_NOT_A_MEMBER`, `E_SIGNALING_LIMIT`, `E_INVALID_VALUE`…), or
 * `E_SIGNALING_TIMEOUT` and `E_SIGNALING_CLOSED` for the requests without an answer.
 * @example
 * ```typescript
 * import {SignalingRequestError, type SignalingClient} from '@lakutata/webrtc'
 *
 * declare const signaling: SignalingClient
 * try {
 *     await signaling.join('private')
 * } catch (error) {
 *     if (error instanceof SignalingRequestError && error.errno === 'E_SIGNALING_DENIED') console.log('not allowed in the room')
 * }
 * ```
 */
export class SignalingRequestError extends Error {

    /**
     * The error number.
     */
    public readonly errno: string | number

    /**
     * The error the server sent, as it sent it.
     */
    public readonly data?: unknown

    /**
     * Create the error.
     * @param message The message.
     * @param errno The error number.
     * @param data The error the server sent.
     */
    constructor(message: string, errno: string | number, data?: unknown) {
        super(message)
        this.name = 'SignalingRequestError'
        this.errno = errno
        this.data = data
    }
}

/**
 * The error of a response sent by the server: the properties of its exception (Socket.IO), or the data of a JSON-RPC
 * error
 * @param error
 * @param fallbackMessage
 */
export function signalingErrorOf(error: unknown, fallbackMessage: string): SignalingRequestError {
    const object: Record<string, unknown> = (error && typeof error === 'object') ? error as Record<string, unknown> : {}
    const data: Record<string, unknown> = (object.data && typeof object.data === 'object') ? object.data as Record<string, unknown> : object
    const message: unknown = data.errMsg ?? data.message ?? object.message
    const errno: unknown = data.errno ?? object.code ?? 'E_SIGNALING'
    return new SignalingRequestError(typeof message === 'string' ? message : fallbackMessage, errno as string | number, error)
}
