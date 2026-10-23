import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {Controller, type ServiceContext} from '@lakutata/entrypoint'
import {ServiceAction} from '@lakutata/entrypoint/decorator/ctrl'
import {
    type SignalingCandidate,
    type SignalingDescription,
    type SignalingIceServer,
    type SignalingJoinResult,
    SignalingMethod
} from '../protocol/SignalingProtocol.js'
import {SignalingClientRequiredException} from '../exceptions/SignalingClientRequiredException.js'
import type {Signaling} from './Signaling.js'

/**
 * The input of `webrtc.join`
 */
class JoinDTO extends DTO {
    @Expect(DTO.String().min(1).max(256).required())
    public room: string

    @Expect(DTO.Any().optional())
    public metadata?: unknown

    @Expect(DTO.String().max(128).optional())
    public session?: string
}

/**
 * The input of `webrtc.leave`
 */
class LeaveDTO extends DTO {
    @Expect(DTO.String().min(1).max(256).required())
    public room: string
}

/**
 * The input of `webrtc.signal`: a description or a candidate (null or an empty candidate for the end of the candidates)
 */
class SignalDTO extends DTO {
    @Expect(DTO.String().min(1).max(256).required())
    public room: string

    @Expect(DTO.String().min(1).max(256).required())
    public to: string

    @Expect(DTO.Object({
        type: DTO.String().valid('offer', 'answer', 'pranswer', 'rollback').required(),
        sdp: DTO.String().allow('').optional()
    }).optional())
    public description?: SignalingDescription

    @Expect(DTO.Object({
        candidate: DTO.String().allow('').required(),
        sdpMid: DTO.String().allow('', null).optional(),
        sdpMLineIndex: DTO.Number().integer().min(0).allow(null).optional(),
        usernameFragment: DTO.String().allow('', null).optional()
    }).allow(null).optional())
    public candidate?: SignalingCandidate | null
}

/**
 * The controller serving the requests of the signaling ({@link Signaling}), registered as `signaling`): `webrtc.join`,
 * `webrtc.signal`, `webrtc.leave`, `webrtc.iceServers` and `webrtc.heartbeat`. Their pattern is `{method}`: the method
 * of a JSON-RPC request, the `method` field of a Socket.IO message (`{method: 'webrtc.join', room: 'meeting'}`). The
 * member of a request is its client (`clientId` of the context). The events are pushed to the clients, so the requests
 * coming without a connection to push them through (JSON-RPC over HTTP, the HTTP service adapter) fail with
 * {@link SignalingClientRequiredException}.
 *
 * Add it to the controllers of an entrypoint serving Socket.IO or JSON-RPC over WebSocket; the browser client of
 * `@lakutata/webrtc/client` and the `SignalingClient` of Node.js speak this protocol.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints} from 'lakutata/com/entrypoint'
 * import {jsonRPCServiceEntrypoint} from 'lakutata/adapter/jsonrpc'
 * import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
 * import {buildSignalingOptions, SignalingController} from '@lakutata/webrtc'
 *
 * Application.run(() => ({
 *     id: 'meet.app',
 *     name: 'Meet',
 *     components: {
 *         signaling: buildSignalingOptions(),
 *         //The browsers over Socket.IO on 3000, the other clients over JSON-RPC (WebSocket) on 3001
 *         entrypoint: buildEntrypoints({
 *             controllers: [SignalingController],
 *             service: [socketIOServiceEntrypoint({port: 3000}), jsonRPCServiceEntrypoint({transport: 'websocket', port: 3001})]
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * }))
 * ```
 */
export class SignalingController extends Controller {

    /**
     * The signaling component: the one registered as `signaling`.
     * @protected
     */
    protected async signaling(): Promise<Signaling> {
        return await this.getObject<Signaling>('signaling')
    }

