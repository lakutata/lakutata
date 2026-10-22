import {randomBytes} from 'node:crypto'
import {isIPv4} from 'node:net'

import * as timers from 'node:timers/promises'
import {type Address, Event, debug} from './imports/common.js'

import {
    Candidate,
    candidateFoundation,
    candidatePriority,
    remoteTcpTypeForIncoming
} from './candidate.js'
import {MdnsLookup} from './dns/lookup.js'
import type {TransactionError} from './exceptions.js'
import {type Cancelable, PQueue, cancelable, randomString} from './helper.js'
import {
    CONSENT_INTERVAL,
    CONSENT_TIMEOUT,
    CandidatePair,
    CandidatePairState,
    ICE_COMPLETED,
    ICE_FAILED,
    type IceConnection,
    type IceOptions,
    type IceState,
    type TurnServerOptions,
    consentResponseTimeoutMs,
    defaultOptions,
    serverReflexiveCandidate,
    sortCandidatePairs,
    validateAddress,
    validateRemoteCandidate
} from './iceBase.js'
import {TCP_CHECK_RESPONSE_TIMEOUT_MS, classes, methods} from './stun/const.js'
import {Message} from './stun/message.js'
import {StunProtocol} from './stun/protocol.js'
import {TcpActiveProtocol, TcpPassiveProtocol} from './stun/tcpProtocol.js'
import {type StunOverTurnProtocol, createStunOverTurnClient} from './turn/protocol.js'
import type {Protocol, TransactionRequestOptions} from './types/model.js'
import {getHostAddresses} from './utils.js'

const log = debug('webrtc/ice/ice:log')

/**How long a transport to a TURN server is given before the next one is tried as well (ms) */
const RELAY_ATTEMPT_DELAY = 1000

/**The local preference of a relay candidate by the transport to its server: UDP first, then TCP, then TLS */
const RELAY_PREFERENCE = {udp: 65535, tcp: 49151, tls: 32767}

type RelayTransport = keyof typeof RELAY_PREFERENCE

/** A way to reach a TURN server. */
interface RelayAttempt {
    address: Address
    transport: RelayTransport
    username: string
    password: string
}

/** A TURN server: one relay candidate is gathered from it. */
interface RelayServer {
    /**the host */
    key: string
    /**its transports, tried in this order */
    attempts: RelayAttempt[]
}

/**
 * The TURN servers of the options: the entries of a host are the transports of one server (an entry without a
 * transport is UDP, then TCP when UDP fails).
 */
function relayServersOf(options: IceOptions): RelayServer[] {
    const entries: TurnServerOptions[] = []
    if (options.turnServer && options.turnUsername && options.turnPassword) {
        entries.push({
            address: options.turnServer,
            username: options.turnUsername,
            password: options.turnPassword,
            transport: options.turnTransport
        })
    }
    entries.push(...(options.turnServers ?? []))
    const servers = new Map<string, RelayServer>()
    for (const entry of entries) {
        const address = validateAddress(entry.address)
        if (!address || !entry.username || !entry.password) continue
        const key = address[0].toLowerCase()
        let server = servers.get(key)
        if (!server) {
            server = {key, attempts: []}
            servers.set(key, server)
        }
        const transports: RelayTransport[] =
            entry.transport === undefined || entry.transport === 'udp' ? ['udp', 'tcp'] : [entry.transport]
        for (const transport of transports) {
            const known = server.attempts.some(
                (attempt) =>
                    attempt.transport === transport &&
                    attempt.address[1] === address[1] &&
                    attempt.username === entry.username &&
                    attempt.password === entry.password
            )
            if (!known) server.attempts.push({address, transport, username: entry.username, password: entry.password})
        }
    }
    return [...servers.values()]
}

/** The STUN servers of the options, each once. */
function stunServersOf(options: IceOptions): Address[] {
    const servers: Address[] = []
    for (const server of [options.stunServer, ...(options.stunServers ?? [])]) {
        const address = validateAddress(server)
        if (address && !servers.some(([host, port]) => host === address[0] && port === address[1])) servers.push(address)
    }
    return servers
}

export class Connection implements IceConnection {
    localUsername = randomString(4)
    localPassword = randomString(22)
    remoteIsLite = false
    remotePassword: string = ''
    remoteUsername: string = ''
    checkList: CandidatePair[] = []
    localCandidates: Candidate[] = []
    stunServer?: Address
    turnServer?: Address
    options: IceOptions
    private stunServers: Address[] = []
    private relayServers: RelayServer[] = []
    /**the relays by the host of their TURN server */
    private relays = new Map<string, StunOverTurnProtocol>()
    remoteCandidatesEnd = false
    localCandidatesEnd = false
    generation = -1
    userHistory: {[username: string]: string} = {}
    private readonly tieBreaker: bigint = randomBytes(8).readBigUInt64BE(0)
    state: IceState = 'new'
    lookup?: MdnsLookup

    private _remoteCandidates: Candidate[] = []
    // P2P接続完了したソケット
    nominated?: CandidatePair
    private nominating = false
    private checkListDone = false
    private checkListState = new PQueue<number>()
    private earlyChecks: [Message, Address, Protocol][] = []
    private earlyChecksDone = false
    private localCandidatesStart = false
    private protocols: Protocol[] = []
    private queryConsentHandle?: Cancelable<void>
    /** RFC 7675 consent-to-send: application data may use the selected pair. */
    private consentFresh = false
    /** Invalidates in-flight consent callbacks on restart / close / replace / expire. */
    private consentSessionId = 0
    private consentExpiryTimer?: ReturnType<typeof setTimeout>
    private consentRequestAbort?: AbortController

    readonly onData = new Event<[Buffer]>()
    readonly stateChanged = new Event<[IceState]>()
    readonly onIceCandidate: Event<[Candidate]> = new Event()

    constructor(
        private _iceControlling: boolean,
        options?: Partial<IceOptions>
    ) {
        this.options = {
            ...defaultOptions,
            ...options
        }
        if (this.iceLite) {
            this._iceControlling = false
        }
        this.applyStunTurnServersFromOptions()
        this.restart().catch((error) => log('restart failed', error))
        log('new Connection', this.options)
    }

    /**
   * Replace STUN/TURN servers after construction.
   * Server-related fields are replaced (not partial-merged) so that removing
   * TURN clears residual credentials. W3C setConfiguration replaces the ICE
   * server list rather than merging additively.
   *
   * Used when servers are learned after the gatherer was built (e.g. WHIP
   * Link headers) and must take effect before the next gather pass.
   */
    setIceServers(options: Partial<IceOptions>) {
    // Explicitly assign server fields even when undefined so a STUN-only
    // update cannot leave a previous TURN host/credential in options.
        this.options = {
            ...this.options,
            stunServer: options.stunServer,
            turnServer: options.turnServer,
            turnUsername: options.turnUsername,
            turnPassword: options.turnPassword,
            turnTransport: options.turnTransport,
            stunServers: options.stunServers,
            turnServers: options.turnServers
        }
        if (options.forceTurn !== undefined) {
            this.options.forceTurn = options.forceTurn
        }
        if (options.useTcp !== undefined) {
            this.options.useTcp = options.useTcp
        }
        if (options.turnTlsOptions !== undefined) {
            this.options.turnTlsOptions = options.turnTlsOptions
        }
        if (options.turnUdpFamily !== undefined) {
            this.options.turnUdpFamily = options.turnUdpFamily
        }

        this.applyStunTurnServersFromOptions()
        log('Connection ice servers updated', this.options)
    }

