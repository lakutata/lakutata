import type {ActionPattern} from '@lakutata/core'
import {ControllerActionNotFoundException} from '@lakutata/entrypoint'
import type {BaseContext, EntrypointAdapter} from '@lakutata/entrypoint'
import {DefineChannel, GetChannel, HasChannel} from '@lakutata/entrypoint/channel'
import type {ChannelDefinition, ChannelEntry, ChannelMatch, ChannelMatcher} from '@lakutata/entrypoint/channel'
import {MCP_CONTEXT_TYPE, MCPContext} from '../context/MCPContext.js'
import {GetToolMetadata} from '../lib/ToolMetadata.js'

declare module '@lakutata/entrypoint' {
    interface EntrypointOptions {
        /**
         * The MCP adapters (StdioMCPEntrypoint, HTTPMCPEntrypoint)
         */
        mcp?: EntrypointAdapter<MCPContext> | EntrypointAdapter<MCPContext>[]
    }

    interface PrefixOptions {
        /**
         * The prefix of the names of the tools of a controller, joined with "_" (device → device_status)
         */
        mcp?: string
    }
}

/**
 * The tool names allowed by MCP
 */
const TOOL_NAME: RegExp = /^[A-Za-z0-9_.-]{1,128}$/

/**
 * The MCP channel, addressed by tool name
 */
export const MCPChannel: ChannelDefinition = HasChannel('mcp') ? GetChannel('mcp') : DefineChannel({
    name: 'mcp',
    kind: 'request',
    contextType: MCP_CONTEXT_TYPE,
    validate: (pattern: ActionPattern): ActionPattern => {
        if (typeof pattern.tool !== 'string' || !TOOL_NAME.test(pattern.tool)) throw new TypeError(`Invalid MCP tool name "${pattern.tool}": 1 to 128 letters, digits, "_", "-" or "."`)
        return pattern
    },
    identify: (pattern: ActionPattern): string => pattern.tool,
    describe: (pattern: ActionPattern): Record<string, unknown> => ({tool: pattern.tool, ...GetToolMetadata(pattern.metadata)}),
    prefix: (prefix, pattern: ActionPattern): ActionPattern | undefined => prefix.mcp === undefined ? undefined : {...pattern, tool: `${prefix.mcp}_${pattern.tool}`},
    createMatcher: (entries: ChannelEntry[]): ChannelMatcher => {
        const tools: Map<string, ChannelEntry> = new Map(entries.map((entry: ChannelEntry): [string, ChannelEntry] => [entry.details.pattern.tool, entry]))
        return {
            match: (context: BaseContext): ChannelMatch | undefined => {
                const entry: ChannelEntry | undefined = tools.get((context as MCPContext).tool)
                return entry ? {entry: entry} : undefined
            }
        }
    },
    notFound: (context: BaseContext): Error => new ControllerActionNotFoundException('Tool {tool} not found', {tool: (context as MCPContext).tool})
})
