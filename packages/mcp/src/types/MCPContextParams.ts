import {type MCPAuthInfo, type MCPRequestKind} from '../context/MCPContext.js'

/**
 * The parameters of an {@link MCPContext}: the adapters build them for each request they receive. An application builds
 * them only to create a context itself, in a test of a controller or a custom transport.
 */
export type MCPContextParams = {
    /**
     * What the client asked for: a tool call, a resource read or a prompt.
     */
    readonly kind: MCPRequestKind
    /**
     * The name of the tool or the prompt, or the URI (template) of the resource as declared.
     */
    readonly name: string
    /**
     * The URI the client read, for a resource.
     */
    readonly uri?: string
    /**
     * The arguments of the request (empty for a resource).
     */
    readonly data: Record<string, any>
    /**
     * The id of the client's session, when its transport has sessions.
     */
    readonly sessionId?: string
    /**
     * The client's authentication, over HTTP.
     */
    readonly authInfo?: MCPAuthInfo
    /**
     * Report the progress of the request to the client (a function doing nothing when the client did not ask for it).
     */
    readonly progress: (progress: number, total?: number, message?: string) => Promise<void>
}
