import {Application, type JSONSchema} from '@lakutata/core'
import type {ChannelActionInfo, ChannelRuntime} from '@lakutata/entrypoint'
import {McpServer, ProtocolError, ProtocolErrorCode, ResourceTemplate, type CallToolResult, type GetPromptResult, type ReadResourceResult, type ServerContext, type StandardSchemaWithJSON, type Variables} from '@modelcontextprotocol/server'
import {MCPAuthInfo, MCPContext, MCPRequestKind} from '../context/MCPContext.js'
import type {MCPMetadata} from './Metadata.js'
import {ErrorMessage, ToErrorResult, ToPromptResult, ToResourceResult, ToToolResult} from './Results.js'

/**
 * The description of the MCP server given to the clients
 */
export type MCPServerInfo = {
    /**
     * The server name, the application name by default
     */
    serverName?: string
    /**
     * The server version, "1.0.0" by default
     */
    serverVersion?: string
    /**
     * How the tools, the resources and the prompts of the server are used, given to the model
     */
    instructions?: string
}

/**
 * A schema of the SDK from a JSON schema: the input is validated by the DTO of the action, in its pipeline
 * @param schema
 */
function Schema(schema: JSONSchema): StandardSchemaWithJSON {
    return {
        '~standard': {
            version: 1,
            vendor: 'lakutata',
            validate: (value: unknown): { value: unknown } => ({value: value ?? {}}),
            jsonSchema: {
                input: (): Record<string, unknown> => schema as Record<string, unknown>,
                output: (): Record<string, unknown> => schema as Record<string, unknown>
            }
        }
    } as StandardSchemaWithJSON
}

/**
 * The protocol error of an error of a resource or of a prompt: the errors of the client (4xx) are invalid parameters
 * @param error
 */
function ToProtocolError(error: unknown): ProtocolError {
    if (error instanceof ProtocolError) return error
    const {statusCode, errno} = (error && typeof error === 'object' ? error : {}) as { statusCode?: unknown, errno?: unknown }
    const code: number = typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500 ? ProtocolErrorCode.InvalidParams : ProtocolErrorCode.InternalError
    return new ProtocolError(code, ErrorMessage(error), errno === undefined ? undefined : {errno: errno})
}

/**
 * The context of a request
 * @param kind
 * @param name
 * @param data
 * @param context
 * @param uri
 */
function RequestContext(kind: MCPRequestKind, name: string, data: Record<string, unknown>, context: ServerContext, uri?: string): MCPContext {
    const progressToken: unknown = context.mcpReq._meta?.progressToken
    return new MCPContext({
        kind: kind,
        name: name,
        uri: uri,
        data: data,
        sessionId: context.sessionId,
        authInfo: context.http?.authInfo as MCPAuthInfo | undefined,
        progress: async (progress: number, total?: number, message?: string): Promise<void> => {
            if (progressToken === undefined) return
            await context.mcpReq.notify({
                method: 'notifications/progress',
                params: {progressToken: progressToken, progress: progress, total: total, message: message}
            } as any)
        }
    })
}

/**
 * The input of a request
 * @param args
 */
function Input(args: unknown): Record<string, unknown> {
    return args && typeof args === 'object' ? {...args as Record<string, unknown>} : {}
}

/**
 * Serve a tool
 * @param server
 * @param runtime
 * @param action
 */
function RegisterTool(server: McpServer, runtime: ChannelRuntime<MCPContext>, action: ChannelActionInfo): void {
    const name: string = action.address.tool
    const {title, annotations, outputSchema} = action as unknown as MCPMetadata
    server.registerTool(name, {
        title: title,
        description: action.description || action.name,
        inputSchema: Schema(action.jsonSchema),
        outputSchema: outputSchema ? Schema(outputSchema) : undefined,
        annotations: annotations
    }, async (args: unknown, context: ServerContext): Promise<CallToolResult> => {
        try {
            return await ToToolResult(await runtime.dispatchTo(action, RequestContext('tool', name, Input(args), context), {signal: context.mcpReq.signal}))
        } catch (error: unknown) {
            return ToErrorResult(error)
        }
    })
}