    /**
   * Derive Connection.stunServer / turnServer from this.options.
   * Shared by the constructor and setIceServers so both paths validate and
   * default identically.
   */
    private applyStunTurnServersFromOptions() {
    //No STUN server unless one is configured, as RTCPeerConnection (no request to a public server by default)
        this.stunServers = stunServersOf(this.options)
        this.relayServers = relayServersOf(this.options)
        this.stunServer = this.stunServers[0]
        this.turnServer = validateAddress(this.options.turnServer) ?? this.relayServers[0]?.attempts[0]?.address
    }

    get iceControlling() {
        return this._iceControlling
    }

    set iceControlling(value: boolean) {
        if (this.iceLite) {
            value = false
        }
        // While a pair is selected, keep the negotiated role. ICE restart clears
        // `nominated`, so offer/answer role and RFC 8445 role-conflict repair can
        // reassign controlling/controlled for the new generation.
        if (this.nominated) {
            return
        }
        this.applyIceControlling(value)
    }

    get iceLite() {
        return this.options.iceLite
    }

    async restart() {
        this.generation++

        this.localUsername = randomString(4)
        this.localPassword = randomString(22)
        if (this.options.localPasswordPrefix) {
            this.localPassword =
                this.options.localPasswordPrefix +
        this.localPassword.slice(this.options.localPasswordPrefix.length)
        }
        this.userHistory[this.localUsername] = this.localPassword

        this.remoteUsername = ''
        this.remotePassword = ''
        this.localCandidates = []
        this._remoteCandidates = []
        this.remoteCandidatesEnd = false
        this.localCandidatesEnd = false
        this.state = 'new'
        this.lookup?.close?.()
        this.lookup = undefined
        this.nominated = undefined
        this.nominating = false
        this.checkList = []
        this.checkListDone = false
        this.checkListState = new PQueue<number>()
        this.earlyChecks = []
        this.earlyChecksDone = false
        this.localCandidatesStart = false

        // protocolsはincomingのearlyCheckに使うかもしれないので残す
        for (const protocol of this.protocols) {
            if (protocol.localCandidate) {
                protocol.localCandidate.refreshId()
                protocol.localCandidate.generation = this.generation
                protocol.localCandidate.ufrag = this.localUsername
            }
        }

        // Tear down consent timers/transactions; new credentials require a new session.
        this.stopConsentLifecycle()
    }

    resetNominatedPair() {
        log('resetNominatedPair')
        this.nominated = undefined
        this.nominating = false
        // Drop old pair's consent timers/transactions; restarted when a new pair is nominated.
        this.stopConsentLifecycle()
    }

    setRemoteParams({
        iceLite,
        usernameFragment,
        password
    }: {
        iceLite: boolean
        usernameFragment: string
        password: string
    }) {
        log('setRemoteParams', {iceLite, usernameFragment, password})
        this.remoteIsLite = iceLite
        this.remoteUsername = usernameFragment
        this.remotePassword = password
    }

    // 4.1.1 Gathering Candidates
    async gatherCandidates() {
        if (!this.localCandidatesStart) {
            this.localCandidatesStart = true

            // ICE restart keeps transport protocols; re-advertise their host candidates
            // with the new generation / ufrag before gathering additional addresses.
            // A relay is advertised again once its allocation is known to be still there.
            const relays = [...this.relays.values()] as Protocol[]
            for (const protocol of this.protocols) {
                if (protocol.localCandidate && !relays.includes(protocol)) {
                    protocol.localCandidate.generation = this.generation
                    protocol.localCandidate.ufrag = this.localUsername
                    this.appendLocalCandidate(protocol.localCandidate)
                }
            }

            let address = getHostAddresses(
                this.options.useIpv4,
                this.options.useIpv6,
                {
                    useLinkLocalAddress: this.options.useLinkLocalAddress
                }
            )
            const {interfaceAddresses} = this.options
            if (interfaceAddresses) {
                const filteredAddresses = address.filter((check) =>
                    Object.values(interfaceAddresses).includes(check)
                )
                if (filteredAddresses.length) {
                    address = filteredAddresses
                }
            }
            if (this.options.additionalHostAddresses) {
                address = Array.from(
                    new Set([...this.options.additionalHostAddresses, ...address])
                )
            }

            const candidatePromises = this.getCandidatePromises(
                address,
                this.options.stunGatherTimeout
            )
            await Promise.allSettled(candidatePromises)

            this.localCandidatesEnd = true
        }
        this.setState('completed')
    }

    private appendLocalCandidate(candidate: Candidate) {
        this.localCandidates.push(candidate)
        this.onIceCandidate.execute(candidate)
    }

    /**
   * Whether a candidate with the same address and base was gathered already
   * (RFC 8445, section 5.1.3): a server reflexive address that is a host
   * address, or that another STUN server gave too.
   */
    private isRedundant(candidate: Candidate) {
        const baseOf = (other: Candidate) =>
            other.type === 'host' ? `${other.host}|${other.port}` : `${other.relatedAddress}|${other.relatedPort}`
        return this.localCandidates.some(
            (other) =>
                other.transport === candidate.transport &&
                other.host === candidate.host &&
                other.port === candidate.port &&
                other.type !== 'relay' &&
                baseOf(other) === baseOf(candidate)
        )
    }

    /**
   * A relay candidate from each TURN server. An ICE restart keeps the
   * allocation of a server when the server still has it; the relays of the
   * servers no longer configured are closed.
   */
    private gatherRelayCandidates(servers: RelayServer[]): Promise<Candidate | void>[] {
        for (const [key, relay] of this.relays) {
            if (!servers.some((server) => server.key === key)) this.dropRelay(key, relay)
        }
        return servers.map(async (server) => {
            const existing = this.relays.get(server.key)
            if (existing) {
                if (await existing.turn.refreshAllocation()) {
                    if (this.relays.get(server.key) !== existing) return
                    existing.localCandidate.generation = this.generation
                    existing.localCandidate.ufrag = this.localUsername
                    this.appendLocalCandidate(existing.localCandidate)
                    return existing.localCandidate
                }
                this.dropRelay(server.key, existing)
            }
            const {protocol, attempt} = await this.allocateRelay(server)
            if (this.state === 'closed' || this.relays.has(server.key)) {
                await protocol.close()
                return
            }
            this.ensureProtocol(protocol)
            this.protocols.push(protocol)
            this.relays.set(server.key, protocol)

            const candidateAddress = protocol.turn.relayedAddress
            const relatedAddress = protocol.turn.mappedAddress
            log('turn candidateAddress', candidateAddress)

            protocol.localCandidate = new Candidate(
                candidateFoundation('relay', 'udp', candidateAddress[0], `${server.key}|${attempt.transport}`),
                1,
                'udp',
                candidatePriority('relay', RELAY_PREFERENCE[attempt.transport]),
                candidateAddress[0],
                candidateAddress[1],
                'relay',
                relatedAddress[0],
                relatedAddress[1],
                undefined,
                this.generation,
                this.localUsername
            )
            this.appendLocalCandidate(protocol.localCandidate)
            return protocol.localCandidate
        }).map((promise) =>
            promise.catch((error) => {
                log('query TURN server', error)
            })
        )
    }

