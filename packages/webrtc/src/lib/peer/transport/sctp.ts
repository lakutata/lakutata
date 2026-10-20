import {randomUUID} from 'node:crypto'

import {Event, debug, detached, runDetached} from '../imports/common.js'

import {
    SCTP,
    type SCTPOptions,
    SCTP_STATE,
    type Transport
} from '../../sctp/index.js'
import {
    DATA_CHANNEL_ACK,
    DATA_CHANNEL_OPEN,
    DATA_CHANNEL_RELIABLE,
    WEBRTC_BINARY,
    WEBRTC_BINARY_EMPTY,
    WEBRTC_DCEP,
    WEBRTC_STRING,
    WEBRTC_STRING_EMPTY
} from '../const.js'
import {
    type DCState,
    RTCDataChannel,
    RTCDataChannelParameters,
    getDataChannelMessageSize
} from '../dataChannel.js'
import type {RTCDtlsTransport} from './dtls.js'

const log = debug('webrtc/peer/transport/sctp')
export const DEFAULT_MAX_MESSAGE_SIZE = 65536

export class RTCSctpTransport {
    dtlsTransport!: RTCDtlsTransport
    sctp!: SCTP

    readonly onDataChannel = new Event<[RTCDataChannel]>()
    readonly id = randomUUID().toString()

    mid?: string
    mLineIndex?: number
    bundled = false
    dataChannels: {[key: number]: RTCDataChannel} = {}
    remoteMaxMessageSize = DEFAULT_MAX_MESSAGE_SIZE

    private dataChannelQueue: [RTCDataChannel, number, Buffer][] = []
    private dataChannelId?: number
    private eventDisposer: (() => void)[] = []

    constructor(
        public port = 5000,
        public maxMessageSize = DEFAULT_MAX_MESSAGE_SIZE,
        private readonly sctpOptions: SCTPOptions = {}
    ) {}

    get transport() {
        return this.dtlsTransport
    }

    setDtlsTransport(dtlsTransport: RTCDtlsTransport) {
        if (this.dtlsTransport && this.dtlsTransport.id === dtlsTransport.id) {
            return
        }

        this.eventDisposer.forEach((dispose) => dispose())

        this.dtlsTransport = dtlsTransport
        this.sctp = new SCTP(
            new BridgeDtls(this.dtlsTransport),
            this.port,
            this.sctpOptions
        )

        this.eventDisposer = [
            ...[
                this.sctp.onReceive.subscribe(detached(this.datachannelReceive, (error) => log('receive failed', error))),
                this.sctp.onReconfigStreams.subscribe((ids: number[]) => {
                    ids.forEach((id) => {
                        const dc = this.dataChannels[id]
                        if (!dc) return
                        // todo fix
                        dc.setReadyState('closing')
                        dc.setReadyState('closed')
                        delete this.dataChannels[id]
                    })
                }),
                this.sctp.stateChanged.connected.subscribe(() => {
                    Object.values(this.dataChannels).forEach((channel) => {
                        if (channel.negotiated && channel.readyState !== 'open') {
                            channel.setReadyState('open')
                        }
                    })
                    this.dataChannelFlush().catch((error) => log('flush failed', error))
                }),
                this.sctp.stateChanged.closed.subscribe(() => {
                    Object.values(this.dataChannels).forEach((dc) => {
                        dc.setReadyState('closed')
                    })
                    this.dataChannels = {}
                }),
                this.dtlsTransport.onStateChange.subscribe((state) => {
                    if (state === 'closed') {
                        this.sctp.setState(SCTP_STATE.CLOSED)
                    }
                })
            ].map((e) => e.unSubscribe),
            () => (this.sctp.onSackReceived = async () => {}),
            () => (this.sctp.onSent = undefined)
        ]

        this.sctp.onSackReceived = async () => {
            await this.dataChannelFlush()
        }
        //A message leaves the send buffer of its channel when SCTP sends its chunks (bufferedAmount, W3C WebRTC)
        this.sctp.onSent = (streamId, ppId, bytes) => {
            if (
                ppId === WEBRTC_DCEP ||
        ppId === WEBRTC_STRING_EMPTY ||
        ppId === WEBRTC_BINARY_EMPTY
            ) {
                return
            }
            this.dataChannels[streamId]?.addBufferedAmount(-bytes)
        }
    }

    private get isServer() {
        return this.dtlsTransport.iceTransport.role !== 'controlling'
    }

    channelByLabel(label: string) {
        return Object.values(this.dataChannels).find((d) => d.label === label)
    }

