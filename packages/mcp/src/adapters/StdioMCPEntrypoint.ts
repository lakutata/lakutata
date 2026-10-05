import type {Readable, Writable} from 'node:stream'
import {Application} from '@lakutata/core'
import type {ChannelRuntime, EntrypointAdapter, MiddlewareDefinition} from '@lakutata/entrypoint'
import type {McpServer} from '@modelcontextprotocol/server'
import {StdioServerTransport} from '@modelcontextprotocol/server/stdio'
import {MCPChannel} from '../channel/MCPChannel.js'
import type {MCPContext} from '../context/MCPContext.js'
import {buildMCPServer, type MCPServerInfo} from '../lib/MCPServer.js'
import {ATTACH} from '../lib/Notifications.js'
import {MCPNotifier} from '../components/MCPNotifier.js'

/**
 * The options of {@link stdioMCPEntrypoint}: the server's description (`serverName`, `serverVersion`,
 * `instructions`), its streams, and whether the application exits with its client.
 */
export type StdioMCPEntrypointOptions = MCPServerInfo & {
    /**
     * The adapter's name, which tells it apart from the entrypoint's other adapters.
     * @default undefined
     */
    name?: string
    /**
     * The stream the client's messages are read from.
     * @default process.stdin
     */
    stdin?: Readable
    /**
     * The stream the messages to the client are written to. Nothing else may be written to it: the application's logs
     * must go to the standard error.
     * @default process.stdout
     */
    stdout?: Writable
    /**
     * Exit the application (`exit(0)`) when the client closes its end of `stdin`, so that the process ends with its
     * client; `false` keeps it running.
     * @default true
     */
    exitOnClose?: boolean
    /**
     * The middlewares of this adapter's requests, run after the entrypoint's global middlewares.
     * @default []
     */
    middlewares?: MiddlewareDefinition[]
}

/**
 * The application a module belongs to
 * @param module
 */
function applicationOf(module: unknown): Application | undefined {
    let target: any = module
    while (target && !(target instanceof Application)) target = target.getParent?.()
    return target
}

/**
 * Build the stdio MCP adapter of the entrypoint (its `mcp` option): the MCP server of a client which runs the
 * application as its subprocess (Claude Desktop, Claude Code, an IDE), talking to it over the process's standard input
 * and output. It serves the application's `@MCPTool`, `@MCPResource` and `@MCPPrompt` actions to that one client, and
 * notifies it of the changes the application's `MCPNotifier` reports (a resource update only when the client
 * subscribed to it).
 *
 * The standard output belongs to the protocol: the application's logs must be written to the standard error
 * (`{class: Logger, destinations: [process.stderr]}`), or they corrupt the messages. The application exits when the
 * client closes the input, unless `exitOnClose` is `false`. The adapter stops gracefully with the entrypoint: the
 * responses of the requests in progress are sent, then the transport closes.
 * @param options The server's description, its streams and `exitOnClose`; none by default.
 * @returns The adapter, to give to the `mcp` option of `buildEntrypoints()`.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {Logger} from 'lakutata/com/logger'
 * import {MCPTool, stdioMCPEntrypoint} from '@lakutata/mcp'
 *
 * class ClockController extends Controller {
 *     @MCPTool('now', {description: 'The current time of the server, as an ISO string', readOnly: true})
 *     public async now(): Promise<string> {
 *         return new Date().toISOString()
 *     }
 * }
 *
 * //Run by the client: {"command": "node", "args": ["/path/to/app.js"]}
 * Application.run(() => ({
 *     id: 'clock.app',
 *     name: 'Clock',
 *     components: {
 *         //The standard output belongs to the protocol
 *         log: {class: Logger, destinations: [process.stderr]},
 *         entrypoint: buildEntrypoints({
 *             controllers: [ClockController],
 *             mcp: stdioMCPEntrypoint({serverName: 'clock', serverVersion: '1.0.0', instructions: 'Use now to read the time.'})
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * }))
 * ```
 */
export function stdioMCPEntrypoint(options: StdioMCPEntrypointOptions = {}): EntrypointAdapter<MCPContext> {
    const stdin: Readable = options.stdin ?? process.stdin
    let server: McpServer | undefined
    let stopped: boolean = false
    let onEnd: (() => void) | undefined
    let removeSink: (() => void) | undefined
    return {
        channel: 'mcp',
        definition: MCPChannel,
        name: options.name,
        middlewares: options.middlewares,
        start: async (runtime: ChannelRuntime<MCPContext>): Promise<void> => {
            //The URIs of the resources the client subscribed to
            const subscriptions: Set<string> = new Set()
            const session: McpServer = buildMCPServer(runtime, options, subscriptions)
            server = session
            await session.connect(new StdioServerTransport(stdin, options.stdout ?? process.stdout))
            const send = (notification: Promise<void>): unknown => notification.catch((): undefined => undefined)
            //The notifier of the application: the notifications of another application do not reach this adapter
            const notifier: MCPNotifier = await runtime.getObject(MCPNotifier)
            removeSink = notifier[ATTACH]({
                toolsChanged: (): unknown => send(session.server.sendToolListChanged()),
                promptsChanged: (): unknown => send(session.server.sendPromptListChanged()),
                resourcesChanged: (): unknown => send(session.server.sendResourceListChanged()),
                resourceUpdated: (uri: string): unknown => subscriptions.has(uri) ? send(session.server.sendResourceUpdated({uri: uri})) : undefined
            })
            //The client closed its end: the application ends with it
            onEnd = (): void => {
                if (stopped || options.exitOnClose === false) return
                const application: Application | undefined = applicationOf(runtime.module)
                if (application) application.exit(0)
            }
            stdin.once('end', onEnd)
        },
        stop: (): void => {
            stopped = true
            removeSink?.()
            if (onEnd) stdin.off('end', onEnd)
        },
        close: async (): Promise<void> => {
            //The responses of the calls in progress are sent, then the transport is closed
            await server?.close()
        }
    }
}
