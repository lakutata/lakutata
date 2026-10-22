import type {SignalingDescription} from '../protocol/SignalingProtocol.js'
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
