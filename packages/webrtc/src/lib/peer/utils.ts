 
import {createHash} from 'node:crypto'
import {createSocket} from 'node:dgram'

import {performance} from 'node:perf_hooks'

import {
    type Address,
    debug,
    randomPort
} from './imports/common.js'
import {CipherContext} from './imports/dtls.js'
import type {TurnServerOptions} from './imports/ice.js'

import {Directions, type MediaDirection} from './media/rtpTransceiver.js'
import {MediaStreamTrack} from './media/track.js'
import type {RTCIceServer} from './peerConnection.js'

const log = debug('webrtc/peer/utils')

export function fingerprint(file: Buffer, hashName: string) {
    const upper = (s: string) => s.toUpperCase()
    const colon = (s: any) => s.match(/(.{2})/g).join(':')

    const hash = createHash(hashName).update(file).digest('hex')

    return colon(upper(hash))
}

const fingerprintHashAlgorithms: Record<string, string> = {
    sha1: 'sha1',
    'sha-1': 'sha1',
    sha224: 'sha224',
    'sha-224': 'sha224',
    sha256: 'sha256',
    'sha-256': 'sha256',
    sha384: 'sha384',
    'sha-384': 'sha384',
    sha512: 'sha512',
    'sha-512': 'sha512'
}

export function normalizeFingerprintAlgorithm(algorithm: string) {
    return fingerprintHashAlgorithms[algorithm.trim().toLowerCase()]
}

export function normalizeFingerprintValue(value: string) {
    return value.replace(/[^0-9a-f]/gi, '').toLowerCase()
}

export function isDtls(buf: Buffer) {
    const firstByte = buf[0]
    return firstByte > 19 && firstByte < 64
}

export function reverseSimulcastDirection(dir: 'recv' | 'send') {
    if (dir === 'recv') return 'send'
    return 'recv'
}

export const andDirection = (a: MediaDirection, b: MediaDirection) =>
    Directions[Directions.indexOf(a) & Directions.indexOf(b)]

export function reverseDirection(dir: MediaDirection): MediaDirection {
    if (dir === 'sendonly') return 'recvonly'
    if (dir === 'recvonly') return 'sendonly'
    return dir
}

export const milliTime = Date.now

const startupTimestampInMicroseconds =
    BigInt(Date.now()) * 1000n - process.hrtime.bigint() / 1000n

export const microTime = () => {
    return startupTimestampInMicroseconds + process.hrtime.bigint() / 1000n
}

export const timestampSeconds = () => Date.now() / 1000

/**https://datatracker.ietf.org/doc/html/rfc3550#section-4 */
//The NTP epoch (1900) from the Unix epoch, in milliseconds
const NTP_EPOCH_MS = Date.UTC(1900, 0, 1)

/**
 * The time now as an NTP timestamp (RFC 5905): 32 bits of seconds since 1900, then 32 bits of fraction of a second
 */
export const ntpTime = (epochMs: number = performance.timeOrigin + performance.now()) => {
    const ms = epochMs - NTP_EPOCH_MS
    const seconds = Math.floor(ms / 1000)
    const fraction = Math.floor(((ms - seconds * 1000) / 1000) * 2 ** 32)
    return (BigInt(seconds) << 32n) | BigInt(fraction)
}

/**
 * The abs-send-time header extension of a time: the 6 low bits of the seconds and the 18 high bits of the fraction of
 * its NTP timestamp, without the bigints of ntpTime() (it is computed for each packet)
 * @param epochMs The time, in milliseconds since the Unix epoch.
 */
export const absSendTimeOf = (epochMs: number): Buffer => {
    const ms = epochMs - NTP_EPOCH_MS
    const seconds = Math.floor(ms / 1000)
    const fraction = Math.floor(((ms - seconds * 1000) / 1000) * 2 ** 32)
    const buf = Buffer.allocUnsafe(3)
    buf.writeUIntBE(((seconds & 0x3f) << 18) | (fraction >>> 14), 0, 3)
    return buf
}

/**
 * The time of an NTP timestamp, in milliseconds since the Unix epoch
 * @param ntp
 */
export const ntpTimeToEpochMs = (ntp: bigint) => {
    const seconds = Number(ntp >> 32n)
    const fraction = Number(ntp & 0xffffffffn)
    return seconds * 1000 + (fraction / 2 ** 32) * 1000 + NTP_EPOCH_MS
}

/**
 * https://datatracker.ietf.org/doc/html/rfc3550#section-4
 * @param ntp
 * @returns 32bit
 */
export const compactNtp = (ntp: bigint) => {
    //The middle 32 bits: the low 16 bits of the seconds, the high 16 bits of the fraction
    return Number((ntp >> 16n) & 0xffffffffn)
}

export function parseIceServers(iceServers: RTCIceServer[]) {
    //The first STUN and TURN URLs, and all of them in stunServers and turnServers
    const options: {
        stunServer?: Address
        turnServer?: Address
        turnUsername?: string
        turnPassword?: string
        turnTransport?: 'udp' | 'tcp' | 'tls'
        stunServers: Address[]
        turnServers: TurnServerOptions[]
    } = {stunServers: [], turnServers: []}

    for (const iceServer of iceServers) {
        const urls = Array.isArray(iceServer.urls)
            ? iceServer.urls
            : [iceServer.urls]
        for (const url of urls) {
            const parsed = parseIceServerUrl(url)
            if (!parsed) {
                continue
            }

            if (parsed.kind === 'stun') {
                options.stunServer ??= parsed.address
                options.stunServers.push(parsed.address)
            }

            if (parsed.kind === 'turn') {
                if (!options.turnServer) {
                    options.turnServer = parsed.address
                    options.turnTransport = parsed.transport
                    options.turnUsername = iceServer.username
                    options.turnPassword = iceServer.credential
                }
                if (iceServer.username && iceServer.credential) {
                    options.turnServers.push({
                        address: parsed.address,
                        username: iceServer.username,
                        password: iceServer.credential,
                        transport: parsed.transport
                    })
                }
            }
        }
    }

    log('iceOptions', options)
    return options
}

