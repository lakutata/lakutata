import {Exception} from '@lakutata/core'

/**
 * Thrown when a signaling request comes without a client id: the signaling pushes its events to the clients, so it
 * needs a transport with clients (Socket.IO, JSON-RPC over WebSocket), not JSON-RPC over HTTP. Its `errno` is
 * `'E_SIGNALING_CLIENT_REQUIRED'`.
 */
export class SignalingClientRequiredException extends Exception {
    /**
     * `'E_SIGNALING_CLIENT_REQUIRED'`.
     */
    public errno: string | number = 'E_SIGNALING_CLIENT_REQUIRED'
}
