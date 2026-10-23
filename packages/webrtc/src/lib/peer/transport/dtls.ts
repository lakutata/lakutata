
import {createPrivateKey, randomUUID, X509Certificate} from 'node:crypto'
import {Event, type Transport, runDetached} from '../imports/common.js'

import type {AddressInfo} from 'node:net'
import {EventTarget as DomEventTarget} from '../helper.js'
import {
    certificateDer,
    CipherContext,
    DtlsClient,
    DtlsServer,
    type DtlsSocket,
    HashAlgorithm,
    NamedCurveAlgorithm,
    SignatureAlgorithm,
    type SignatureHash
} from '../imports/dtls.js'
import type {IceConnection} from '../imports/ice.js'
import {
    type RtcpPacket,
    RtcpPacketConverter,
    RtcpTransportLayerFeedback,
    type RtpHeader,
    RtpPacket,
    SrtcpSession,
    SrtpAuthenticationError,
    type SrtpProfile,
    SrtpSession,
    TransportWideCC,
    debug,
    isMedia,
    isRtcp,
    keyLength,
    saltLength
} from '../imports/rtp.js'
import {
    type RTCCertificateStats,
    type RTCStats,
    type RTCTransportStats,
    generateStatsId,
    getStatsTimestamp
} from '../media/stats.js'
import {ReceiverTWCC} from '../media/receiver/receiverTwcc.js'
import {SenderBandwidthEstimator} from '../media/sender/senderBWE.js'
import type {DebugConfig} from '../peerConnection.js'
import {
    fingerprint,
    isDtls,
    normalizeFingerprintAlgorithm,
    normalizeFingerprintValue
} from '../utils.js'
import type {RTCIceTransport} from './ice.js'

const log = debug('webrtc/peer/transport/dtls')

/**
 * A packet not sent: lost as on the network (one function for all the packets)
 */
const ignoreSendFailure = (): void => undefined

function formatDtlsVersion(version?: {
    major: number
    minor: number
}) {
    if (!version) {
        return
    }

    if (version.major === 0xfe && version.minor === 0xfd) {
        return 'DTLS 1.2'
    }
    if (version.major === 0xfe && version.minor === 0xff) {
        return 'DTLS 1.0'
    }
}

function formatSrtpCipher(profile?: number) {
    switch (profile) {
        case 0x0001:
            return 'AES_CM_128_HMAC_SHA1_80'
        case 0x0007:
            return 'AEAD_AES_128_GCM'
        default:
            return
    }
}

export interface DtlsTransportStats {
    bytesSent: number
    bytesReceived: number
    packetsSent: number
    packetsReceived: number
}

export class RTCDtlsTransport implements DtlsTransportStats {
    id = randomUUID().toString()
    state: DtlsState = 'new'
    role: DtlsRole = 'auto'
    srtpStarted = false
    transportSequenceNumber = 0
    /**The feedback of the packets received with a transport-wide sequence number (of all the streams)*/
    readonly receiverTWCC: ReceiverTWCC = new ReceiverTWCC(this)
    /**The bandwidth estimated from the feedback of the packets sent with one*/
    readonly senderBWE = new SenderBandwidthEstimator()

    // Statistics tracking
    public bytesSent = 0
    public bytesReceived = 0
    public packetsSent = 0
    public packetsReceived = 0

    dataReceiver: (buf: Buffer) => void = () => {}
    dtls?: DtlsSocket
    srtp!: SrtpSession
    srtcp!: SrtcpSession

    readonly onStateChange = new Event<[DtlsState]>()
    readonly onRtcp = new Event<[RtcpPacket]>()
    readonly onRtp = new Event<[RtpPacket]>()
    private readonly events = new DomEventTarget()
    onstatechange?: () => void

    static localCertificate?: RTCCertificate
    static localCertificatePromise?: Promise<RTCCertificate>
    private remoteParameters?: RTCDtlsParameters

    //Takes the DTLS records from ICE from the start, so that none is lost before the handshake begins
    readonly #iceAdapter: IceTransport

    //The handshake, once started
    #starting?: Promise<void>

    constructor(
        readonly config: {debug?: DebugConfig},
        readonly iceTransport: RTCIceTransport,
        public localCertificate?: RTCCertificate,
        private readonly srtpProfiles: SrtpProfile[] = []
    ) {
        this.localCertificate ??= RTCDtlsTransport.localCertificate
        this.#iceAdapter = createIceTransport(iceTransport.connection)
    }