    /**
   * Allocate a relay on a TURN server: its transports are tried in order, the
   * next one when the one before fails or has not answered within
   * RELAY_ATTEMPT_DELAY; the first allocation made is kept, a later one is
   * deleted.
   */
    private allocateRelay(server: RelayServer): Promise<{protocol: StunOverTurnProtocol, attempt: RelayAttempt}> {
        return new Promise((resolve, reject) => {
            let next = 0
            let pending = 0
            let done = false
            let timer: ReturnType<typeof setTimeout> | undefined
            const start = () => {
                clearTimeout(timer)
                if (done || next >= server.attempts.length) return
                const attempt = server.attempts[next++]
                pending++
                timer = setTimeout(start, RELAY_ATTEMPT_DELAY)
                createStunOverTurnClient(
                    {address: attempt.address, username: attempt.username, password: attempt.password},
                    {
                        portRange: this.options.portRange,
                        interfaceAddresses: this.options.interfaceAddresses,
                        transport: attempt.transport,
                        tlsOptions: this.options.turnTlsOptions,
                        connectTimeoutMs: (this.options.turnConnectTimeout ?? 8) * 1000,
                        udpFamily: this.options.turnUdpFamily
                    }
                ).then(
                    (protocol) => {
                        pending--
                        if (done) {
                            protocol.close().catch((error) => log('close TURN relay', error))
                            return
                        }
                        done = true
                        clearTimeout(timer)
                        resolve({protocol, attempt})
                    },
                    (error) => {
                        pending--
                        log('TURN allocation failed', attempt.transport, attempt.address, error)
                        if (done) return
                        if (next < server.attempts.length) {
                            start()
                        } else if (!pending) {
                            done = true
                            reject(error)
                        }
                    }
                )
            }
            start()
        })
    }

    /** Stop using a relay and delete its allocation. */
    private dropRelay(key: string, relay: StunOverTurnProtocol) {
        this.relays.delete(key)
        this.protocols = this.protocols.filter((protocol) => protocol !== relay)
        relay.close().catch((error) => log('close TURN relay', error))
    }

    private ensureProtocol(protocol: Protocol) {
        protocol.onRequestReceived.subscribe((msg, addr) => {
            if (msg.messageMethod !== methods.BINDING) {
                this.respondError(msg, addr, protocol, [400, 'Bad Request'])
                return
            }

            const txUsername = msg.getAttributeValue('USERNAME')
            // 相手にとってのremoteは自分にとってのlocal
            const {remoteUsername: localUsername} = decodeTxUsername(txUsername)
            const localPassword =
                this.userHistory[localUsername] ?? this.localPassword

            const {iceControlling} = this

            // 7.2.1.1.  Detecting and Repairing Role Conflicts
            if (iceControlling && msg.attributesKeys.includes('ICE-CONTROLLING')) {
                if (this.tieBreaker >= msg.getAttributeValue('ICE-CONTROLLING')) {
                    this.respondError(msg, addr, protocol, [487, 'Role Conflict'])
                    return
                } else {
                    this.switchRole(false)
                }
            } else if (
                !iceControlling &&
        msg.attributesKeys.includes('ICE-CONTROLLED')
            ) {
                if (
                    this.iceLite ||
          this.tieBreaker < msg.getAttributeValue('ICE-CONTROLLED')
                ) {
                    this.respondError(msg, addr, protocol, [487, 'Role Conflict'])
                    return
                } else {
                    this.switchRole(true)
                    return
                }
            }

            if (
                this.options.filterStunResponse &&
        !this.options.filterStunResponse(msg, addr, protocol)
            ) {
                return
            }

            // # send binding response
            const response = new Message(
                methods.BINDING,
                classes.RESPONSE,
                msg.transactionId
            )

            response
                .setAttribute('XOR-MAPPED-ADDRESS', addr)
                .addMessageIntegrity(Buffer.from(localPassword, 'utf8'))
                .addFingerprint()
            protocol.sendStun(response, addr).catch((e) => {
                log('sendStun error', e)
            })

            if (this.checkList.length === 0 && !this.earlyChecksDone) {
                this.earlyChecks.push([msg, addr, protocol])
            } else {
                this.checkIncoming(msg, addr, protocol)
            }
        })
        protocol.onDataReceived.subscribe((data) => {
            try {
                // Update statistics for the nominated pair
                const activePair = this.nominated
                if (activePair && activePair.protocol === protocol) {
                    activePair.packetsReceived++
                    activePair.bytesReceived += data.length
                }

                this.onData.execute(data)
            } catch (error) {
                log('dataReceived', error)
            }
        })
        protocol.onConnectionClosed?.subscribe((remoteAddr) => {
            this.handleConnectionClosed(protocol, remoteAddr)
        })
    }

    /**
   * RFC 6544: the selected TCP connection is the only path for this component;
   * once it is closed no application data or consent check can reach the peer,
   * so fail the same way as a consent expiry instead of waiting for it.
   */
    private handleConnectionClosed(protocol: Protocol, remoteAddr: Address) {
        const nominated = this.nominated
        if (
            !nominated ||
      nominated.protocol !== protocol ||
      nominated.remoteAddr[0] !== remoteAddr[0] ||
      nominated.remoteAddr[1] !== remoteAddr[1]
        ) {
            return
        }
        if (this.state === 'closed' || this.state === 'failed') {
            return
        }
        log('selected tcp connection closed', nominated.toJSON())
        this.stopConsentLifecycle()
        this.setState('failed')
    }