    private datachannelReceive = async (
        streamId: number,
        ppId: number,
        data: Buffer
    ) => {
        if (ppId === WEBRTC_DCEP && data.length > 0) {
            log('DCEP', streamId, ppId, data)
            switch (data[0]) {
                case DATA_CHANNEL_OPEN:
                    {
                        if (data.length < 12) {
                            log('DATA_CHANNEL_OPEN data.length not enough')
                            return
                        }

                        if (!Object.keys(this.dataChannels).includes(streamId.toString())) {
                            // !BBHLHH — 12 byte DCEP OPEN header (big-endian)
                            const channelType = data.readUInt8(1)
                            const reliability = data.readUInt32BE(4)
                            const labelLength = data.readUInt16BE(8)
                            const protocolLength = data.readUInt16BE(10)

                            let pos = 12
                            const label = data.slice(pos, pos + labelLength).toString('utf8')
                            pos += labelLength
                            const protocol = data
                                .slice(pos, pos + protocolLength)
                                .toString('utf8')

                            log('DATA_CHANNEL_OPEN', {
                                channelType,
                                reliability,
                                streamId,
                                label,
                                protocol
                            })

                            const maxRetransmits =
                                (channelType & 0x03) === 1 ? reliability : undefined
                            const maxPacketLifeTime =
                                (channelType & 0x03) === 2 ? reliability : undefined

                            // # register channel
                            const parameters = new RTCDataChannelParameters({
                                label,
                                ordered: (channelType & 0x80) === 0,
                                maxPacketLifeTime,
                                maxRetransmits,
                                protocol,
                                id: streamId
                            })
                            const channel = new RTCDataChannel(this, parameters, false)
                            channel.isCreatedByRemote = true
                            this.dataChannels[streamId] = channel

                            this.onDataChannel.execute(channel)
                            channel.setReadyState('open')
                        } else {
                            log('datachannel already opened', 'retransmit ack')
                        }

                        const channel = this.dataChannels[streamId]
                        const ack = Buffer.allocUnsafe(1)
                        ack.writeUInt8(DATA_CHANNEL_ACK, 0)
                        this.dataChannelQueue.push([channel, WEBRTC_DCEP, ack])
                        await this.dataChannelFlush()
                    }
                    break
                case DATA_CHANNEL_ACK:
                    {
                        log('DATA_CHANNEL_ACK', streamId, ppId)
                        const channel = this.dataChannels[streamId]
                        if (!channel) {
                            throw new Error('channel not found')
                        }
                        channel.setReadyState('open')
                    }
                    break
            }
        } else {
            const channel = this.dataChannels[streamId]
            if (channel) {
                const msg = (() => {
                    switch (ppId) {
                        case WEBRTC_STRING:
                            return data.toString('utf8')
                        case WEBRTC_STRING_EMPTY:
                            return ''
                        case WEBRTC_BINARY:
                            return data
                        case WEBRTC_BINARY_EMPTY:
                            return Buffer.from([])
                        default:
                            throw new Error()
                    }
                })()

                // Update reception statistics
                channel.messagesReceived++
                channel.bytesReceived += data.length

                channel.onMessage.execute(msg)
                channel.emit('message', {data: msg})
                if (channel.onmessage) {
                    runDetached(() => channel.onmessage!({data: msg}), (error) => log('onmessage failed', error))
                }
            }
        }
    }

    dataChannelAddNegotiated(channel: RTCDataChannel) {
        if (channel.id == undefined) {
            throw new Error()
        }
        if (this.dataChannels[channel.id]) {
            throw new Error()
        }

        this.dataChannels[channel.id] = channel

        if (this.sctp.associationState === SCTP_STATE.ESTABLISHED) {
            channel.setReadyState('open')
        }
    }

    dataChannelOpen(channel: RTCDataChannel) {
        if (channel.id !== undefined) {
            if (this.dataChannels[channel.id])
                throw new Error(
                    `Data channel with ID ${channel.id} already registered`
                )
            this.dataChannels[channel.id] = channel
        }

        let channelType = DATA_CHANNEL_RELIABLE
        const priority = 0
        let reliability = 0

        if (!channel.ordered) {
            channelType = 0x80
        }
        if (channel.maxRetransmits !== null) {
            channelType = 1
            reliability = channel.maxRetransmits
        } else if (channel.maxPacketLifeTime !== null) {
            channelType = 2
            reliability = channel.maxPacketLifeTime
        }

        // 5.1.  DATA_CHANNEL_OPEN Message
        // !BBHLHH — message type / channel type / priority / reliability / label len / protocol len
        const data = Buffer.allocUnsafe(12)
        data.writeUInt8(DATA_CHANNEL_OPEN, 0)
        data.writeUInt8(channelType, 1)
        data.writeUInt16BE(priority, 2)
        data.writeUInt32BE(reliability, 4)
        data.writeUInt16BE(channel.label.length, 8)
        data.writeUInt16BE(channel.protocol.length, 10)
        const send = Buffer.concat([
            data,
            Buffer.from(channel.label, 'utf8'),
            Buffer.from(channel.protocol, 'utf8')
        ])
        this.dataChannelQueue.push([channel, WEBRTC_DCEP, send])
        this.dataChannelFlush().catch((error) => log('flush failed', error))
    }