    addEventListener = (
        type: string,
        listener: (...args: any[]) => void,
        options?: boolean | {once?: boolean}
    ) => {
        this.events.addEventListener(type, listener, options)
    }

    removeEventListener = (type: string, listener: (...args: any[]) => void) => {
        this.events.removeEventListener(type, listener)
    }

    dispatchEvent = (event: globalThis.Event) => this.events.dispatchEvent(event)

    get localParameters() {
        return new RTCDtlsParameters(
            this.localCertificate ? this.localCertificate.getFingerprints() : [],
            this.role
        )
    }

    static async SetupCertificate() {
        if (this.localCertificate) {
            return this.localCertificate
        }

        if (this.localCertificatePromise) {
            return this.localCertificatePromise
        }

        this.localCertificatePromise = (async () => {
            const {certPem, keyPem, signatureHash} =
                await CipherContext.createSelfSignedCertificateWithKey(
                    {
                        signature: SignatureAlgorithm.ecdsa_3,
                        hash: HashAlgorithm.sha256_4
                    },
                    NamedCurveAlgorithm.secp256r1_23
                )
            this.localCertificate = new RTCCertificate(
                keyPem,
                certPem,
                signatureHash
            )
            return this.localCertificate
        })()

        return this.localCertificatePromise
    }

    setRemoteParams(remoteParameters: RTCDtlsParameters) {
        const fingerprints = deduplicateFingerprints([
            ...(this.remoteParameters?.fingerprints ?? []),
            ...remoteParameters.fingerprints
        ])
        const role =
            remoteParameters.role === 'auto' && this.remoteParameters?.role
                ? this.remoteParameters.role
                : remoteParameters.role
        this.remoteParameters = new RTCDtlsParameters(fingerprints, role)
    }

    async start() {
        //Started already (a description applied again before DTLS connects): the same handshake
        if (this.#starting) {
            return await this.#starting
        }
        if (this.state !== 'new') {
            throw new Error('state must be new')
        }
        this.#starting = this.#start()
        await this.#starting
    }

    /**
     * Run the handshake
     */
    async #start(): Promise<void> {
        if (
            !this.remoteParameters ||
      this.remoteParameters.fingerprints.length === 0
        ) {
            throw new Error('remote fingerprint not exist')
        }

        if (this.role === 'auto') {
            if (this.iceTransport.role === 'controlling') {
                this.role = 'server'
            } else {
                this.role = 'client'
            }
        }

        this.setState('connecting')

        await new Promise<void>((r, f) => {
            if (this.role === 'server') {
                this.dtls = new DtlsServer({
                    cert: this.localCertificate?.certPem,
                    key: this.localCertificate?.privateKey,
                    signatureHash: this.localCertificate?.signatureHash,
                    transport: this.#iceAdapter,
                    srtpProfiles: this.srtpProfiles,
                    extendedMasterSecret: true,
                    certificateRequest: true
                })
            } else {
                this.dtls = new DtlsClient({
                    cert: this.localCertificate?.certPem,
                    key: this.localCertificate?.privateKey,
                    signatureHash: this.localCertificate?.signatureHash,
                    transport: this.#iceAdapter,
                    srtpProfiles: this.srtpProfiles,
                    extendedMasterSecret: true
                })
            }
            this.dtls.onData.subscribe((buf) => {
                if (
                    this.config.debug?.inboundPacketLoss &&
          this.config.debug?.inboundPacketLoss / 100 < Math.random()
                ) {
                    return
                }
                this.dataReceiver(buf)
            })
            this.dtls.onClose.subscribe(() => {
                if (this.state !== 'failed') {
                    this.setState('closed')
                }
            })
            this.dtls.onConnect.once(r)
            this.dtls.onError.once((error) => {
                this.setState('failed')
                log('dtls failed', error)
                f(error)
            })

            //The server keeps the records arriving early (IceTransport): the client starts at once
            if (this.dtls instanceof DtlsClient) {
                this.dtls.connect().catch((error) => {
                    this.setState('failed')
                    log('dtls connect failed', error)
                    f(error)
                })
            }
        })

        try {
            this.verifyRemoteCertificateFingerprint()
        } catch (error) {
            this.setState('failed')
            this.dtls?.close()
            throw error
        }

        if (this.srtpProfiles.length > 0) {
            this.startSrtp()
        }
        this.setState('connected')