    private getCandidatePromises(addresses: string[], timeout = 5) {
        const candidatePromises: Promise<unknown>[] = []
        const {stunServers, relayServers} = this
        const gatherIceLite = this.iceLite
        const gatherRelayOnly =
            !gatherIceLite && this.options.forceTurn && relayServers.length > 0
        //The UDP host candidates of the generations before (an ICE restart) are queried again with the STUN servers
        const knownHostProtocols = this.protocols.filter(
            (protocol): protocol is StunProtocol =>
                protocol instanceof StunProtocol && !!protocol.localCandidate
        )

        addresses = addresses.filter((address) => {
            // ice restartで同じアドレスが追加されるのを防ぐ
            if (this.protocols.find((protocol) => protocol.localIp === address)) {
                return false
            }
            return true
        })

        const localStunPromises = gatherRelayOnly
            ? []
            : addresses.map(async (address) => {
                // # create transport
                const protocol = new StunProtocol()
                this.ensureProtocol(protocol)
                try {
                    await protocol.connectionMade(
                        isIPv4(address),
                        this.options.portRange,
                        this.options.interfaceAddresses
                    )

                    protocol.localIp = address
                    this.protocols.push(protocol)

                    log('protocol', protocol.localIp)

                    // # add host candidate
                    const candidateAddress: Address = [
                        address,
                        protocol.getExtraInfo()[1]
                    ]

                    protocol.localCandidate = new Candidate(
                        candidateFoundation('host', 'udp', candidateAddress[0]),
                        1,
                        'udp',
                        candidatePriority('host', {transport: 'udp'}),
                        candidateAddress[0],
                        candidateAddress[1],
                        'host',
                        undefined,
                        undefined,
                        undefined,
                        this.generation,
                        this.localUsername
                    )

                    this.pairLocalProtocol(protocol)
                    this.appendLocalCandidate(protocol.localCandidate)

                    return protocol
                } catch (error) {
                    log('error protocol STUN', error)
                }
            })

        if (!gatherRelayOnly) {
            candidatePromises.push(
                ...localStunPromises.map((localPromise) =>
                    localPromise.then((protocol) => protocol?.localCandidate)
                )
            )
        }

        if (!gatherRelayOnly && this.options.useTcp) {
            const tcpCandidatePromises = addresses.map(async (address) => {
                // Passive candidates open a listening TCP server; skip them when the
                // agent only makes outbound connections (tcpPassive === false). Active
                // candidates below still dial out, so direct TCP egress is unaffected.
                if (this.options.tcpPassive !== false) {
                    const passiveProtocol = new TcpPassiveProtocol()
                    this.ensureProtocol(passiveProtocol)
                    await passiveProtocol.connectionMade(address, this.options.portRange)
                    passiveProtocol.localIp = address
                    passiveProtocol.localCandidate = new Candidate(
                        candidateFoundation('host', 'tcp', address),
                        1,
                        'tcp',
                        candidatePriority('host', {
                            transport: 'tcp',
                            tcptype: 'passive'
                        }),
                        address,
                        passiveProtocol.listeningPort,
                        'host',
                        undefined,
                        undefined,
                        'passive',
                        this.generation,
                        this.localUsername
                    )
                    this.protocols.push(passiveProtocol)
                    this.appendLocalCandidate(passiveProtocol.localCandidate)
                }

                if (!gatherIceLite) {
                    const activeProtocol = new TcpActiveProtocol()
                    this.ensureProtocol(activeProtocol)
                    await activeProtocol.connectionMade(address)
                    activeProtocol.localIp = address
                    activeProtocol.localCandidate = new Candidate(
                        candidateFoundation('host', 'tcp', address),
                        1,
                        'tcp',
                        candidatePriority('host', {
                            transport: 'tcp',
                            tcptype: 'active'
                        }),
                        address,
                        9,
                        'host',
                        undefined,
                        undefined,
                        'active',
                        this.generation,
                        this.localUsername
                    )
                    this.protocols.push(activeProtocol)
                    this.pairLocalProtocol(activeProtocol)
                    this.appendLocalCandidate(activeProtocol.localCandidate)
                }
            })

            candidatePromises.push(...tcpCandidatePromises)
        }

        if (!gatherIceLite && !gatherRelayOnly && stunServers.length) {
            const hostProtocols: Promise<StunProtocol | undefined>[] = [
                ...knownHostProtocols.map((protocol) => Promise.resolve(protocol)),
                ...localStunPromises
            ]
            const stunCandidatePromises = hostProtocols.flatMap((protocolPromise) =>
                stunServers.map(async (stunServer) => {
                    const protocol = await protocolPromise
                    if (!protocol) return

                    //The server reflexive candidate of an IPv4 host candidate; gathering waits for it at most timeout
                    //seconds (a late answer still adds its candidate, unless ICE restarted meanwhile)
                    const generation = this.generation
                    const query = (async (): Promise<Candidate | void> => {
                        const host = protocol.localCandidate?.host
                        if (!host || !isIPv4(host)) return
                        const candidate = await serverReflexiveCandidate(
                            protocol,
                            stunServer
                        ).catch((error) => {
                            log('error', error)
                        })
                        if (!candidate || generation !== this.generation || this.isRedundant(candidate)) return
                        candidate.generation = this.generation
                        candidate.ufrag = this.localUsername
                        this.appendLocalCandidate(candidate)
                        return candidate
                    })()
                    let timer: ReturnType<typeof setTimeout> | undefined
                    const timeLimit = new Promise<void>((_, f) => {
                        timer = setTimeout(() => f(new Error('STUN query timeout')), timeout * 1000)
                    })
                    return Promise.race([query, timeLimit])
                        .finally(() => clearTimeout(timer))
                        .catch((error) => {
                            log('query STUN server', error)
                        })
                })
            )

            candidatePromises.push(...stunCandidatePromises)
        }

        if (!gatherIceLite) {
            candidatePromises.push(...this.gatherRelayCandidates(relayServers))
        }

        return candidatePromises
    }

    async connect() {
    // """
    // Perform ICE handshake.
    //
    // This coroutine returns if a candidate pair was successfully nominated
    // and raises an exception otherwise.
    // """
        log('start connect ice')
        if (!this.localCandidatesEnd) {
            if (!this.localCandidatesStart) {
                throw new Error('Local candidates gathering was not performed')
            }
        }
        if (!this.remoteUsername || !this.remotePassword) {
            throw new Error('Remote username or password is missing')
        }

        // # 5.7.1. Forming Candidate Pairs
        for (const c of this.remoteCandidates) {
            this.pairRemoteCandidate(c)
        }
        this.sortCheckList()

        if (!this.iceLite) {
            this.unfreezeInitial()
        }

        log('earlyChecks', this.localPassword, this.earlyChecks.length)
        // # handle early checks
        for (const earlyCheck of this.earlyChecks) {
            this.checkIncoming(...earlyCheck)
        }
        this.earlyChecks = []
        this.earlyChecksDone = true

        if (this.iceLite) {
            if (!this.nominated) {
                let res: number = ICE_FAILED
                while (!this.checkListDone && this.state !== 'closed') {
                    res = await this.checkListState.get()
                    log('checkListState', res)
                    if (res === ICE_COMPLETED) {
                        break
                    }
                }

                if (res !== ICE_COMPLETED && !this.nominated) {
                    throw new Error('ICE negotiation failed')
                }
            }

            this.setState('connected')
            return
        }

        // # perform checks
        // 5.8.  Scheduling Checks
        for (;;) {
            if (this.state === 'closed') break
            if (!this.schedulingChecks()) break
            await timers.setTimeout(20)
        }

        // # wait for completion (closing the connection ends the wait)
        let res: number = ICE_FAILED
        while (this.checkList.length > 0 && res === ICE_FAILED && this.state !== 'closed') {
            res = await this.checkListState.get()
            log('checkListState', res)
        }

        // # cancel remaining checks
        for (const check of this.checkList) {
            check.handle?.resolve?.()
        }

        if (res !== ICE_COMPLETED) {
            throw new Error('ICE negotiation failed')
        }

        // # start consent freshness tests
        this.queryConsent()

        this.setState('connected')
    }

    private unfreezeInitial() {
    // # unfreeze first pair for the first component
        const [firstPair] = this.checkList
        if (!firstPair) return
        if (firstPair.state === CandidatePairState.FROZEN) {
            firstPair.updateState(CandidatePairState.WAITING)
        }

        // # unfreeze pairs with same component but different foundations
        const seenFoundations = new Set(firstPair.localCandidate.foundation)
        for (const pair of this.checkList) {
            if (
                pair.component === firstPair.component &&
        !seenFoundations.has(pair.localCandidate.foundation) &&
        pair.state === CandidatePairState.FROZEN
            ) {
                pair.updateState(CandidatePairState.WAITING)
                seenFoundations.add(pair.localCandidate.foundation)
            }
        }
    }