    /**
     * The member of the request: its client id
     * @protected
     */
    protected peerId(): string {
        const context: ServiceContext & {jsonrpc?: {transport: string}} = this.context as ServiceContext & {jsonrpc?: {transport: string}}
        //JSON-RPC over HTTP gives a client id (the id header) but has no connection to push the events through; a data
        //channel of webrtcServiceEntrypoint is set up by the signaling itself (a member joining through it as itself
        //would replace its own session)
        if (!context.clientId || context.jsonrpc?.transport === 'http' || context.jsonrpc?.transport === 'webrtc') {
            throw new SignalingClientRequiredException('The signaling needs a transport with clients (Socket.IO, JSON-RPC over WebSocket)')
        }
        return context.clientId
    }

    /**
     * `webrtc.join`: join a room.
     * @param input The room, and the metadata the other members get.
     * @returns The members already in the room, the ICE servers and the heartbeat interval.
     * @example
     * ```typescript
     * //Socket.IO: socket.emit('message', {method: 'webrtc.join', room: 'meeting', metadata: {name: 'Ada'}}, ack)
     * //JSON-RPC: {"jsonrpc": "2.0", "id": 1, "method": "webrtc.join", "params": {"room": "meeting"}}
     * ```
     */
    @ServiceAction({method: SignalingMethod.join}, JoinDTO)
    public async join(input: JoinDTO): Promise<SignalingJoinResult> {
        return await (await this.signaling()).join(this.peerId(), input.room, {metadata: input.metadata, session: input.session, context: this.context as ServiceContext})
    }

    /**
     * `webrtc.signal`: send a description or a candidate to a member of a room.
     * @param input The room, the receiver, the description or the candidate.
     * @returns Whether the event reached the receiver.
     * @example
     * ```typescript
     * //{method: 'webrtc.signal', room: 'meeting', to: 'bob', description: {type: 'offer', sdp: '…'}}
     * //{method: 'webrtc.signal', room: 'meeting', to: 'bob', candidate: {candidate: 'candidate:…', sdpMid: '0'}}
     * ```
     */
    @ServiceAction({method: SignalingMethod.signal}, SignalDTO)
    public async sendSignal(input: SignalDTO): Promise<{delivered: boolean}> {
        const delivered: boolean = await (await this.signaling()).signal(this.peerId(), input.room, input.to, {
            description: input.description,
            candidate: input.candidate
        })
        return {delivered: delivered}
    }

    /**
     * `webrtc.leave`: leave a room.
     * @param input The room.
     * @returns Nothing.
     * @example
     * ```typescript
     * //{method: 'webrtc.leave', room: 'meeting'}
     * ```
     */
    @ServiceAction({method: SignalingMethod.leave}, LeaveDTO)
    public async leave(input: LeaveDTO): Promise<Record<string, never>> {
        await (await this.signaling()).leave(this.peerId(), input.room)
        return {}
    }

    /**
     * `webrtc.iceServers`: get the ICE servers again, with new TURN credentials (before the ones given expire).
     * @returns The ICE servers, and how long their credentials are valid in seconds.
     * @example
     * ```typescript
     * //{method: 'webrtc.iceServers'}
     * ```
     */
    @ServiceAction({method: SignalingMethod.iceServers})
    public async iceServers(): Promise<{iceServers: SignalingIceServer[], credentialTtl: number}> {
        const signaling: Signaling = await this.signaling()
        const peerId: string = this.peerId()
        signaling.heartbeat(peerId)
        return await signaling.iceServersOf(peerId)
    }

    /**
     * `webrtc.heartbeat`: tell the server the client is still there.
     * @returns Nothing.
     * @example
     * ```typescript
     * //{method: 'webrtc.heartbeat'}, every heartbeatInterval milliseconds of the join result when it is not 0
     * ```
     */
    @ServiceAction({method: SignalingMethod.heartbeat})
    public async heartbeat(): Promise<Record<string, never>> {
        (await this.signaling()).heartbeat(this.peerId())
        return {}
    }
}
