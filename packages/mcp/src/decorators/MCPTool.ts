import {DTO} from '@lakutata/core'
import type {MethodDecorator} from '@lakutata/core'
import type {Controller} from '@lakutata/entrypoint'
import type {ActionOptions} from '@lakutata/entrypoint/channel'
import type {MCPContext} from '../context/MCPContext.js'
import type {MCPMetadata} from '../lib/Metadata.js'
import {RegisterMCPAction} from '../lib/RegisterMCPAction.js'

/**
 * The options of a tool: the options of an action, with the MCP metadata of the tool
 */
export type MCPToolOptions = ActionOptions<MCPContext> & {
    /**
     * The name of the tool shown to the users
     */
    title?: string
    /**
     * The tool does not change its environment
     */
    readOnly?: boolean
    /**
     * The tool may destroy or overwrite data, the clients ask the user before calling it
     */
    destructive?: boolean
    /**
     * Calling the tool again with the same input has no additional effect
     */
    idempotent?: boolean
    /**
     * The tool interacts with the world outside the application (the internet, other systems)
     */
    openWorld?: boolean
    /**
     * The DTO of the result: the result is also given as structured content, described by its JSON schema
     */
    output?: typeof DTO
}

/**
 * Split the MCP metadata from the action options
 * @param options
 */
function SplitOptions(options: MCPToolOptions): [MCPMetadata, ActionOptions<MCPContext>] {
    const {title, readOnly, destructive, idempotent, openWorld, output, ...actionOptions} = options
    const annotations: MCPMetadata['annotations'] = {}
    if (readOnly !== undefined) annotations.readOnlyHint = readOnly
    if (destructive !== undefined) annotations.destructiveHint = destructive
    if (idempotent !== undefined) annotations.idempotentHint = idempotent
    if (openWorld !== undefined) annotations.openWorldHint = openWorld
    const metadata: MCPMetadata = {}
    if (title !== undefined) metadata.title = title
    if (Object.keys(annotations).length) metadata.annotations = annotations
    if (output) metadata.outputSchema = output.toJsonSchema()
    return [metadata, actionOptions]
}

/**
 * Method Decorator, serve the action as a tool of the MCP servers
 * @param name
 */
export function MCPTool<ClassPrototype extends Controller, Method>(name: string): MethodDecorator<ClassPrototype, Method, any>
/**
 * Method Decorator, serve the action as a tool of the MCP servers
 * @param name
 * @param dtoConstructor
 */
export function MCPTool<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(name: string, dtoConstructor: DTOConstructor): MethodDecorator<ClassPrototype, Method, any>
/**
 * Method Decorator, serve the action as a tool of the MCP servers
 * @param name
 * @param options
 */
export function MCPTool<ClassPrototype extends Controller, Method>(name: string, options: MCPToolOptions): MethodDecorator<ClassPrototype, Method, any>
/**
 * Method Decorator, serve the action as a tool of the MCP servers
 * @param name
 * @param dtoConstructor
 * @param options
 */
export function MCPTool<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(name: string, dtoConstructor: DTOConstructor, options: MCPToolOptions): MethodDecorator<ClassPrototype, Method, any>
export function MCPTool<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(name: string, dtoConstructorOrOptions?: DTOConstructor | MCPToolOptions, options?: MCPToolOptions): MethodDecorator<ClassPrototype, Method, any> {
    return (target: ClassPrototype, propertyKey: any, descriptor: TypedPropertyDescriptor<Method>): TypedPropertyDescriptor<Method> => {
        RegisterMCPAction('tool', name, target, propertyKey, dtoConstructorOrOptions, options, SplitOptions)
        return descriptor
    }
}