    // 5.8 Scheduling Checks
    private schedulingChecks() {
    // Ordinary Check
        {
            // # find the highest-priority pair that is in the waiting state
            const pair = this.checkList
                .filter((pair) => {
                    if (
                        this.options.forceTurn &&
            pair.protocol.type === StunProtocol.type
                    )
                        return false
                    return true
                })
                .find((pair) => pair.state === CandidatePairState.WAITING)
            if (pair) {
                pair.handle = this.checkStart(pair)
                return true
            }
        }

        {
            // # find the highest-priority pair that is in the frozen state
            const pair = this.checkList.find(
                (pair) => pair.state === CandidatePairState.FROZEN
            )
            if (pair) {
                pair.handle = this.checkStart(pair)
                return true
            }
        }

        // # if we expect more candidates, keep going
        if (!this.remoteCandidatesEnd) {
            return !this.checkListDone
        }

        return false
    }

    /**
   * Stop consent request cadence, expiry timer, and outstanding transactions.
   * Does not change ICE state by itself.
   */
    private stopConsentLifecycle() {
        this.consentSessionId++
        this.consentFresh = false
        if (this.consentExpiryTimer !== undefined) {
            clearTimeout(this.consentExpiryTimer)
            this.consentExpiryTimer = undefined
        }
        this.consentRequestAbort?.abort()
        this.consentRequestAbort = undefined
        const handle = this.queryConsentHandle
        this.queryConsentHandle = undefined
        // Resolve after clearing the field so a stale onCancel cannot wipe a replacement.
        handle?.resolve?.()
    }

    /**
   * ICE-lite interop only (not required by RFC 7675): mirror libwebrtc
   * semi-aggressive nomination — attach USE-CANDIDATE when we are controlling,
   * the remote is ICE-lite, and the target is the current selected pair.
   */
    private shouldNominateConsentRequest(pair: CandidatePair): boolean {
        return (
            this.iceControlling && this.remoteIsLite && this.nominated?.id === pair.id
        )
    }

    private canSendApplicationData(): boolean {
        if (!this.nominated) {
            return false
        }
        if (this.state === 'closed' || this.state === 'failed') {
            return false
        }
        // Local ICE-lite does not run consent checks; full agents need fresh consent.
        if (this.iceLite) {
            return true
        }
        return this.consentFresh
    }

