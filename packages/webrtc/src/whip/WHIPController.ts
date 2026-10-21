import type {IncomingMessage} from 'node:http'
import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {Controller, type HTTPContext} from '@lakutata/entrypoint'
import {DELETE, GET, OPTIONS, PATCH, POST, Prefix} from '@lakutata/entrypoint/decorator/ctrl'
import type {SignalingDescription, SignalingIceServer} from '../protocol/SignalingProtocol.js'
import {WHIPDeniedException} from '../exceptions/WHIPDeniedException.js'
import {WHIPMediaTypeException} from '../exceptions/WHIPMediaTypeException.js'
import {WHIPSessionNotFoundException} from '../exceptions/WHIPSessionNotFoundException.js'
import type {WHIP, WHIPSession} from './WHIP.js'

/**
 * The input of the requests to the endpoint of a stream
 */
class StreamDTO extends DTO {
    @Expect(DTO.String().min(1).max(256).required())
    public stream: string

    @Expect(DTO.String().optional())
    public body?: string
}

/**
 * The input of the requests to a session
 */
class SessionDTO extends DTO {
    @Expect(DTO.String().min(1).max(256).required())
    public stream: string

    @Expect(DTO.String().min(1).max(64).required())
    public session: string
}

/**
 * The bearer token of a request
 * @param request
 */
function bearerOf(request: IncomingMessage): string | undefined {
    return /^Bearer\s+(\S+)\s*$/i.exec(request.headers.authorization ?? '')?.[1]
}

/**
 * The path of a request, without its query and its last slash
 * @param request
 */
function pathOf(request: IncomingMessage): string {
    const url: string = (request as IncomingMessage & {originalUrl?: string}).originalUrl ?? request.url ?? ''
    return url.split('?')[0].replace(/\/+$/, '')
}

/**
 * A `Link` header of each ICE server (RFC 9725, section 4.6)
 * @param iceServers
 */
function linksOf(iceServers: SignalingIceServer[]): string[] {
    const quoted = (value: string): string => `"${value.replace(/["\\]/g, '\\$&')}"`
    return iceServers.flatMap((server: SignalingIceServer): string[] => (Array.isArray(server.urls) ? server.urls : [server.urls]).map((url: string): string => {
        const credentials: string = server.username && server.credential
            ? `; username=${quoted(server.username)}; credential=${quoted(server.credential)}; credential-type="password"`
            : ''
        return `<${url}>; rel="ice-server"${credentials}`
    }))
}

/**
 * The HTTP interface of WHIP (RFC 9725) for the {@link WHIP} component registered as `whip`: an encoder or a browser
 * publishes a stream with `POST /whip/:stream` (its SDP offer as `application/sdp`, its bearer token in the
 * `Authorization` header), gets the answer with the URL of its session (`201 Created`, `Location`), and ends it with
 * `DELETE` on that URL. It answers the CORS preflights (`OPTIONS`) of the browsers, `GET` with no content, and `PATCH`
 * with `405 Method Not Allowed` (no trickle ICE, no ICE restart). The URL of a session is the capability to end it: its
 * id is random, and the DELETE is not authorized again.
 *
 * Add it to the controllers of an entrypoint whose HTTP adapter reads the bodies of WHIP as text (its option
 * `body: {text: ['application/sdp', 'application/trickle-ice-sdpfrag']}`, without which Fastify refuses the PATCH
 * requests with 415). Its routes are under `/whip`; a subclass with `@Prefix({route: …})` gives them another prefix.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints} from 'lakutata/com/entrypoint'
 * import {Prefix} from 'lakutata/decorator/ctrl'
 * import {fastifyHTTPEntrypoint} from 'lakutata/adapter/fastify'
 * import {buildWHIPOptions, WHIPController} from '@lakutata/webrtc'
 *
 * //The endpoints under /live: POST /live/:stream
 * @Prefix({route: '/live'})
 * class LiveController extends WHIPController {
 * }
 *
 * Application.run(() => ({
 *     id: 'ingest.app',
 *     name: 'Ingest',
 *     components: {
 *         whip: buildWHIPOptions(),
 *         entrypoint: buildEntrypoints({
 *             controllers: [LiveController],
 *             http: fastifyHTTPEntrypoint({port: 8080, body: {text: ['application/sdp', 'application/trickle-ice-sdpfrag']}})
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * }))
 * ```
 */
@Prefix({route: '/whip'})
export class WHIPController extends Controller {

    /**
     * The WHIP component: the one registered as `whip`.
     * @protected
     */
    protected async whip(): Promise<WHIP> {
        return await this.getObject<WHIP>('whip')
    }

    /**
     * The HTTP context of the request
     * @protected
     */
    protected http(): HTTPContext {
        return this.context as HTTPContext
    }

