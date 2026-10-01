import {type MCPAuthInfo, type MCPRequestKind} from '../context/MCPContext.js'

/**
 * The parameters of the context of the MCP requests (MCPContext)
 */
export type MCPContextParams = {
    readonly kind: MCPRequestKind
    readonly name: string
    readonly uri?: string
    readonly data: Record<string, any>
    readonly sessionId?: string
    readonly authInfo?: MCPAuthInfo
    readonly progress: (progress: number, total?: number, message?: string) => Promise<void>
}