        log('dtls connected')
    }

    private verifyRemoteCertificateFingerprint() {
        if (
            !this.remoteParameters ||
      this.remoteParameters.fingerprints.length === 0
        ) {
            throw new Error('remote fingerprint not exist')
        }

        const remoteCertificate = this.dtls?.remoteCertificate
        if (!remoteCertificate) {
            throw new Error('remote certificate not available')
        }

        const supportedFingerprints = this.remoteParameters.fingerprints.flatMap(
            ({algorithm, value}) => {
                const normalizedAlgorithm = normalizeFingerprintAlgorithm(algorithm)
                if (!normalizedAlgorithm) {
                    return []
                }

                const normalizedValue = normalizeFingerprintValue(value)
                if (!normalizedValue) {
                    throw new Error('remote fingerprint value is empty')
                }

                return [{normalizedAlgorithm, normalizedValue}]
            }
        )
        if (supportedFingerprints.length === 0) {
            throw new Error('no supported remote fingerprint algorithms')
        }

        const preferredAlgorithm = selectPreferredFingerprintAlgorithm(
            supportedFingerprints
        )
        const expectedFingerprints = supportedFingerprints.filter(
            ({normalizedAlgorithm}) => normalizedAlgorithm === preferredAlgorithm
        )

        const actualFingerprints = expectedFingerprints.reduce(
            (acc, {normalizedAlgorithm}) => {
                if (!acc.has(normalizedAlgorithm)) {
                    acc.set(
                        normalizedAlgorithm,
                        normalizeFingerprintValue(
                            fingerprint(remoteCertificate, normalizedAlgorithm)
                        )
                    )
                }
                return acc
            },
            new Map<string, string>()
        )

        const matched = expectedFingerprints.some(
            ({normalizedAlgorithm, normalizedValue}) =>
                actualFingerprints.get(normalizedAlgorithm) === normalizedValue
        )

        if (!matched) {
            throw new Error('remote certificate fingerprint mismatch')
        }
    }

    updateSrtpSession() {
        if (!this.dtls) throw new Error()

        const profile = this.dtls.srtp.srtpProfile
        if (!profile) {
            throw new Error('need srtpProfile')
        }
        log('selected SRTP Profile', profile)

        const {localKey, localSalt, remoteKey, remoteSalt} =
            this.dtls.extractSessionKeys(keyLength(profile), saltLength(profile))

        const config = {
            keys: {
                localMasterKey: localKey,
                localMasterSalt: localSalt,
                remoteMasterKey: remoteKey,
                remoteMasterSalt: remoteSalt
            },
            profile
        }
        this.srtp = new SrtpSession(config)
        this.srtcp = new SrtcpSession(config)
    }

    startSrtp() {
        if (this.srtpStarted) return
        this.srtpStarted = true

        this.updateSrtpSession()

        this.iceTransport.connection.onData.subscribe((data) => {
            if (
                this.config.debug?.inboundPacketLoss &&
        this.config.debug?.inboundPacketLoss / 100 < Math.random()
            ) {
                return
            }

            if (!isMedia(data)) return

            // Track received data statistics
            this.bytesReceived += data.length
            this.packetsReceived++

            if (isRtcp(data)) {
                let dec: Buffer
                try {
                    dec = this.srtcp.decrypt(data)
                } catch (error) {
                    if (error instanceof SrtpAuthenticationError) {
                        log('dropping invalid SRTCP packet', error)
                        return
                    }
                    throw error
                }
                let rtcpPackets
                try {
                    rtcpPackets = RtcpPacketConverter.deSerialize(dec)
                } catch (error) {
                    log('dropping malformed SRTCP packet', error)
                    return
                }
                for (const rtcp of rtcpPackets) {
                    try {
                        //The transport-wide feedback is the one of the packets of all the senders
                        if (rtcp instanceof RtcpTransportLayerFeedback && rtcp.feedback instanceof TransportWideCC) {
                            this.senderBWE.receiveTWCC(rtcp.feedback)
                            continue
                        }
                        this.onRtcp.execute(rtcp)
                    } catch (error) {
                        log('RTCP error', error)
                    }
                }
            } else {
                let dec: Buffer
                try {
                    dec = this.srtp.decrypt(data)
                } catch (error) {
                    if (error instanceof SrtpAuthenticationError) {
                        log('dropping invalid SRTP packet', error)
                        return
                    }
                    throw error
                }
                let rtp
                try {
                    rtp = RtpPacket.deSerialize(dec)
                } catch (error) {
                    log('dropping malformed SRTP packet', error)
                    return
                }
                try {
                    this.onRtp.execute(rtp)
                } catch (error) {
                    log('RTP error', error)
                }
            }
        })
    }

    readonly sendData = async (data: Buffer) => {
        if (
            this.config.debug?.outboundPacketLoss &&
      this.config.debug?.outboundPacketLoss / 100 < Math.random()
        ) {
            return
        }

        if (!this.dtls) {
            throw new Error('dtls not established')
        }
        await this.dtls.send(data)
    }

    async sendRtp(payload: Buffer, header: RtpHeader): Promise<number> {
        try {
            const enc = this.srtp.encrypt(payload, header)

            if (
                this.config.debug?.outboundPacketLoss &&
        this.config.debug?.outboundPacketLoss / 100 < Math.random()
            ) {
                return enc.length
            }

            // Track statistics
            this.bytesSent += enc.length
            this.packetsSent++

            await this.iceTransport.connection.send(enc).catch(ignoreSendFailure)
            return enc.length
        } catch (error) {
            log('failed to send', error)
            return 0
        }
    }

    async sendRtcp(packets: RtcpPacket[]) {
        //Before SRTP starts (a transport not connected yet, such as the one of a transceiver not bundled yet): as sendRtp
        if (!this.srtcp) {
            return
        }
        const payload = Buffer.concat(packets.map((packet) => packet.serialize()))
        const enc = this.srtcp.encrypt(payload)

        if (
            this.config.debug?.outboundPacketLoss &&
      this.config.debug?.outboundPacketLoss / 100 < Math.random()
        ) {
            return enc.length
        }

        // Track statistics
        this.bytesSent += enc.length
        this.packetsSent++

        await this.iceTransport.connection.send(enc).catch(() => {})
    }

    private setState(state: DtlsState, emitEvent = true) {
        if (state != this.state) {
            this.state = state
            if (state === 'closed' || state === 'failed') this.receiverTWCC.stop()
            this.onStateChange.execute(state)
            if (emitEvent) {
                this.onstatechange?.()
                this.events.emit('statechange')
            }
        }
    }

    async stop() {
        this.setState('closed', false)
        // todo impl send alert
        //A handshake in progress stops sending its flights again
        this.dtls?.close()
        await this.iceTransport.stop()
    }

    async getStats(timestamp = getStatsTimestamp()): Promise<RTCStats[]> {
        const stats: RTCStats[] = []

        const transportId = generateStatsId('transport', this.id)

        // Transport stats
        const transportStats: RTCTransportStats = {
            type: 'transport',
            id: transportId,
            timestamp,
            bytesSent: this.bytesSent,
            bytesReceived: this.bytesReceived,
            packetsSent: this.packetsSent,
            packetsReceived: this.packetsReceived,
            dtlsState: this.state,
            iceState: this.iceTransport.state,
            iceRole:
        this.iceTransport.role === 'unknown'
            ? undefined
            : this.iceTransport.role,
            iceLocalUsernameFragment:
        this.iceTransport.localParameters.usernameFragment,
            selectedCandidatePairId: this.iceTransport.connection.nominated
                ? generateStatsId(
                    'candidate-pair',
                    this.iceTransport.connection.nominated.id
                )
                : undefined,
            localCertificateId: this.localCertificate
                ? generateStatsId('certificate', this.id, 'local')
                : undefined,
            remoteCertificateId: this.dtls?.remoteCertificate
                ? generateStatsId('certificate', this.id, 'remote')
                : undefined,
            dtlsRole: this.role === 'auto' ? undefined : this.role,
            tlsVersion: formatDtlsVersion(this.dtls?.dtls.version),
            dtlsCipher: this.dtls?.cipher.cipher?.name,
            srtpCipher: formatSrtpCipher(this.dtls?.srtp.srtpProfile),
            iceRestarts: this.iceTransport.iceRestarts
        }
        stats.push(transportStats)

        // Certificate stats
        if (this.localCertificate) {
            const fingerprints = this.localCertificate.getFingerprints()
            if (fingerprints.length > 0) {
                const certStats: RTCCertificateStats = {
                    type: 'certificate',
                    id: generateStatsId('certificate', this.id, 'local'),
                    timestamp,
                    fingerprint: fingerprints[0].value,
                    fingerprintAlgorithm: fingerprints[0].algorithm,
                    base64Certificate: Buffer.from(
                        this.localCertificate.certPem
                    ).toString('base64')
                }
                stats.push(certStats)
            }
        }

        if (
            this.remoteParameters &&
      this.remoteParameters.fingerprints.length > 0 &&
      this.dtls?.remoteCertificate
        ) {
            const certStats: RTCCertificateStats = {
                type: 'certificate',
                id: generateStatsId('certificate', this.id, 'remote'),
                timestamp,
                fingerprint: this.remoteParameters.fingerprints[0].value,
                fingerprintAlgorithm: this.remoteParameters.fingerprints[0].algorithm,
                base64Certificate: Buffer.from(this.dtls.remoteCertificate).toString(
                    'base64'
                )
            }
            stats.push(certStats)
        }

        // Get ICE stats
        const iceStats = await this.iceTransport.getStats(timestamp, transportId)
        stats.push(...iceStats)

        return stats
    }
}

