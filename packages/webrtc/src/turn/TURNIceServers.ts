import type {SignalingIceServer} from '../protocol/SignalingProtocol.js'
import type {TURNServerLocation} from './TURNServer.js'

/**
 * The ICE servers of a TURN server, as `RTCIceServer` objects: STUN, then TURN over UDP and TCP, then over TLS
 * @param location Where the clients reach it.
 * @param credentials The username and the password.
 */
export function iceServersOfTURN(location: TURNServerLocation, credentials: {username: string, credential: string}): SignalingIceServer[] {
    const {address, port, udp, tcp, tlsPort} = location
    const host: string = address.includes(':') ? `[${address}]` : address
    const urls: string[] = []
    if (udp) urls.push(`turn:${host}:${port}?transport=udp`)
    if (tcp) urls.push(`turn:${host}:${port}?transport=tcp`)
    if (tlsPort !== undefined) urls.push(`turns:${host}:${tlsPort}?transport=tcp`)
    const servers: SignalingIceServer[] = []
    if (udp) servers.push({urls: `stun:${host}:${port}`})
    if (urls.length) servers.push({urls: urls, username: credentials.username, credential: credentials.credential})
    return servers
}