    /**
     * Set the CORS headers of the response
     * @protected
     */
    protected async allowOrigin(): Promise<void> {
        const whip: WHIP = await this.whip()
        this.http().response.setHeader('Access-Control-Allow-Origin', whip.allowedOrigin)
        this.http().response.setHeader('Access-Control-Expose-Headers', 'Location, Link')
    }

    /**
     * Answer the CORS preflight of the endpoint of a stream.
     * @returns Resolves once answered.
     */
    @OPTIONS('/:stream', StreamDTO)
    public async preflight(): Promise<void> {
        await this.allowOrigin()
        this.http().response.writeHead(204, {
            'Access-Control-Allow-Methods': 'OPTIONS, GET, POST',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            'Access-Control-Max-Age': '86400',
            'Accept-Post': 'application/sdp'
        }).end()
    }

    /**
     * Answer the CORS preflight of a session.
     * @returns Resolves once answered.
     */
    @OPTIONS('/:stream/:session', SessionDTO)
    public async sessionPreflight(): Promise<void> {
        await this.allowOrigin()
        this.http().response.writeHead(204, {
            'Access-Control-Allow-Methods': 'OPTIONS, GET, DELETE, PATCH',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match',
            'Access-Control-Max-Age': '86400'
        }).end()
    }

    /**
     * Answer a GET of the endpoint of a stream with no content (RFC 9725, section 4.1).
     * @returns Resolves once answered.
     */
    @GET('/:stream', StreamDTO)
    public async probe(): Promise<void> {
        await this.allowOrigin()
        this.http().response.writeHead(204).end()
    }

    /**
     * Answer a GET of a session with no content (RFC 9725, section 4.1).
     * @returns Resolves once answered.
     */
    @GET('/:stream/:session', SessionDTO)
    public async sessionProbe(): Promise<void> {
        await this.allowOrigin()
        this.http().response.writeHead(204).end()
    }

    /**
     * Publish a stream: answer the offer with `201 Created`, the answer, the URL of the session (`Location`) and the ICE
     * servers (`Link`).
     * @param input The stream, and the offer (the body).
     * @returns Resolves once answered.
     * @throws {WHIPMediaTypeException} When the body is not `application/sdp`.
     * @throws {WHIPDeniedException} When `authorize` refuses the stream (with `WWW-Authenticate: Bearer`).
     * @throws {WHIPLimitException} When the component has `maxSessions` sessions already.
     * @throws {WHIPOfferException} When the offer cannot be answered.
     */
    @POST('/:stream', StreamDTO)
    public async publish(input: StreamDTO): Promise<void> {
        await this.allowOrigin()
        const {request, response} = this.http()
        if ((request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/sdp' || input.body === undefined) {
            throw new WHIPMediaTypeException('The offer is not application/sdp')
        }
        const whip: WHIP = await this.whip()
        let published: {session: WHIPSession, answer: SignalingDescription}
        try {
            published = await whip.publish(input.stream, {type: 'offer', sdp: input.body}, {token: bearerOf(request), context: this.http()})
        } catch (error: unknown) {
            if (error instanceof WHIPDeniedException) response.setHeader('WWW-Authenticate', 'Bearer')
            throw error
        }
        const links: string[] = linksOf(await whip.iceServersOf(input.stream))
        const answer: Buffer = Buffer.from(published.answer.sdp ?? '')
        //Its length given: the encoders read the body to its end (ffmpeg fails on a chunked one)
        response.writeHead(201, {
            'Content-Type': 'application/sdp',
            'Content-Length': answer.length,
            'Location': `${pathOf(request)}/${published.session.id}`,
            ...links.length ? {Link: links} : {}
        }).end(answer)
    }

    /**
     * End a session.
     * @param input The stream and the session.
     * @returns Resolves once answered.
     * @throws {WHIPSessionNotFoundException} When the stream has no such session.
     */
    @DELETE('/:stream/:session', SessionDTO)
    public async unpublish(input: SessionDTO): Promise<void> {
        await this.allowOrigin()
        const whip: WHIP = await this.whip()
        //Ended on the node of the cluster holding it
        if (!(await whip.unpublish(input.session, input.stream))) {
            throw new WHIPSessionNotFoundException('The stream {stream} has no session {session}', {stream: input.stream, session: input.session})
        }
        this.http().response.writeHead(200, {'Content-Length': 0}).end()
    }

    /**
     * Refuse the trickle ICE and the ICE restarts: `405 Method Not Allowed`.
     * @returns Resolves once answered.
     */
    @PATCH('/:stream/:session', SessionDTO)
    public async patch(): Promise<void> {
        await this.allowOrigin()
        this.http().response.writeHead(405, {'Allow': 'OPTIONS, GET, DELETE', 'Content-Length': 0}).end()
    }
}
