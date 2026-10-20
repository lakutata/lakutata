import {Exception} from '@lakutata/core'

/**
 * Thrown when `SignalingClient` cannot use the transport of its URL: Socket.IO (an `http:` or `https:` URL) needs the
 * package `socket.io-client`, JSON-RPC (a `ws:` or `wss:` URL) needs the global `WebSocket` (Node.js 22 and later,
 * Bun). Its `errno` is `'E_SIGNALING_CONNECTION'`.
 */
export class SignalingConnectionException extends Exception {
    /**
     * `'E_SIGNALING_CONNECTION'`.
     */
    public errno: string | number = 'E_SIGNALING_CONNECTION'
}
