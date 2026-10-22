import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {Controller, type HTTPContext} from '@lakutata/entrypoint'
import {DELETE, GET, OPTIONS, PATCH, POST, Prefix} from '@lakutata/entrypoint/decorator/ctrl'
import {bearerOf, linksOf, pathOf} from '../peer/Endpoints.js'
import type {SignalingDescription} from '../protocol/SignalingProtocol.js'
import {WHEPDeniedException} from '../exceptions/WHEPDeniedException.js'
import {WHEPMediaTypeException} from '../exceptions/WHEPMediaTypeException.js'
import {WHEPSessionNotFoundException} from '../exceptions/WHEPSessionNotFoundException.js'
import type {WHEP, WHEPSession} from './WHEP.js'

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
 * The input of a PATCH of a session
 */
class PatchDTO extends DTO {
    @Expect(DTO.String().min(1).max(256).required())
    public stream: string

    @Expect(DTO.String().min(1).max(64).required())
    public session: string

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
 * The HTTP interface of WHEP for the {@link WHEP} component registered as `whep`: a player plays a stream with
 * `POST /whep/:stream` (its SDP offer, receiving only, as `application/sdp`; its bearer token in the `Authorization`
 * header), gets the answer with the URL of its session (`201 Created`, `Location`), and ends it with `DELETE` on that
 * URL. It answers the CORS preflights (`OPTIONS`) of the browsers, `GET` with no content, and `PATCH` of a session
 * (`application/trickle-ice-sdpfrag`): the candidates of the viewer (trickle ICE), or an ICE restart, whose answer has
 * a new `ETag`. The URL of a session is the capability to end it: its id is random, and the DELETE and the PATCH are not
 * authorized again.
 *
 * Add it to the controllers of an entrypoint whose HTTP adapter reads the bodies of WHEP as text (its option
 * `body: {text: ['application/sdp', 'application/trickle-ice-sdpfrag']}`, without which Fastify refuses the PATCH
 * requests with 415). Its routes are under `/whep`; a subclass with `@Prefix({route: …})` gives them another prefix.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints} from 'lakutata/com/entrypoint'
 * import {Prefix} from 'lakutata/decorator/ctrl'
 * import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
 * import {buildSFUOptions, buildSignalingOptions, buildWHEPOptions, WHEPController} from '@lakutata/webrtc'
 *
 * //The endpoints under /watch: POST /watch/:stream
 * @Prefix({route: '/watch'})
 * class WatchController extends WHEPController {
 * }
 *
 * Application.run(() => ({
 *     id: 'live.app',
 *     name: 'Live',
 *     components: {
 *         signaling: buildSignalingOptions(),
 *         sfu: buildSFUOptions(),
 *         whep: buildWHEPOptions(),
 *         entrypoint: buildEntrypoints({
 *             controllers: [WatchController],
 *             http: expressHTTPEntrypoint({port: 8080, body: {text: ['application/sdp', 'application/trickle-ice-sdpfrag']}})
 *         })
 *     },
 *     bootstrap: ['sfu', 'entrypoint']
 * }))
 * ```
 */
@Prefix({route: '/whep'})
export class WHEPController extends Controller {

    /**
     * The WHEP component: the one registered as `whep`.
     * @protected
     */
    protected async whep(): Promise<WHEP> {
        return await this.getObject<WHEP>('whep')
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
        const whep: WHEP = await this.whep()
        this.http().response.setHeader('Access-Control-Allow-Origin', whep.allowedOrigin)
        this.http().response.setHeader('Access-Control-Expose-Headers', 'Location, Link, ETag')
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
     * Answer a GET of the endpoint of a stream with no content, as for WHIP (RFC 9725, section 4.1).
     * @returns Resolves once answered.
     */
    @GET('/:stream', StreamDTO)
    public async probe(): Promise<void> {
        await this.allowOrigin()
        this.http().response.writeHead(204).end()
    }

    /**
     * Answer a GET of a session with no content, as for WHIP (RFC 9725, section 4.1).
     * @returns Resolves once answered.
     */
    @GET('/:stream/:session', SessionDTO)
    public async sessionProbe(): Promise<void> {
        await this.allowOrigin()
        this.http().response.writeHead(204).end()
    }

    /**
     * Play a stream: answer the offer with `201 Created`, the answer, the URL of the session (`Location`) and the ICE
     * servers (`Link`).
     * @param input The stream, and the offer (the body).
     * @returns Resolves once answered.
     * @throws {WHEPMediaTypeException} When the body is not `application/sdp`.
     * @throws {WHEPDeniedException} When `authorize` refuses the stream (with `WWW-Authenticate: Bearer`).
     * @throws {WHEPLimitException} When the component has `maxSessions` sessions already.
     * @throws {WHEPOfferException} When the offer cannot be answered.
     */
    @POST('/:stream', StreamDTO)
    public async play(input: StreamDTO): Promise<void> {
        await this.allowOrigin()
        const {request, response} = this.http()
        if ((request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/sdp' || input.body === undefined) {
            throw new WHEPMediaTypeException('The offer is not application/sdp')
        }
        const whep: WHEP = await this.whep()
        let played: {session: WHEPSession, answer: SignalingDescription}
        try {
            played = await whep.play(input.stream, {type: 'offer', sdp: input.body}, {token: bearerOf(request), context: this.http()})
        } catch (error: unknown) {
            if (error instanceof WHEPDeniedException) response.setHeader('WWW-Authenticate', 'Bearer')
            throw error
        }
        const links: string[] = linksOf(await whep.iceServersOf(input.stream))
        const answer: Buffer = Buffer.from(played.answer.sdp ?? '')
        //Its length given: the players read the body to its end
        response.writeHead(201, {
            'Content-Type': 'application/sdp',
            'Content-Length': answer.length,
            'Location': `${pathOf(request)}/${played.session.id}`,
            'ETag': `"${whep.entityTagOf(played.session.id)}"`,
            ...links.length ? {Link: links} : {}
        }).end(answer)
    }

    /**
     * End a session.
     * @param input The stream and the session.
     * @returns Resolves once answered.
     * @throws {WHEPSessionNotFoundException} When the stream has no such session.
     */
    @DELETE('/:stream/:session', SessionDTO)
    public async stop(input: SessionDTO): Promise<void> {
        await this.allowOrigin()
        const whep: WHEP = await this.whep()
        //Ended on the node of the cluster holding it
        if (!(await whep.stop(input.session, input.stream))) {
            throw new WHEPSessionNotFoundException('The stream {stream} has no session {session}', {stream: input.stream, session: input.session})
        }
        this.http().response.writeHead(200, {'Content-Length': 0}).end()
    }

    /**
     * Apply the candidates of the viewer (trickle ICE: `204 No Content`), or restart ICE when its credentials
     * changed (`200 OK`, the fragment of the answer, and a new `ETag`), as RFC 9725 (section 4.3) does: an ICE restart
     * needs `If-Match: *`. An `If-Match` other than `*` and the `ETag` of the session, and new credentials without
     * `If-Match: *`, are answered with `412 Precondition Failed`.
     * @param input The stream, the session, and the fragment of SDP (the body).
     * @returns Resolves once answered.
     * @throws {WHEPMediaTypeException} When the body is not `application/trickle-ice-sdpfrag`.
     * @throws {WHEPSessionNotFoundException} When the stream has no such session on this node.
     * @throws {WHEPOfferException} When the fragment has no ICE, or the connection refuses it.
     */
    @PATCH('/:stream/:session', PatchDTO)
    public async patch(input: PatchDTO): Promise<void> {
        await this.allowOrigin()
        const {request, response} = this.http()
        if ((request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/trickle-ice-sdpfrag' || input.body === undefined) {
            throw new WHEPMediaTypeException('The fragment is not application/trickle-ice-sdpfrag')
        }
        const whep: WHEP = await this.whep()
        const tag: string | undefined = whep.entityTagOf(input.session)
        if (tag === undefined || whep.session(input.session)?.stream !== input.stream) {
            throw new WHEPSessionNotFoundException('The stream {stream} has no session {session}', {stream: input.stream, session: input.session})
        }
        //Any ICE session: *, quoted or not
        const ifMatch: string | undefined = request.headers['if-match']?.trim().replace(/^"\*"$/, '*')
        if (ifMatch !== undefined && ifMatch !== '*' && ifMatch !== `"${tag}"`) return void response.writeHead(412, {'Content-Length': 0}).end()
        //A restart only with If-Match: * (RFC 9725, section 4.3.2)
        const patched: {fragment?: string, tag: string, stale?: boolean} = await whep.patch(input.session, input.body, ifMatch === '*')
        if (patched.stale) return void response.writeHead(412, {'Content-Length': 0}).end()
        if (patched.fragment === undefined) return void response.writeHead(204).end()
        const fragment: Buffer = Buffer.from(patched.fragment)
        response.writeHead(200, {
            'Content-Type': 'application/trickle-ice-sdpfrag',
            'Content-Length': fragment.length,
            'ETag': `"${patched.tag}"`
        }).end(fragment)
    }
}