export function resolveTurnTransport({
    configuredTurnTransport,
    forceTurnTCP,
    parsedTurnTransport
}: {
    parsedTurnTransport?: 'udp' | 'tcp' | 'tls'
    configuredTurnTransport?: 'udp' | 'tcp' | 'tls'
    forceTurnTCP: boolean
}) {
    if (parsedTurnTransport) {
        return parsedTurnTransport
    }

    if (configuredTurnTransport) {
        return configuredTurnTransport
    }

    if (forceTurnTCP) {
        return 'tcp'
    }

    return undefined
}

function parseIceServerUrl(url: string) {
    const matched = /^(stun|stuns|turn|turns):(.+)$/i.exec(url.trim())
    if (!matched) {
        return
    }

    const [, rawScheme, rawRest] = matched
    const scheme = rawScheme.toLowerCase() as 'stun' | 'stuns' | 'turn' | 'turns'
    const [authority] = rawRest.split('?', 1)
    const [, query = ''] = rawRest.split('?')
    const address = parseAddress(authority, defaultPort(scheme))
    if (!address) {
        return
    }

    if (scheme === 'stun' || scheme === 'stuns') {
        return {kind: 'stun' as const, address}
    }

    const queryParams = new URLSearchParams(query)
    const transportParam = queryParams.get('transport')
    const transport = resolveParsedTurnTransport({
        scheme,
        transportParam
    })
    if (transport === 'invalid') {
        return
    }

    return {
        kind: 'turn' as const,
        address,
        transport
    }
}

function resolveParsedTurnTransport({
    scheme,
    transportParam
}: {
    scheme: 'turn' | 'turns'
    transportParam: string | null
}): 'udp' | 'tcp' | 'tls' | 'invalid' | undefined {
    if (transportParam == null) {
        return scheme === 'turns' ? 'tls' : undefined
    }

    if (transportParam === 'udp') {
        return scheme === 'turns' ? 'invalid' : 'udp'
    }

    if (transportParam === 'tcp') {
        return scheme === 'turns' ? 'tls' : 'tcp'
    }

    return 'invalid'
}

function defaultPort(scheme: string) {
    if (scheme === 'stuns' || scheme === 'turns') {
        return 5349
    }
    return 3478
}

function parseAddress(
    value: string,
    fallbackPort: number
): Address | undefined {
    const authority = value.startsWith('//') ? value.slice(2) : value
    if (!authority) {
        return
    }

    if (authority.startsWith('[')) {
        const closingBracket = authority.indexOf(']')
        if (closingBracket === -1) {
            return
        }
        const host = authority.slice(1, closingBracket)
        const port = parsePort(authority.slice(closingBracket + 1), fallbackPort)
        return [host, port]
    }

    const firstColon = authority.indexOf(':')
    const lastColon = authority.lastIndexOf(':')
    if (firstColon !== -1 && firstColon === lastColon) {
        return [
            authority.slice(0, firstColon),
            parsePort(authority.slice(firstColon + 1), fallbackPort)
        ]
    }

    return [authority, fallbackPort]
}

function parsePort(value: string, fallbackPort: number) {
    const portString = value.startsWith(':') ? value.slice(1) : value
    const port = Number.parseInt(portString, 10)
    return Number.isFinite(port) ? port : fallbackPort
}

/**
 *
 * @param signatureHash
 * @param namedCurveAlgorithm necessary when use ecdsa
 */
export const createSelfSignedCertificate =
    CipherContext.createSelfSignedCertificateWithKey

export class MediaStreamTrackFactory {
    static async rtpSource({
        port,
        kind,
        cb
    }: {
        port?: number
        kind: 'audio' | 'video'
        cb?: (buf: Buffer) => Buffer
    }) {
        port ??= await randomPort()
        const track = new MediaStreamTrack({kind})

        const udp = createSocket('udp4')
        udp.bind(port)
        const onMessage = (msg: Buffer) => {
            if (cb) {
                msg = cb(msg)
            }
            track.writeRtp(msg)
        }
        udp.addListener('message', onMessage)

        const dispose = () => {
            udp.removeListener('message', onMessage)
            try {
                udp.close()
            } catch {
                //Already closed
            }
        }

        return [track, port, dispose] as const
    }
}

/**
 * Merge two objects. If a property value in the source object is undefined or
 * when casted is equal to undefined (== undefined), then it will not overwrite
 * the value of the property in the destination object.
 */
export const deepMerge = <T>(dst: T, src: T) => {
    if (!dst || typeof dst !== 'object') {
        if (src !== null && typeof src === 'object') {
            return src
        } else {
            return dst
        }
    }

    if (!src || typeof src !== 'object') {
        if (src == undefined) {
            return dst
        }
        return src
    }

    for (const key in src) {
        if (Object.prototype.hasOwnProperty.call(src, key)) {
            const sourceValue = src[key]

            if (sourceValue != undefined) {
                dst[key] = sourceValue
            }
        }
    }
    return dst
}
