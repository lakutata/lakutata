import type {Readable, Writable} from 'node:stream'
import {Application} from '@lakutata/core'
import type {ChannelRuntime, EntrypointAdapter, MiddlewareDefinition} from '@lakutata/entrypoint'
import type {McpServer} from '@modelcontextprotocol/server'
import {StdioServerTransport} from '@modelcontextprotocol/server/stdio'
import {MCPChannel} from '../channel/MCPChannel.js'
import type {MCPContext} from '../context/MCPContext.js'
import {BuildMCPServer, type MCPServerInfo} from '../lib/MCPServer.js'

export type StdioMCPEntrypointOptions = MCPServerInfo & {
    /**
     * The adapter name
     */
    name?: string
    /**
     * The input of the messages of the client, process.stdin by default
     */
    stdin?: Readable
    /**
     * The output of the messages to the client, process.stdout by default: nothing else may be written to it (the logs go to stderr)
     */
    stdout?: Writable
    /**
     * Exit the application when the client closes the input, true by default
     */
    exitOnClose?: boolean
    /**
     * The middlewares of the tools of this adapter, run after the global middlewares
     */
    middlewares?: MiddlewareDefinition[]
}

/**
 * The application a module belongs to
 * @param module
 */
function ApplicationOf(module: unknown): Application | undefined {
    let target: any = module
    while (target && !(target instanceof Application)) target = target.getParent?.()
    return target
}

/**
 * The MCP server of a client running the application as its subprocess, over the standard input and output
 * @param options
 */
export function StdioMCPEntrypoint(options: StdioMCPEntrypointOptions = {}): EntrypointAdapter<MCPContext> {
    const stdin: Readable = options.stdin ?? process.stdin
    let server: McpServer | undefined
    let stopped: boolean = false
    let onEnd: (() => void) | undefined
    return {
        channel: 'mcp',
        definition: MCPChannel,
        name: options.name,
        middlewares: options.middlewares,
        start: async (runtime: ChannelRuntime<MCPContext>): Promise<void> => {
            server = BuildMCPServer(runtime, options)
            await server.connect(new StdioServerTransport(stdin, options.stdout ?? process.stdout))
            //The client closed its end: the application ends with it
            onEnd = (): void => {
                if (stopped || options.exitOnClose === false) return
                const application: Application | undefined = ApplicationOf(runtime.module)
                if (application) application.exit(0)
            }
            stdin.once('end', onEnd)
        },
        stop: (): void => {
            stopped = true
            if (onEnd) stdin.off('end', onEnd)
        },
        close: async (): Promise<void> => {
            //The responses of the calls in progress are sent, then the transport is closed
            await server?.close()
        }
    }
}