export const DtlsStates = [
    'new',
    'connecting',
    'connected',
    'closed',
    'failed'
] as const
export type DtlsState = (typeof DtlsStates)[number]

export type DtlsRole = 'auto' | 'server' | 'client'

export class RTCCertificate {
    publicKey: string
    privateKey: string

    constructor(
        privateKeyPem: string,
        public certPem: string,
        public signatureHash: SignatureHash
    ) {
        this.publicKey = new X509Certificate(certPem).publicKey.export({type: 'spki', format: 'pem'}) as string
        this.privateKey = createPrivateKey(privateKeyPem).export({type: 'pkcs8', format: 'pem'}) as string
    }

    getFingerprints(): RTCDtlsFingerprint[] {
        return [
            new RTCDtlsFingerprint(
                'sha-256',
                fingerprint(certificateDer(this.certPem), 'sha256')
            )
        ]
    }
}

export type DtlsKeys = {
    certPem: string
    keyPem: string
    signatureHash: SignatureHash
}

export class RTCDtlsFingerprint {
    constructor(
        public algorithm: string,
        public value: string
    ) {}
}

export class RTCDtlsParameters {
    constructor(
        public fingerprints: RTCDtlsFingerprint[] = [],
        public role: 'auto' | 'client' | 'server'
    ) {}
}

