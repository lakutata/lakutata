import type {JSONSchema} from '@lakutata/core'
import {GetAppName} from '@lakutata/core/internal'
import type {ChannelActionInfo, ChannelRuntime} from '@lakutata/entrypoint'
import {McpServer} from '@modelcontextprotocol/server'
import type {CallToolResult, ServerContext, StandardSchemaWithJSON} from '@modelcontextprotocol/server'
import {MCPAuthInfo, MCPContext} from '../context/MCPContext.js'
import type {ToolMetadata} from './ToolMetadata.js'
import {ToErrorResult, ToToolResult} from './ToolResult.js'

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
     * How the tools of the server are used, given to the model
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
 * The context of a tool call
 * @param action
 * @param data
 * @param context
 */
function ToolContext(action: ChannelActionInfo, data: Record<string, unknown>, context: ServerContext): MCPContext {
    const progressToken: unknown = context.mcpReq._meta?.progressToken
    return new MCPContext({
        tool: action.address.tool,
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
 * An MCP server serving the actions of a runtime as tools
 * @param runtime
 * @param info
 */
export function BuildMCPServer(runtime: ChannelRuntime<MCPContext>, info: MCPServerInfo = {}): McpServer {
    const server: McpServer = new McpServer({
        name: info.serverName ?? GetAppName() ?? 'lakutata',
        version: info.serverVersion ?? '1.0.0'
    }, {instructions: info.instructions})
    for (const action of runtime.actions) {
        const {title, annotations, outputSchema} = action as unknown as ToolMetadata
        server.registerTool(action.address.tool, {
            title: title,
            description: action.description || action.name,
            inputSchema: Schema(action.jsonSchema),
            outputSchema: outputSchema ? Schema(outputSchema) : undefined,
            annotations: annotations
        }, async (args: unknown, context: ServerContext): Promise<CallToolResult> => {
            try {
                const data: Record<string, unknown> = args && typeof args === 'object' ? args as Record<string, unknown> : {}
                return await ToToolResult(await runtime.dispatchTo(action, ToolContext(action, data, context), {signal: context.mcpReq.signal}))
            } catch (error: unknown) {
                return ToErrorResult(error)
            }
        })
    }
    return server
}
