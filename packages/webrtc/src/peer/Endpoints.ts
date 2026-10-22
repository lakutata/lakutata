import type {IncomingMessage} from 'node:http'
import type {SignalingDescription, SignalingIceServer} from '../protocol/SignalingProtocol.js'
import type {PeerConnection} from './PeerConnection.js'

/**
 * How long an answer of an HTTP endpoint (WHIP, WHEP) waits for the candidates of its connection at most, in
 * milliseconds
 */
export const GATHERING_TIMEOUT: number = 5000

/**
 * Wait for the candidates of a connection, all of them or for a time at most
 * @param connection
 * @param timeout
 */
export function gathered(connection: PeerConnection, timeout: number = GATHERING_TIMEOUT): Promise<void> {
    if (connection.iceGatheringState === 'complete') return Promise.resolve()
    return new Promise((resolve: () => void): void => {
        const done = (): void => {
            clearTimeout(timer)
            connection.off('icegatheringstatechange', changed)
            resolve()
        }
        const changed = (state: string): void => {
            if (state === 'complete') done()
        }
        const timer: NodeJS.Timeout = setTimeout(done, timeout)
        connection.on('icegatheringstatechange', changed)
    })
}

/**
 * The connection of a session of an HTTP endpoint (WHIP, WHEP) to its client: the answer to the offer of the client,
 * and the end of the session
 */
export interface EndpointLeg {
    //The answer, with all the candidates
    readonly answer: SignalingDescription
    readonly connection: PeerConnection
    //Called once when the connection fails or closes, or the leg is closed
    ended(listener: () => void): void
    close(): void
}

/**
 * The bearer token of a request
 * @param request
 */
export function bearerOf(request: IncomingMessage): string | undefined {
    return /^Bearer\s+(\S+)\s*$/i.exec(request.headers.authorization ?? '')?.[1]
}

/**
 * The path of a request, without its query and its last slash
 * @param request
 */
export function pathOf(request: IncomingMessage): string {
    const url: string = (request as IncomingMessage & {originalUrl?: string}).originalUrl ?? request.url ?? ''
    return url.split('?')[0].replace(/\/+$/, '')
}

/**
 * A `Link` header of each ICE server (RFC 9725, section 4.6)
 * @param iceServers
 */
export function linksOf(iceServers: SignalingIceServer[]): string[] {
    const quoted = (value: string): string => `"${value.replace(/["\\]/g, '\\$&')}"`
    return iceServers.flatMap((server: SignalingIceServer): string[] => (Array.isArray(server.urls) ? server.urls : [server.urls]).map((url: string): string => {
        const credentials: string = server.username && server.credential
            ? `; username=${quoted(server.username)}; credential=${quoted(server.credential)}; credential-type="password"`
            : ''
        return `<${url}>; rel="ice-server"${credentials}`
    }))
}
