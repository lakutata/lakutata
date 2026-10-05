import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {BaseContext} from '@lakutata/entrypoint'
import {type MCPContextParams} from '../types/MCPContextParams.js'

/**
 * The `type` of every {@link MCPContext}: `'MCP'`. A middleware or an access rule shared by several transports tells
 * the MCP requests apart with it.
 */
export const MCP_CONTEXT_TYPE: string = 'MCP'

/**
 * What an MCP client asked for: `'tool'` a tool call (`tools/call`), `'resource'` a resource read
 * (`resources/read`), `'prompt'` a prompt (`prompts/get`).
 */
export type MCPRequestKind = 'tool' | 'resource' | 'prompt'

/**
 * The authentication of the client of an HTTP request, returned by the `authenticate` option of `httpMCPEntrypoint`
 * and given to the actions in {@link MCPContext.authInfo}. The adapter does not check it: the application decides
 * what it means (the access rules, the actions).
 */
export type MCPAuthInfo = {
    /**
     * The access token the client presented (the bearer token of its `Authorization` header).
     */
    token: string
    /**
     * The id of the client the token was issued to.
     */
    clientId: string
    /**
     * The scopes the token grants (`['devices:read']`).
     */
    scopes: string[]
    /**
     * When the token expires, in seconds since the Unix epoch.
     */
    expiresAt?: number
    /**
     * Any other information about the client or its user.
     */
    extra?: Record<string, unknown>
}

/**
 * The context of an MCP request: `this.context` of a controller action declared with `@MCPTool`, `@MCPResource` or
 * `@MCPPrompt` when a client calls the tool, reads the resource or gets the prompt through an MCP adapter. The adapter
 * creates one per request; its `data` is the request's arguments (empty for a resource: the variables of its URI are
 * merged into the action's input instead). When the client cancels the request, the action's abort signal is aborted.
 * @example
 * ```typescript
 * import {Controller} from 'lakutata/com/entrypoint'
 * import {MCPTool, type MCPContext} from '@lakutata/mcp'
 *
 * class ImportController extends Controller {
 *     @MCPTool('import', {description: 'Import the catalog'})
 *     public async import(): Promise<string> {
 *         const context: MCPContext = this.context as MCPContext
 *         //Sent to the client only when it asked for the progress of the call
 *         for (let step: number = 1; step <= 3; step++) await context.progress(step, 3, `step ${step}`)
 *         return `Imported by ${context.authInfo?.clientId ?? 'a local client'}`
 *     }
 * }
 * ```
 */
export class MCPContext<T extends Record<string, any> = {}> extends BaseContext<T> {

    /**
     * Always {@link MCP_CONTEXT_TYPE} (`'MCP'`).
     */
    @Expect(DTO.String().valid(MCP_CONTEXT_TYPE).default(MCP_CONTEXT_TYPE))
    public readonly type: string

    /**
     * What the client asked for: a tool call, a resource read or a prompt.
     */
    @Expect(DTO.String().valid('tool', 'resource', 'prompt').required())
    public readonly kind: MCPRequestKind

    /**
     * The name of the tool or the prompt, with its controller's prefix (`'device_status'`); for a resource, its URI or
     * URI template as declared (`'device://{sn}/status'`).
     */
    @Expect(DTO.String().required())
    public readonly name: string

    /**
     * The URI the client read (`'device://A1/status'`), for a resource; `undefined` for a tool or a prompt.
     */
    @Expect(DTO.String().optional())
    public readonly uri?: string

    /**
     * The id of the client's session, when its transport has sessions; `undefined` otherwise.
     */
    @Expect(DTO.String().optional())
    public readonly sessionId?: string

    /**
     * The client's authentication, returned by the `authenticate` option of `httpMCPEntrypoint`; `undefined` over stdio
     * or without that option.
     */
    @Expect(DTO.Object().unknown().optional())
    public readonly authInfo?: MCPAuthInfo

    /**
     * Report the progress of a long request to the client (`notifications/progress`). It does nothing when the client
     * did not ask for the progress (no progress token in its request).
     * @param progress The progress so far; it must increase with each call.
     * @param total The total the progress goes to, when it is known.
     * @param message A message describing the progress.
     */
    @Expect(DTO.Function().required())
    public readonly progress: (progress: number, total?: number, message?: string) => Promise<void>

    /**
     * Create the context of an MCP request, validating its properties.
     * @param params The kind, the name, the URI, the arguments, the session, the authentication and the progress
     * function of the request.
     * @throws {InvalidValueException} When a property is missing or invalid.
     */
    constructor(params: MCPContextParams) {
        super(params)
    }
}