/**
 * Serve a resource: a URI template ("device://{sn}/status") gives its variables to the input
 * @param server
 * @param runtime
 * @param action
 */
function RegisterResource(server: McpServer, runtime: ChannelRuntime<MCPContext>, action: ChannelActionInfo): void {
    const uri: string = action.address.resource
    const {title, mimeType, resourceName, resourceAnnotations} = action as unknown as MCPMetadata
    const config = {
        title: title,
        description: action.description || undefined,
        mimeType: mimeType,
        annotations: resourceAnnotations
    }
    const read = async (url: URL, variables: Variables, context: ServerContext): Promise<ReadResourceResult> => {
        try {
            const result: unknown = await runtime.dispatchTo(action, RequestContext('resource', uri, {}, context, url.href), {signal: context.mcpReq.signal, params: variables})
            return await ToResourceResult(url.href, result, mimeType)
        } catch (error: unknown) {
            throw ToProtocolError(error)
        }
    }
    if (/\{[^}]+}/.test(uri)) {
        server.registerResource(resourceName ?? action.name, new ResourceTemplate(uri, {list: undefined}), config, read)
    } else {
        server.registerResource(resourceName ?? action.name, uri, config, (url: URL, context: ServerContext): Promise<ReadResourceResult> => read(url, {}, context))
    }
}

/**
 * Serve a prompt: its arguments are the properties of the DTO
 * @param server
 * @param runtime
 * @param action
 */
function RegisterPrompt(server: McpServer, runtime: ChannelRuntime<MCPContext>, action: ChannelActionInfo): void {
    const name: string = action.address.prompt
    const {title} = action as unknown as MCPMetadata
    const description: string | undefined = action.description || undefined
    server.registerPrompt(name, {
        title: title,
        description: description,
        argsSchema: Schema(action.jsonSchema)
    }, async (args: unknown, context: ServerContext): Promise<GetPromptResult> => {
        try {
            return ToPromptResult(await runtime.dispatchTo(action, RequestContext('prompt', name, Input(args), context), {signal: context.mcpReq.signal}), description)
        } catch (error: unknown) {
            throw ToProtocolError(error)
        }
    })
}

/**
 * An MCP server serving the actions of a runtime as its tools, resources and prompts
 * @param runtime
 * @param info
 * @param subscriptions the URIs of the resources the client of a session subscribed to (resources/subscribe)
 */
export function BuildMCPServer(runtime: ChannelRuntime<MCPContext>, info: MCPServerInfo = {}, subscriptions?: Set<string>): McpServer {
    const server: McpServer = new McpServer({
        name: info.serverName ?? Application.appName ?? 'lakutata',
        version: info.serverVersion ?? '1.0.0'
    }, {instructions: info.instructions})
    for (const action of runtime.actions) {
        switch (action.kind as MCPRequestKind) {
            case 'tool':
                RegisterTool(server, runtime, action)
                break
            case 'resource':
                RegisterResource(server, runtime, action)
                break
            case 'prompt':
                RegisterPrompt(server, runtime, action)
                break
        }
    }
    //The clients subscribe to the resources, MCPNotifier tells them when a resource changed
    if (runtime.actions.some((action: ChannelActionInfo): boolean => action.kind === 'resource')) {
        server.server.registerCapabilities({resources: {subscribe: true}})
        server.server.setRequestHandler('resources/subscribe', async (request): Promise<{}> => {
            subscriptions?.add(request.params.uri)
            return {}
        })
        server.server.setRequestHandler('resources/unsubscribe', async (request): Promise<{}> => {
            subscriptions?.delete(request.params.uri)
            return {}
        })
    }
    return server
}