const deduplicateFingerprints = (fingerprints: RTCDtlsFingerprint[]) => {
    const seen = new Set<string>()
    return fingerprints.filter(({algorithm, value}) => {
        const key = `${
            normalizeFingerprintAlgorithm(algorithm) ?? algorithm.trim().toLowerCase()
        }:${normalizeFingerprintValue(value)}`
        if (seen.has(key)) {
            return false
        }
        seen.add(key)
        return true
    })
}

const preferredFingerprintAlgorithms = [
    'sha512',
    'sha384',
    'sha256',
    'sha224',
    'sha1'
] as const

const selectPreferredFingerprintAlgorithm = (
    fingerprints: {normalizedAlgorithm: string}[]
) => {
    return (
        preferredFingerprintAlgorithms.find((algorithm) =>
            fingerprints.some(
                ({normalizedAlgorithm}) => normalizedAlgorithm === algorithm
            )
        ) ?? fingerprints[0].normalizedAlgorithm
    )
}

class IceTransport implements Transport {
    closed: boolean = false
    //The DTLS records arriving before the DTLS socket takes them (the peer's ClientHello, sent as soon as its ICE
    //connected) wait here, a few at most, and go to the socket when it sets its handler
    #early: Buffer[] | undefined = []
    #onData?: (buf: Buffer) => void

    constructor(private ice: IceConnection) {
        ice.onData.subscribe((buf) => {
            if (!isDtls(buf)) return
            if (this.#onData) this.#onData(buf)
            else if (this.#early && this.#early.length < 16) this.#early.push(buf)
        })
    }

    get onData(): (buf: Buffer) => void {
        return this.#onData ?? ((): void => undefined)
    }

    set onData(handler: (buf: Buffer) => void) {
        const early = this.#early
        if (!early) {
            this.#onData = handler
            return
        }
        //The DTLS socket sets its handler in its constructor: the early records go to it once the construction ends
        //(the records arriving meanwhile join them, in order)
        queueMicrotask(() => {
            this.#early = undefined
            this.#onData = handler
            early.forEach((buf) => handler(buf))
        })
    }

    get address() {
        return {} as AddressInfo
    }

    type: string = 'ice'

    readonly send = (data: Buffer) => {
        return this.ice.send(data)
    }

    async close() {
        this.closed = true
        runDetached(() => this.ice.close(), (error) => log('close failed', error))
    }
}

const createIceTransport = (ice: IceConnection) => new IceTransport(ice)
