import type {JSONSchema} from '@lakutata/core'

/**
 * The MCP metadata of an action, given to the adapters in the action information
 */
export type MCPMetadata = {
    /**
     * The name shown to the users
     */
    title?: string
    /**
     * Tools: the hints of their behavior, the clients decide from them whether a call is confirmed by the user
     */
    annotations?: {
        readOnlyHint?: boolean
        destructiveHint?: boolean
        idempotentHint?: boolean
        openWorldHint?: boolean
    }
    /**
     * Tools: the JSON schema of the structured result
     */
    outputSchema?: JSONSchema
    /**
     * Resources: the name of the resource, the name of the action by default
     */
    resourceName?: string
    /**
     * Resources: the content type of the resource
     */
    mimeType?: string
    /**
     * Resources: who the resource is for, and how important it is (0 to 1)
     */
    resourceAnnotations?: {
        audience?: ('user' | 'assistant')[]
        priority?: number
    }
}

/**
 * The metadata by id: an action pattern keeps the id only (its objects are two levels deep at most)
 */
const registry: Map<string, MCPMetadata> = new Map()

/**
 * Keep the metadata of an action
 * @param metadata
 * @return the id of the metadata, undefined without metadata
 */
export function RegisterMCPMetadata(metadata: MCPMetadata): string | undefined {
    if (!Object.keys(metadata).length) return undefined
    const id: string = `mcp-${registry.size + 1}`
    registry.set(id, metadata)
    return id
}

/**
 * The metadata of an action
 * @param id
 */
export function GetMCPMetadata(id: unknown): MCPMetadata {
    return typeof id === 'string' ? registry.get(id) ?? {} : {}
}