    private abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
        return new Promise((resolve, reject) => {
            if (signal.aborted) {
                reject(new DOMException('The operation was aborted', 'AbortError'))
                return
            }
            const timer = setTimeout(() => {
                signal.removeEventListener('abort', onAbort)
                resolve()
            }, ms)
            const onAbort = () => {
                clearTimeout(timer)
                reject(new DOMException('The operation was aborted', 'AbortError'))
            }
            signal.addEventListener('abort', onAbort, {once: true})
        })
    }

    // RFC 7675 consent freshness
    private queryConsent = () => {
        if (this.iceLite) {
            return
        }

        // Invalidate any previous consent session before starting a new one.
        this.stopConsentLifecycle()
        const sessionId = this.consentSessionId
        this.consentFresh = true

        const handle = cancelable<void>(async (_, __, onCancel) => {
            let canceled = false
            const cancelEvent = new AbortController()

            const clearConsentExpiry = () => {
                if (this.consentExpiryTimer === undefined) {
                    return
                }
                clearTimeout(this.consentExpiryTimer)
                this.consentExpiryTimer = undefined
            }

            const refreshConsentExpiry = () => {
                // Only the active session may refresh the shared expiry timer.
                if (canceled || sessionId !== this.consentSessionId) {
                    return
                }
                clearConsentExpiry()
                this.consentExpiryTimer = setTimeout(() => {
                    this.consentExpiryTimer = undefined
                    if (canceled || sessionId !== this.consentSessionId) {
                        return
                    }
                    if (this.state === 'closed' || this.state === 'failed') {
                        return
                    }
                    log('Consent to send expired')
                    // Expire independently of request cadence / failure count (RFC 7675).
                    this.consentFresh = false
                    this.consentSessionId++
                    this.consentRequestAbort?.abort()
                    this.consentRequestAbort = undefined
                    if (this.queryConsentHandle === handle) {
                        this.queryConsentHandle = undefined
                    }
                    canceled = true
                    cancelEvent.abort()
                    // Transport stays available for ICE restart; explicit close() uses "closed".
                    this.setState('failed')
                }, CONSENT_TIMEOUT * 1000)
            }

            onCancel.once(() => {
                canceled = true
                // Avoid clearing a replacement session's timer/handle.
                if (sessionId === this.consentSessionId) {
                    clearConsentExpiry()
                    this.consentRequestAbort?.abort()
                    this.consentRequestAbort = undefined
                }
                cancelEvent.abort()
                if (this.queryConsentHandle === handle) {
                    this.queryConsentHandle = undefined
                }
            })

            // Initial ICE check success is the first valid consent response.
            refreshConsentExpiry()

            const randomizedConsentInterval = () =>
                CONSENT_INTERVAL * (0.8 + 0.4 * Math.random()) * 1000

            // Cadence is measured between request *starts*, not response completions.
            let nextConsentAt = Date.now() + randomizedConsentInterval()
            const isTerminalState = () =>
                this.state === 'closed' || this.state === 'failed'

            try {
                while (
                    !isTerminalState() &&
          !canceled &&
          sessionId === this.consentSessionId
                ) {
                    await this.abortableDelay(
                        Math.max(0, nextConsentAt - Date.now()),
                        cancelEvent.signal
                    )

                    if (
                        canceled ||
            isTerminalState() ||
            sessionId !== this.consentSessionId
                    ) {
                        break
                    }

                    // Fix next start time before awaiting any response (independent timers).
                    nextConsentAt = Date.now() + randomizedConsentInterval()

                    const nominated = this.nominated
                    if (!nominated) {
                        break
                    }

                    const pairId = nominated.id
                    const generation = this.generation
                    const remotePassword = this.remotePassword
                    const {localUsername, remoteUsername, iceControlling} = this

                    const request = this.buildRequest({
                        nominate: this.shouldNominateConsentRequest(nominated),
                        localUsername,
                        remoteUsername,
                        iceControlling,
                        localCandidate: nominated.localCandidate
                    })

                    this.consentRequestAbort?.abort()
                    const requestAbort = new AbortController()
                    this.consentRequestAbort = requestAbort

                    nominated.consentRequestsSent++
                    nominated.requestsSent++

                    // RTT-aware wait (floor 500ms); independent of retransmissions: 0.
                    const responseTimeout = consentResponseTimeoutMs(nominated.rtt)
                    const requestStartedAt = performance.now()

                    // Do not await here: response wait must not stretch the 4–6s cadence.
                    nominated.protocol
                        .request(
                            request,
                            nominated.remoteAddr,
                            Buffer.from(remotePassword, 'utf8'),
                            {
                                retransmissions: 0,
                                responseTimeout,
                                signal: requestAbort.signal,
                                onRequestSent: (attempt) => {
                                    if (attempt > 0) {
                                        nominated.retransmissionsSent++
                                    }
                                }
                            }
                        )
                        .then(() => {
                            // Accept only responses for the current pair / generation / session.
                            // Address / MESSAGE-INTEGRITY / response class are enforced in Transaction + protocol.
                            if (sessionId !== this.consentSessionId || canceled) {
                                return
                            }
                            const state = this.state
                            if (state === 'closed' || state === 'failed') {
                                return
                            }
                            if (this.nominated?.id !== pairId) {
                                return
                            }
                            if (this.generation !== generation) {
                                return
                            }
                            if (this.remotePassword !== remotePassword) {
                                return
                            }

                            const rtt = (performance.now() - requestStartedAt) / 1000 // seconds
                            nominated.rtt = rtt
                            nominated.totalRoundTripTime += rtt
                            nominated.roundTripTimeMeasurements++

                            nominated.responsesReceived++
                            this.consentFresh = true
                            refreshConsentExpiry()
                            if (state === 'disconnected') {
                                this.setState('connected')
                            }
                        })
                        .catch((error) => {
                            // Individual request loss is expected; keep monitoring (RFC 7675).
                            if (
                                sessionId === this.consentSessionId &&
                this.nominated?.id === pairId
                            ) {
                                log('no stun response', error)
                            }
                        })
                }
            } catch (error) {
                // Abort during delay is normal on cancel / expire.
            } finally {
                if (sessionId === this.consentSessionId) {
                    clearConsentExpiry()
                }
            }
        })
        this.queryConsentHandle = handle
    }

    async close() {
    // """
    // Close the connection.
    // """

        this.setState('closed')

        // # stop consent freshness tests
        this.stopConsentLifecycle()

        // # stop check list
        if (this.checkList && !this.checkListDone) {
            this.checkListState.put(
                new Promise((r) => {
                    r(ICE_FAILED)
                })
            )
        }

        this.nominated = undefined
        const protocols = this.protocols
        this.protocols = []
        this.relays.clear()
        //Together: closing a relay waits for its server to delete the allocation
        await Promise.all(protocols.map(async (protocol) => {
            await protocol.close?.()
        }))

        this.localCandidates = []

        this.lookup?.close?.()
        this.lookup = undefined
    }

    private setState(state: IceState) {
        this.state = state
        this.stateChanged.execute(state)
    }

    async addRemoteCandidate(remoteCandidate: Candidate | undefined) {
    // """
    // Add a remote candidate or signal end-of-candidates.

        // To signal end-of-candidates, pass `None`.

        // :param remote_candidate: A :class:`Candidate` instance or `None`.
        // """

        if (!remoteCandidate) {
            this.remoteCandidatesEnd = true
            return
        }

        if (remoteCandidate.host.includes('.local')) {
            try {
                if (!this.lookup) {
                    this.lookup = new MdnsLookup()
                }
                const host = await this.lookup.lookup(remoteCandidate.host)
                remoteCandidate.host = host
            } catch (error) {
                return
            }
        }

        try {
            validateRemoteCandidate(remoteCandidate)
        } catch (error) {
            return
        }

        //Known already: each description applied gives its candidates again
        if (this._remoteCandidates.some((known: Candidate): boolean => known.host === remoteCandidate.host
            && known.port === remoteCandidate.port
            && known.component === remoteCandidate.component
            && known.type === remoteCandidate.type
            && known.transport.toLowerCase() === remoteCandidate.transport.toLowerCase())) {
            return
        }
        log('addRemoteCandidate', remoteCandidate)
        this._remoteCandidates.push(remoteCandidate)

        this.pairRemoteCandidate(remoteCandidate)
        this.sortCheckList()
    }

    send = async (data: Buffer) => {
    // RFC 7675: after consent expiry, do not send application data on the 5-tuple.
        if (!this.canSendApplicationData()) {
            return
        }
        const activePair = this.nominated!
        await activePair.protocol.sendData(data, activePair.remoteAddr)

        // Update statistics
        activePair.packetsSent++
        activePair.bytesSent += data.length
    }

    getDefaultCandidate() {
        const candidates = this.localCandidates.sort(
            (a, b) => a.priority - b.priority
        )
        const [candidate] = candidates
        return candidate
    }

    // for test only
    set remoteCandidates(value: Candidate[]) {
        if (this.remoteCandidatesEnd)
            throw new Error('Cannot set remote candidates after end-of-candidates.')
        this._remoteCandidates = []
        for (const remoteCandidate of value) {
            try {
                validateRemoteCandidate(remoteCandidate)
            } catch (error) {
                continue
            }
            this._remoteCandidates.push(remoteCandidate)
        }

        this.remoteCandidatesEnd = true
    }
    get remoteCandidates() {
        return this._remoteCandidates
    }

    get candidatePairs() {
        return this.checkList
    }

    private sortCheckList() {
        sortCandidatePairs(this.checkList, this.iceControlling)
    }

    private findPair(protocol: Protocol, remoteCandidate: Candidate) {
        const pair = this.checkList.find(
            (pair) =>
                pair.protocol === protocol && pair.remoteCandidate === remoteCandidate
        )
        return pair
    }

    private applyIceControlling(iceControlling: boolean) {
        this._iceControlling = iceControlling
        for (const pair of this.checkList) {
            pair.iceControlling = iceControlling
        }
    }

    private switchRole(iceControlling: boolean) {
        log('switch role', iceControlling)
        // Role conflicts must be repaired even after a prior generation or while
        // connectivity checks are in flight (RFC 8445 §7.2.5.1 / §7.3.1.1).
        if (this.iceLite) {
            iceControlling = false
        }
        this.applyIceControlling(iceControlling)
        this.sortCheckList()
    }

    private checkComplete(pair: CandidatePair) {
        pair.handle = undefined
        if (pair.state === CandidatePairState.SUCCEEDED) {
            // Updating the Nominated Flag

            // https://www.rfc-editor.org/rfc/rfc8445#section-7.3.1.5,
            // Once the nominated flag is set for a component of a data stream, it
            // concludes the ICE processing for that component.  See Section 8.
            // So disallow overwriting of the pair nominated for that component
            //A candidate of the current session of the other side: the candidates and the pairs of a session before are gone
            //(restart), and the generation a candidate gives is the one the other side counts (Chrome gives 0 always),
            //so only its ufrag, when given, tells
            if (
                pair.nominated &&
        (pair.remoteCandidate.ufrag == undefined || pair.remoteCandidate.ufrag === this.remoteUsername) &&
        this.nominated == undefined
            ) {
                log('nominated', pair.toJSON())
                this.nominated = pair
                this.nominating = false
                this.pruneTcpConnections(pair)

                // After resetNominatedPair / renomination while already connected,
                // restart consent freshness on the new selected pair.
                if (
                    !this.iceLite &&
          (this.state === 'connected' || this.state === 'completed')
                ) {
                    this.queryConsent()
                }

                // 8.1.2.  Updating States

                // The agent MUST remove all Waiting and Frozen pairs in the check
                // list and triggered check queue for the same component as the
                // nominated pairs for that media stream.
                for (const p of this.checkList) {
                    if (
                        p.component === pair.component &&
            [CandidatePairState.WAITING, CandidatePairState.FROZEN].includes(
                p.state
            )
                    ) {
                        p.updateState(CandidatePairState.FAILED)
                    }
                }
            }

            // Once there is at least one nominated pair in the valid list for
            // every component of at least one media stream and the state of the
            // check list is Running:
            if (this.nominated) {
                if (!this.checkListDone) {
                    log('ICE completed')
                    this.checkListState.put(new Promise((r) => r(ICE_COMPLETED)))
                    this.checkListDone = true
                }
                return
            }

            log('not completed', pair.toJSON())

            // 7.1.3.2.3.  Updating Pair States
            for (const p of this.checkList) {
                if (
                    p.localCandidate.foundation === pair.localCandidate.foundation &&
          p.state === CandidatePairState.FROZEN
                ) {
                    p.updateState(CandidatePairState.WAITING)
                }
            }
        }

        this.nominateTcpPairIfReady()

        // A nomination request is still in flight; its result decides the outcome.
        if (this.nominating) {
            return
        }

        {
            const list = [CandidatePairState.SUCCEEDED, CandidatePairState.FAILED]
            if (this.checkList.find(({state}) => !list.includes(state))) {
                return
            }
        }

        if (!this.iceControlling) {
            const target = CandidatePairState.SUCCEEDED
            if (this.checkList.find(({state}) => state === target)) {
                return
            }
        }

        if (!this.checkListDone) {
            log('ICE failed')
            this.checkListState.put(
                new Promise((r) => {
                    r(ICE_FAILED)
                })
            )
        }
    }

    // 3.  Terminology : Check
    checkStart = (pair: CandidatePair) =>
        cancelable<void>(async (r) => {
            // """
            // Starts a check.
            // """

            log('check start', pair.toJSON())

            pair.updateState(CandidatePairState.IN_PROGRESS)
            const result: {response?: Message, addr?: Address} = {}
            const {remotePassword, remoteUsername, generation} = this
            const localUsername = pair.localCandidate.ufrag ?? this.localUsername

            // TCP pairs use regular nomination (see nominateTcpPairIfReady).
            const nominate =
                this.iceControlling && !this.remoteIsLite && !this.isTcpPair(pair)
            const request = this.buildRequest({
                nominate,
                localUsername,
                remoteUsername,
                iceControlling: this.iceControlling,
                localCandidate: pair.localCandidate
            })

            // Record start time for RTT calculation
            const startTime = performance.now()

            try {
                pair.requestsSent++
                const [response, addr] = await pair.protocol.request(
                    request,
                    pair.remoteAddr,
                    Buffer.from(remotePassword, 'utf8'),
                    this.checkRequestOptions(pair)
                )
                pair.responsesReceived++

                // Calculate RTT
                const endTime = performance.now()
                const rtt = (endTime - startTime) / 1000 // Convert to seconds

                // Update RTT statistics
                pair.rtt = rtt
                pair.totalRoundTripTime += rtt
                pair.roundTripTimeMeasurements++

                log('response received', request.toJSON(), response.toJSON(), addr, {
                    localUsername,
                    remoteUsername,
                    remotePassword,
                    generation,
                    rtt
                })
                result.response = response
                result.addr = addr
            } catch (error: any) {
                const exc: TransactionError = error
                // 7.1.3.1.  Failure Cases
                log(
                    'failure case',
                    request.toJSON(),
                    exc.response ? JSON.stringify(exc.response.toJSON(), null, 2) : error,
                    {
                        localUsername,
                        remoteUsername,
                        remotePassword,
                        generation
                    },
                    pair.remoteAddr
                )
                if (exc.response?.getAttributeValue('ERROR-CODE')[0] === 487) {
                    if (request.attributesKeys.includes('ICE-CONTROLLED')) {
                        this.switchRole(true)
                    } else if (request.attributesKeys.includes('ICE-CONTROLLING')) {
                        this.switchRole(false)
                    }
                    await this.checkStart(pair).awaitable
                    r()
                    return
                }
                if (exc.response?.getAttributeValue('ERROR-CODE')[0] === 401) {
                    log('retry 401', pair.toJSON())
                    await this.checkStart(pair).awaitable
                    r()
                    return
                } else {
                    // timeout
                    log('checkStart CandidatePairState.FAILED', pair.toJSON())
                    pair.updateState(CandidatePairState.FAILED)
                    this.checkComplete(pair)
                    r()
                    return
                }
            }

            // # check remote address matches
            if (
                result.addr[0] !== pair.remoteAddr[0] ||
        result.addr[1] !== pair.remoteAddr[1]
            ) {
                pair.updateState(CandidatePairState.FAILED)
                this.checkComplete(pair)
                r()
                return
            }

            // # success
            if (nominate || pair.remoteNominated) {
                // # nominated by agressive nomination or the remote party
                pair.nominated = true
            } else if (this.usesTcpRegularNomination(pair)) {
                // # nominated later by nominateTcpPairIfReady (from checkComplete)
            } else if (this.iceControlling && !this.nominating) {
                // # perform regular nomination
                this.nominating = true
                const request = this.buildRequest({
                    nominate: true,
                    localUsername,
                    remoteUsername,
                    iceControlling: this.iceControlling,
                    localCandidate: pair.localCandidate
                })
                try {
                    pair.requestsSent++
                    await pair.protocol.request(
                        request,
                        pair.remoteAddr,
                        Buffer.from(this.remotePassword, 'utf8'),
                        this.checkRequestOptions(pair)
                    )
                    pair.responsesReceived++
                } catch (error) {
                    this.nominating = false
                    pair.updateState(CandidatePairState.FAILED)
                    this.checkComplete(pair)
                    return
                }
                pair.nominated = true
            }

            pair.updateState(CandidatePairState.SUCCEEDED)
            this.checkComplete(pair)
            r()
        })

    private isTcpPair(pair: CandidatePair) {
        return pair.localCandidate.transport.toLowerCase() === 'tcp'
    }

    /**
   * Aggressive nomination lets each side settle on whichever TCP connection
   * finished first; the two sides can then pick different connections and
   * pruning destroys the peer's choice. For TCP the controlling agent instead
   * nominates exactly one valid pair (RFC 8445 §8.1.1 regular nomination).
   */
    private usesTcpRegularNomination(pair: CandidatePair) {
        return this.iceControlling && !this.remoteIsLite && this.isTcpPair(pair)
    }

    private checkRequestOptions(pair: CandidatePair): TransactionRequestOptions {
        const onRequestSent = (attempt: number) => {
            if (attempt > 0) {
                pair.retransmissionsSent++
            }
        }
        if (this.isTcpPair(pair)) {
            // RFC 5389 §7.2.2: no retransmissions over a reliable transport.
            return {
                retransmissions: 0,
                responseTimeout: TCP_CHECK_RESPONSE_TIMEOUT_MS,
                onRequestSent
            }
        }
        return {retransmissions: 4, onRequestSent}
    }

    /**
   * Controlling side: nominate the highest-priority TCP pair once every
   * higher-priority TCP pair has finished its check, so the choice does not
   * depend on which connection happened to complete first.
   */
    private nominateTcpPairIfReady() {
        if (
            !this.iceControlling ||
      this.remoteIsLite ||
      this.nominated ||
      this.nominating
        ) {
            return
        }

        for (const pair of this.checkList) {
            if (!this.isTcpPair(pair)) {
                continue
            }
            if (pair.state === CandidatePairState.SUCCEEDED) {
                this.nominateTcpPair(pair)
                return
            }
            if (pair.state !== CandidatePairState.FAILED) {
                // A higher-priority pair may still succeed.
                return
            }
        }
    }

    private nominateTcpPair(pair: CandidatePair) {
        this.nominating = true
        const {generation} = this
        const request = this.buildRequest({
            nominate: true,
            localUsername: pair.localCandidate.ufrag ?? this.localUsername,
            remoteUsername: this.remoteUsername,
            iceControlling: this.iceControlling,
            localCandidate: pair.localCandidate
        })
        pair.requestsSent++

        pair.protocol
            .request(
                request,
                pair.remoteAddr,
                Buffer.from(this.remotePassword, 'utf8'),
                this.checkRequestOptions(pair)
            )
            .then(
                () => {
                    if (this.isStaleNomination(pair, generation)) {
                        return
                    }
                    pair.responsesReceived++
                    pair.nominated = true
                    this.nominating = false
                    this.checkComplete(pair)
                },
                (error) => {
                    if (this.isStaleNomination(pair, generation)) {
                        return
                    }
                    log('tcp nomination failed', pair.toJSON(), error)
                    this.nominating = false
                    pair.updateState(CandidatePairState.FAILED)
                    this.checkComplete(pair)
                }
            )
    }

    /** The agent was closed or restarted while the nomination was in flight. */
    private isStaleNomination(pair: CandidatePair, generation: number) {
        return (
            this.state === 'closed' ||
      this.generation !== generation ||
      !this.checkList.includes(pair)
        )
    }

    private addPair(pair: CandidatePair) {
        this.checkList.push(pair)
        this.sortCheckList()
    }

    // 7.2.  STUN Server Procedures
    // 7.2.1.3、7.2.1.4、および7.2.1.5
    checkIncoming(message: Message, addr: Address, protocol: Protocol) {
    // """
    // Handle a successful incoming check.
    // """

        const txUsername = message.getAttributeValue('USERNAME')
        const {remoteUsername: localUsername} = decodeTxUsername(txUsername)

        // find remote candidate
        let remoteCandidate: Candidate | undefined
        const [host, port] = addr
        for (const c of this.remoteCandidates) {
            if (c.host === host && c.port === port) {
                remoteCandidate = c
                break
            }
        }
        if (!remoteCandidate) {
            // 7.2.1.3.  Learning Peer Reflexive Candidates
            remoteCandidate = new Candidate(
                randomString(10),
                1,
                protocol.localCandidate?.transport ?? 'udp',
                message.getAttributeValue('PRIORITY'),
                host,
                port,
                'prflx',
                undefined,
                undefined,
                protocol.localCandidate?.transport === 'tcp'
                    ? remoteTcpTypeForIncoming(protocol.localCandidate.tcptype)
                    : undefined,
                undefined,
                undefined
            )
            this._remoteCandidates.push(remoteCandidate)
        }

        // find pair
        let pair = this.findPair(protocol, remoteCandidate)
        if (!pair) {
            pair = new CandidatePair(protocol, remoteCandidate, this.iceControlling)
            pair.updateState(CandidatePairState.WAITING)
            this.addPair(pair)
        }
        pair.noteIncomingRequest(message.transactionIdHex)
        pair.requestsReceived++
        pair.responsesSent++
        pair.localCandidate.ufrag = localUsername

        log('Triggered Checks', message.toJSON(), pair.toJSON(), {
            localUsername: this.localUsername,
            remoteUsername: this.remoteUsername,
            localPassword: this.localPassword,
            remotePassword: this.remotePassword,
            generation: this.generation
        })

        if (this.iceLite) {
            if (
                message.attributesKeys.includes('USE-CANDIDATE') &&
        !this.iceControlling
            ) {
                pair.remoteNominated = true
                pair.nominated = true
                pair.updateState(CandidatePairState.SUCCEEDED)
                this.checkComplete(pair)
            }
            return
        }

        // 7.2.1.4.  Triggered Checks
        if (
            [CandidatePairState.WAITING, CandidatePairState.FAILED].includes(
                pair.state
            )
        ) {
            pair.handle = this.checkStart(pair)
        }

        // 7.2.1.5. Updating the Nominated Flag
        if (
            message.attributesKeys.includes('USE-CANDIDATE') &&
      !this.iceControlling
        ) {
            pair.remoteNominated = true
            if (pair.state === CandidatePairState.SUCCEEDED) {
                pair.nominated = true
                this.checkComplete(pair)
            }
        }
    }

    private tryPair(protocol: Protocol, remoteCandidate: Candidate) {
        if (
            protocol.localCandidate?.canPairWith(remoteCandidate) &&
      !(
          protocol.localCandidate.transport.toLowerCase() === 'tcp' &&
        protocol.localCandidate.tcptype === 'passive' &&
        remoteCandidate.type !== 'prflx'
      ) &&
      !this.findPair(protocol, remoteCandidate)
        ) {
            const pair = new CandidatePair(
                protocol,
                remoteCandidate,
                this.iceControlling
            )
            if (
                this.options.filterCandidatePair &&
        !this.options.filterCandidatePair(pair)
            ) {
                return
            }
            pair.updateState(CandidatePairState.WAITING)
            this.addPair(pair)
        }
    }

    private pairLocalProtocol(protocol: Protocol) {
        for (const remoteCandidate of this.remoteCandidates) {
            this.tryPair(protocol, remoteCandidate)
        }
    }

    private pairRemoteCandidate = (remoteCandidate: Candidate) => {
        for (const protocol of this.protocols) {
            this.tryPair(protocol, remoteCandidate)
        }
    }

    private buildRequest({
        nominate,
        remoteUsername,
        localUsername,
        iceControlling,
        localCandidate
    }: {
        nominate: boolean
        remoteUsername: string
        localUsername: string
        iceControlling: boolean
        localCandidate?: Candidate
    }) {
        const txUsername = encodeTxUsername({remoteUsername, localUsername})
        const request = new Message(methods.BINDING, classes.REQUEST)
        request.setAttribute('USERNAME', txUsername).setAttribute(
            'PRIORITY',
            candidatePriority('prflx', {
                transport: localCandidate?.transport,
                tcptype: localCandidate?.tcptype
            })
        )
        if (iceControlling) {
            request.setAttribute('ICE-CONTROLLING', this.tieBreaker)
            if (nominate) {
                request.setAttribute('USE-CANDIDATE', null)
            }
        } else {
            request.setAttribute('ICE-CONTROLLED', this.tieBreaker)
        }
        return request
    }

    private pruneTcpConnections(selectedPair: CandidatePair) {
        for (const protocol of this.protocols) {
            if (protocol.localCandidate?.transport.toLowerCase() !== 'tcp') {
                continue
            }

            if (
                'pruneForSelection' in protocol &&
        typeof protocol.pruneForSelection === 'function'
            ) {
                void protocol.pruneForSelection(
                    protocol === selectedPair.protocol
                        ? selectedPair.remoteAddr
                        : undefined
                )
            }
        }
    }

    private respondError(
        request: Message,
        addr: Address,
        protocol: Protocol,
        errorCode: [number, string]
    ) {
        const response = new Message(
            request.messageMethod,
            classes.ERROR,
            request.transactionId
        )
        response
            .setAttribute('ERROR-CODE', errorCode)
            .addMessageIntegrity(Buffer.from(this.localPassword, 'utf8'))
            .addFingerprint()
        protocol.sendStun(response, addr).catch((e) => {
            log('sendStun error', e)
        })
    }
}

const encodeTxUsername = ({
    remoteUsername,
    localUsername
}: {
    remoteUsername: string
    localUsername: string
}) => {
    return `${remoteUsername}:${localUsername}`
}

const decodeTxUsername = (txUsername: string) => {
    const [remoteUsername, localUsername] = txUsername.split(':')
    return {remoteUsername, localUsername}
}
