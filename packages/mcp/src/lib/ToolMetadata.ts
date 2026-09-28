import type {JSONSchema} from '@lakutata/core'

/**
 * The MCP metadata of a tool, given to the adapters in the action information
 */
export type ToolMetadata = {
    /**
     * The name of the tool shown to the users
     */
    title?: string
    /**
     * The hints of the behavior of the tool, the clients decide from them whether a call is confirmed by the user
     */
    annotations?: {
        readOnlyHint?: boolean
        destructiveHint?: boolean
        idempotentHint?: boolean
        openWorldHint?: boolean
    }
    /**
     * The JSON schema of the structured result of the tool
     */
    outputSchema?: JSONSchema
}

/**
 * The metadata by id: an action pattern keeps the id only (its objects are two levels deep at most)
 */
const registry: Map<string, ToolMetadata> = new Map()

/**
 * Keep the metadata of a tool
 * @param metadata
 * @return the id of the metadata
 */
export function RegisterToolMetadata(metadata: ToolMetadata): string {
    const id: string = `mcp-tool-${registry.size + 1}`
    registry.set(id, metadata)
    return id
}

/**
 * The metadata of a tool
 * @param id
 */
export function GetToolMetadata(id: unknown): ToolMetadata {
    return typeof id === 'string' ? registry.get(id) ?? {} : {}
}
