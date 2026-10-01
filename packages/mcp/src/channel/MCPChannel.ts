import type {ActionPattern} from '@lakutata/core'
import {ControllerActionNotFoundException, type BaseContext, type EntrypointAdapter} from '@lakutata/entrypoint'
import {DefineChannel, GetChannel, HasChannel, type ChannelDefinition, type ChannelEntry, type ChannelMatch, type ChannelMatcher} from '@lakutata/entrypoint/channel'
import {MCP_CONTEXT_TYPE, MCPContext, type MCPRequestKind} from '../context/MCPContext.js'
import {GetMCPMetadata} from '../lib/Metadata.js'

declare module '@lakutata/entrypoint' {
    interface EntrypointOptions {
        /**
         * The MCP adapters (StdioMCPEntrypoint, HTTPMCPEntrypoint)
         */
        mcp?: EntrypointAdapter<MCPContext> | EntrypointAdapter<MCPContext>[]
    }

    interface PrefixOptions {
        /**
         * The prefix of the names of the tools and of the prompts of a controller, joined with "_" (device → device_status)
         */
        mcp?: string
    }
}

/**
 * The names of the tools and of the prompts allowed by MCP
 */
const NAME: RegExp = /^[A-Za-z0-9_.-]{1,128}$/

/**
 * The kinds of the addresses
 */
const KINDS: MCPRequestKind[] = ['tool', 'resource', 'prompt']

/**
 * The kind of an address: {tool: name}, {resource: uri template} or {prompt: name}
 * @param pattern
 */
export function AddressKind(pattern: ActionPattern): MCPRequestKind {
    return KINDS.find((kind: MCPRequestKind): boolean => pattern[kind] !== undefined)!
}

/**
 * The key of an address
 * @param kind
 * @param name
 */
function AddressKey(kind: MCPRequestKind, name: string): string {
    return `${kind}:${name}`
}

/**
 * The MCP channel: the actions are tools, resources or prompts
 */
export const MCPChannel: ChannelDefinition = HasChannel('mcp') ? GetChannel('mcp') : DefineChannel({
    name: 'mcp',
    kind: 'request',
    contextType: MCP_CONTEXT_TYPE,
    validate: (pattern: ActionPattern): ActionPattern => {
        const kinds: MCPRequestKind[] = KINDS.filter((kind: MCPRequestKind): boolean => pattern[kind] !== undefined)
        if (kinds.length !== 1) throw new TypeError('An MCP action is one of a tool, a resource or a prompt')
        const name: unknown = pattern[kinds[0]]
        if (kinds[0] === 'resource') {
            if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(name)) throw new TypeError(`Invalid MCP resource URI "${name}": a URI (template) with a scheme, such as "device://{sn}/status"`)
        } else if (typeof name !== 'string' || !NAME.test(name)) {
            throw new TypeError(`Invalid MCP ${kinds[0]} name "${name}": 1 to 128 letters, digits, "_", "-" or "."`)
        }
        return pattern
    },
    identify: (pattern: ActionPattern): string => {
        const kind: MCPRequestKind = AddressKind(pattern)
        return AddressKey(kind, pattern[kind])
    },
    describe: (pattern: ActionPattern): Record<string, unknown> => {
        const kind: MCPRequestKind = AddressKind(pattern)
        return {kind: kind, [kind]: pattern[kind], ...GetMCPMetadata(pattern.metadata)}
    },
    //The URIs of the resources are absolute, only the names of the tools and of the prompts are prefixed
    prefix: (prefix, pattern: ActionPattern): ActionPattern | undefined => {
        const kind: MCPRequestKind = AddressKind(pattern)
        if (prefix.mcp === undefined || kind === 'resource') return undefined
        return {...pattern, [kind]: `${prefix.mcp}_${pattern[kind]}`}
    },
    createMatcher: (entries: ChannelEntry[]): ChannelMatcher => {
        const addresses: Map<string, ChannelEntry> = new Map(entries.map((entry: ChannelEntry): [string, ChannelEntry] => {
            const kind: MCPRequestKind = AddressKind(entry.details.pattern)
            return [AddressKey(kind, entry.details.pattern[kind]), entry]
        }))
        return {
            match: (context: BaseContext): ChannelMatch | undefined => {
                const entry: ChannelEntry | undefined = addresses.get(AddressKey((context as MCPContext).kind, (context as MCPContext).name))
                return entry ? {entry: entry} : undefined
            }
        }
    },
    notFound: (context: BaseContext): Error => new ControllerActionNotFoundException('The MCP {kind} {name} is not found', {
        kind: (context as MCPContext).kind,
        name: (context as MCPContext).name
    })
})
