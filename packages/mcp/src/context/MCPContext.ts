import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {BaseContext} from '@lakutata/entrypoint'

/**
 * The type of the MCP contexts
 */
export const MCP_CONTEXT_TYPE: string = 'MCP'

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
     * The name of the tool called
     */
    @Expect(DTO.String().required())
    public readonly tool: string

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
     * Report the progress of the tool to the client, when the client asked for it
     */
    @Expect(DTO.Function().required())
    public readonly progress: (progress: number, total?: number, message?: string) => Promise<void>

    constructor(params: {
        readonly tool: string
        readonly data: Record<string, any>
        readonly sessionId?: string
        readonly authInfo?: MCPAuthInfo
        readonly progress: (progress: number, total?: number, message?: string) => Promise<void>
    }) {
        super(params)
    }
}
