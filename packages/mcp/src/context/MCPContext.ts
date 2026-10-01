import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {BaseContext} from '@lakutata/entrypoint'
import {type MCPContextParams} from '../types/MCPContextParams.js'

/**
 * The type of the MCP contexts
 */
export const MCP_CONTEXT_TYPE: string = 'MCP'

/**
 * What the client asked for: a tool call, a resource read or a prompt
 */
export type MCPRequestKind = 'tool' | 'resource' | 'prompt'

/**
 * The authentication of the client of an HTTP request
 */
export type MCPAuthInfo = {
    token: string
    clientId: string
    scopes: string[]
    expiresAt?: number
    extra?: Record<string, unknown>
}

export class MCPContext<T extends Record<string, any> = {}> extends BaseContext<T> {

    @Expect(DTO.String().valid(MCP_CONTEXT_TYPE).default(MCP_CONTEXT_TYPE))
    public readonly type: string

    /**
     * What the client asked for
     */
    @Expect(DTO.String().valid('tool', 'resource', 'prompt').required())
    public readonly kind: MCPRequestKind

    /**
     * The name of the tool or of the prompt, the URI (template) of the resource
     */
    @Expect(DTO.String().required())
    public readonly name: string

    /**
     * The URI of the resource read
     */
    @Expect(DTO.String().optional())
    public readonly uri?: string

    /**
     * The session of the client, when the transport has sessions
     */
    @Expect(DTO.String().optional())
    public readonly sessionId?: string

    /**
     * The authentication of the client, given by the authenticate option of the HTTP adapter
     */
    @Expect(DTO.Object().unknown().optional())
    public readonly authInfo?: MCPAuthInfo

    /**
     * Report the progress of the request to the client, when the client asked for it
     */
    @Expect(DTO.Function().required())
    public readonly progress: (progress: number, total?: number, message?: string) => Promise<void>

    constructor(params: MCPContextParams) {
        super(params)
    }
}
