import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {BaseContext, type ContextParams, ContextType} from './BaseContext.js'
import {IncomingMessage, ServerResponse} from 'node:http'
import {type HTTPContextParams} from '../types/HTTPContextParams.js'

/**
 * The context of a request served by an HTTP adapter (`expressHTTPEntrypoint`, `fastifyHTTPEntrypoint`):
 * `this.context` of a controller action declared with `@HTTPAction` or `@GET`…, when it runs for an HTTP request. It
 * gives the Node.js request and response, to read or set headers; once an action has sent the response itself (its
 * headers sent), the adapter writes neither its value nor its error.
 * @example
 * ```typescript
 * import {Controller, HTTPContext} from 'lakutata/com/entrypoint'
 * import {GET} from 'lakutata/decorator/ctrl'
 *
 * class AgentController extends Controller {
 *     //GET /agent: answered with the header Cache-Control and the JSON {"agent": "curl/8.0", "route": "/agent"}
 *     @GET('/agent')
 *     public async agent(): Promise<{ agent: string, route: string }> {
 *         if (!(this.context instanceof HTTPContext)) return {agent: '', route: ''}
 *         this.context.response.setHeader('Cache-Control', 'no-store')
 *         return {agent: this.context.request.headers['user-agent'] ?? '', route: this.context.route}
 *     }
 * }
 * ```
 */
export class HTTPContext<T extends Record<string, any> = {}> extends BaseContext<T> {

    /**
     * Always `ContextType.HTTP`.
     */
    @Expect(DTO.String().valid(ContextType.HTTP).default(ContextType.HTTP))
    public readonly type: ContextType

    /**
     * The route of the action as declared, its controller prefix included (`'/users/:id'`), not the requested path.
     */
    @Expect(DTO.String().required())
    public readonly route: string

    /**
     * The HTTP method of the action, as declared (`'get'` for `@GET`).
     */
    @Expect(DTO.String().required())
    public readonly method: string

    /**
     * The Node.js request (the raw request of Fastify, the Express request).
     */
    @Expect(DTO.InstanceOf(IncomingMessage))
    public readonly request: IncomingMessage

    /**
     * The Node.js response (the raw reply of Fastify, the Express response).
     */
    @Expect(DTO.InstanceOf(ServerResponse))
    public readonly response: ServerResponse

    /**
     * Create the context of an HTTP request, validating its properties.
     * @param params The route, the method, the request, the response and the data of the request.
     * @throws {InvalidValueException} When a property is invalid or a required one is missing.
     */
    constructor(params: ContextParams<HTTPContextParams>) {
        super(params)
    }
}