    private async dataChannelFlush() {
    // """
    // Try to flush buffered data to the SCTP layer.

        // We wait until the association is established, as we need to know
        // whether we are a client or a server to correctly assign an odd/even ID
        // to the data channels.
        // """

        if (this.sctp.associationState != SCTP_STATE.ESTABLISHED) return

        while (this.dataChannelQueue.length > 0) {
            const [channel, protocol, userData] = this.dataChannelQueue.shift()!

            let streamId = channel.id
            if (streamId === undefined) {
                streamId = this.dataChannelId!
                while (Object.keys(this.dataChannels).includes(streamId.toString())) {
                    streamId += 2
                }
                this.dataChannels[streamId] = channel
                channel.setId(streamId)
            }

            //Queued in SCTP at once: its windows pace the sending, onSent lowers bufferedAmount
            if (protocol === WEBRTC_DCEP) {
                this.sctp
                    .send(streamId, protocol, userData, {
                        ordered: true
                    })
                    .catch((error: Error) => log('send dcep failed', error.message))
            } else {
                const expiry =
                    channel.maxPacketLifeTime !== null
                        ? Date.now() + channel.maxPacketLifeTime / 1000
                        : undefined

                this.sctp
                    .send(streamId, protocol, userData, {
                        expiry,
                        maxRetransmits: channel.maxRetransmits ?? undefined,
                        ordered: channel.ordered
                    })
                    .catch((error: Error) => log('send data failed', error.message))
            }
        }
        // Resetting the queue to empty array mitigates this.
        this.dataChannelQueue = []
    }

    private assertSendableMessageSize(size: number) {
        if (this.remoteMaxMessageSize !== 0 && size > this.remoteMaxMessageSize) {
            throw new Error(
                `max-message-size exceeded: ${size} > ${this.remoteMaxMessageSize}`
            )
        }
    }

    datachannelSend = (channel: RTCDataChannel, data: Buffer | string) => {
        const size = getDataChannelMessageSize(data)

        this.assertSendableMessageSize(size)
        channel.addBufferedAmount(size)

        //An empty message is one zero byte with the PPID of an empty message (RFC 8831 section 6.6)
        if (size === 0) {
            this.dataChannelQueue.push([
                channel,
                typeof data === 'string' ? WEBRTC_STRING_EMPTY : WEBRTC_BINARY_EMPTY,
                Buffer.from([0])
            ])
        } else {
            const userData = Buffer.isBuffer(data) ? data : Buffer.from(data)
            this.dataChannelQueue.push(
                typeof data === 'string'
                    ? [channel, WEBRTC_STRING, userData]
                    : [channel, WEBRTC_BINARY, userData]
            )
        }

        if (this.sctp.associationState !== SCTP_STATE.ESTABLISHED) {
            log('sctp not established', this.sctp.associationState)
        }

        this.dataChannelFlush().catch((error) => log('flush failed', error))

        return size
    }

    getCapabilities() {
        return RTCSctpTransport.getCapabilities(this.maxMessageSize)
    }

    static getCapabilities(maxMessageSize = DEFAULT_MAX_MESSAGE_SIZE) {
        return new RTCSctpCapabilities(maxMessageSize)
    }

    setRemoteMaxMessageSize(maxMessageSize?: number) {
        this.remoteMaxMessageSize = maxMessageSize ?? DEFAULT_MAX_MESSAGE_SIZE
    }

    setRemotePort(port: number) {
        this.sctp.setRemotePort(port)
    }

    async start(remotePort: number) {
        if (this.isServer) {
            this.dataChannelId = 0
        } else {
            this.dataChannelId = 1
        }
        this.sctp.isServer = this.isServer

        await this.sctp.start(remotePort)
    }

    async stop() {
        this.dtlsTransport.dataReceiver = () => {}
        await this.sctp.stop()
    }

    dataChannelClose(channel: RTCDataChannel) {
        if (!(['closing', 'closed'] as DCState[]).includes(channel.readyState)) {
            channel.setReadyState('closing')

            if (this.sctp.associationState === SCTP_STATE.ESTABLISHED) {
                // Check if channel.id is already in reconfigQueue to prevent duplicates
                if (!this.sctp.reconfigQueue.includes(channel.id)) {
                    this.sctp.reconfigQueue.push(channel.id)
                }
                if (this.sctp.reconfigQueue.length === 1) {
                    this.sctp.transmitReconfigRequest().catch((error) => log('reconfig failed', error))
                }
            } else {
                this.dataChannelQueue = this.dataChannelQueue.filter(
                    (queueItem) => queueItem[0].id !== channel.id
                )
                // Remove any pending reconfiguration requests for this channel
                this.sctp.reconfigQueue = this.sctp.reconfigQueue.filter(
                    (streamId) => streamId !== channel.id
                )
                if (channel.id !== undefined) {
                    delete this.dataChannels[channel.id]
                }
                channel.setReadyState('closed')
            }
        }
    }
}

export class RTCSctpCapabilities {
    constructor(public maxMessageSize: number) {}
}

class BridgeDtls implements Transport {
    constructor(private dtls: RTCDtlsTransport) {}
    set onData(onData: (buf: Buffer) => void) {
        this.dtls.dataReceiver = onData
    }
    readonly send = (data: Buffer) => {
        return this.dtls.sendData(data)
    }
    close() {}
}
