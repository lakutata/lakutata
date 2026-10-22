import {randomBytes} from 'node:crypto'
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
 * The connection of a session of an HTTP endpoint (WHIP, WHEP) to its client, wherever it is (in a worker thread for a
 * media server forwarding in some): the answer to the offer of the client, its PATCH requests, and the end of the
 * session
 */
export interface EndpointLeg {
    //The answer, with all the candidates
    readonly answer: SignalingDescription
    //Apply a PATCH (see patchConnection)
    patch(fragment: string, restart: boolean): Promise<string | undefined | null>
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

/**
 * The ICE of a fragment of SDP (RFC 8840): its credentials, and its candidates with the media they belong to
 * @param fragment
 */
export function iceOf(fragment: string): {ufrag?: string, pwd?: string, candidates: {candidate: string, sdpMid?: string}[]} {
    const ice: {ufrag?: string, pwd?: string, candidates: {candidate: string, sdpMid?: string}[]} = {candidates: []}
    //The session, then each media: the candidates of a media are of its mid, before or after them
    for (const section of fragment.split(/^(?=m=)/m)) {
        const lines: string[] = section.split(/\r?\n/)
        const mid: string | undefined = lines.find((line: string): boolean => line.startsWith('a=mid:'))?.slice('a=mid:'.length).trim()
        for (const line of lines) {
            if (line.startsWith('a=ice-ufrag:')) ice.ufrag ??= line.slice('a=ice-ufrag:'.length).trim()
            else if (line.startsWith('a=ice-pwd:')) ice.pwd ??= line.slice('a=ice-pwd:'.length).trim()
            else if (line.startsWith('a=candidate:')) ice.candidates.push({candidate: line.slice(2).trim(), ...mid === undefined ? {} : {sdpMid: mid}})
        }
    }
    return ice
}

/**
 * Apply a PATCH of a session of an HTTP endpoint (RFC 9725, section 4.3) to its connection: the candidates of the
 * client (trickle ICE), or an ICE restart when its credentials changed. The server answering the offer of the client,
 * a restart is an offer of the client again, its credentials replaced, that the connection answers with new ones.
 * @param connection
 * @param fragment The fragment of SDP of the request (`application/trickle-ice-sdpfrag`).
 * @param restart Whether the request may restart ICE (its `If-Match` is `*`): a fragment of other credentials without
 * it is of an ICE session gone (a request sent again after a restart), not applied.
 * @returns The fragment of the answer of a restart (its credentials, its candidates); none for trickle ICE; `null` for
 * a fragment of an ICE session gone.
 * @throws {Error} When the fragment has no ICE, or the connection refuses it.
 */
export async function patchConnection(connection: PeerConnection, fragment: string, restart: boolean): Promise<string | undefined | null> {
    const ice: {ufrag?: string, pwd?: string, candidates: {candidate: string, sdpMid?: string}[]} = iceOf(fragment)
    const remote: string = connection.remoteDescription?.sdp ?? ''
    const mids: string[] = [...remote.matchAll(/^a=mid:(\S+)/gm)].map((match: RegExpMatchArray): string => match[1])
    const add = async (): Promise<void> => {
        for (const {candidate, sdpMid} of ice.candidates) await connection.addIceCandidate({candidate: candidate, sdpMid: sdpMid ?? mids[0] ?? null})
    }
    const restarting: boolean = !!ice.ufrag && ice.ufrag !== /^a=ice-ufrag:(\S+)/m.exec(remote)?.[1]
    if (restarting && !restart) return null
    if (!restarting) {
        //The end of the candidates of the client has nothing to apply
        if (!ice.ufrag && !ice.candidates.length && !/^a=end-of-candidates/m.test(fragment)) throw new Error('The fragment has no ICE')
        await add()
        return undefined
    }
    if (!ice.pwd) throw new Error('The fragment of an ICE restart has no password')
    const offer: string = remote
        .replace(/^a=ice-ufrag:.*$/gm, `a=ice-ufrag:${ice.ufrag}`)
        .replace(/^a=ice-pwd:.*$/gm, `a=ice-pwd:${ice.pwd}`)
        .replace(/^a=(candidate:.*|end-of-candidates)\r?\n/gm, '')
    await connection.setRemoteDescription({type: 'offer', sdp: offer})
    await connection.setLocalDescription()
    await add()
    await gathered(connection)
    return fragmentOf(connection.localDescription?.sdp ?? '')
}

/**
 * The fragment of SDP of the ICE of a description (RFC 8840): its credentials, and the candidates of its first media
 * (the one the others are bundled on)
 * @param sdp
 */
export function fragmentOf(sdp: string): string {
    const first: string[] = (sdp.split(/^(?=m=)/m)[1] ?? '').split(/\r?\n/)
    return [
        `a=ice-ufrag:${/^a=ice-ufrag:(\S+)/m.exec(sdp)?.[1] ?? ''}`,
        `a=ice-pwd:${/^a=ice-pwd:(\S+)/m.exec(sdp)?.[1] ?? ''}`,
        ...first[0] ? [
            first[0],
            ...first.filter((line: string): boolean => line.startsWith('a=mid:')),
            ...first.filter((line: string): boolean => line.startsWith('a=candidate:')),
            'a=end-of-candidates'
        ] : []
    ].join('\r\n') + '\r\n'
}

/**
 * A new entity tag of an ICE session (the `ETag` of a session of an HTTP endpoint)
 */
export function entityTag(): string {
    return randomBytes(12).toString('hex')
}
