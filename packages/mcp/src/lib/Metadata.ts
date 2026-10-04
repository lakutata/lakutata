import type {JSONSchema} from '@lakutata/core'

/**
 * The MCP metadata of an action, from the options of `@MCPTool`, `@MCPResource` and `@MCPPrompt`: the adapters read it
 * in the action's information (`runtime.actions`) to describe the tools, resources and prompts.
 */
export type MCPMetadata = {
    /**
     * The name shown to the users (the `title` option).
     */
    title?: string
    /**
     * Tools: the hints of their behavior, from which the clients decide whether the user confirms a call.
     */
    annotations?: {
        /**
         * The tool does not change its environment (the `readOnly` option).
         */
        readOnlyHint?: boolean
        /**
         * The tool may destroy or overwrite data (the `destructive` option).
         */
        destructiveHint?: boolean
        /**
         * Calling the tool again with the same input has no additional effect (the `idempotent` option).
         */
        idempotentHint?: boolean
        /**
         * The tool reaches the world outside the application (the `openWorld` option).
         */
        openWorldHint?: boolean
    }
    /**
     * Tools: the JSON schema of the structured result (from the `output` option).
     */
    outputSchema?: JSONSchema
    /**
     * Resources: the resource's name (the `resourceName` option); the action's name when it is not set.
     */
    resourceName?: string
    /**
     * Resources: the resource's content type (the `mimeType` option).
     */
    mimeType?: string
    /**
     * Resources: who the resource is for, and how important it is.
     */
    resourceAnnotations?: {
        /**
         * Who the resource is meant for (the `audience` option).
         */
        audience?: ('user' | 'assistant')[]
        /**
         * How important the resource is, from 0 to 1 (the `priority` option).
         */
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
