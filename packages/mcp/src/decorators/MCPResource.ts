import {DTO} from '@lakutata/core'
import type {MethodDecorator} from '@lakutata/core'
import type {Controller} from '@lakutata/entrypoint'
import type {ActionOptions} from '@lakutata/entrypoint/channel'
import type {MCPContext} from '../context/MCPContext.js'
import type {MCPMetadata} from '../lib/Metadata.js'
import {RegisterMCPAction} from '../lib/RegisterMCPAction.js'

/**
 * The options of a resource: the options of an action, with the MCP metadata of the resource
 */
export type MCPResourceOptions = ActionOptions<MCPContext> & {
    /**
     * The name of the resource, the name of the action by default
     */
    resourceName?: string
    /**
     * The name of the resource shown to the users
     */
    title?: string
    /**
     * The content type of the resource
     */
    mimeType?: string
    /**
     * Who the resource is for
     */
    audience?: ('user' | 'assistant')[]
    /**
     * How important the resource is, from 0 to 1
     */
    priority?: number
}

/**
 * Split the MCP metadata from the action options
 * @param options
 */
function SplitOptions(options: MCPResourceOptions): [MCPMetadata, ActionOptions<MCPContext>] {
    const {resourceName, title, mimeType, audience, priority, ...actionOptions} = options
    const metadata: MCPMetadata = {}
    if (resourceName !== undefined) metadata.resourceName = resourceName
    if (title !== undefined) metadata.title = title
    if (mimeType !== undefined) metadata.mimeType = mimeType
    if (audience !== undefined || priority !== undefined) metadata.resourceAnnotations = {
        ...(audience !== undefined ? {audience: audience} : {}),
        ...(priority !== undefined ? {priority: priority} : {})
    }
    return [metadata, actionOptions]
}

/**
 * Method Decorator, serve the action as a resource of the MCP servers.
 * The variables of a URI template ("device://{sn}/status") are merged into the input, as the route parameters
 * @param uri
 */
export function MCPResource<ClassPrototype extends Controller, Method>(uri: string): MethodDecorator<ClassPrototype, Method, any>
/**
 * Method Decorator, serve the action as a resource of the MCP servers.
 * The variables of a URI template ("device://{sn}/status") are merged into the input, as the route parameters
 * @param uri
 * @param dtoConstructor
 */
export function MCPResource<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(uri: string, dtoConstructor: DTOConstructor): MethodDecorator<ClassPrototype, Method, any>
/**
 * Method Decorator, serve the action as a resource of the MCP servers.
 * The variables of a URI template ("device://{sn}/status") are merged into the input, as the route parameters
 * @param uri
 * @param options
 */
export function MCPResource<ClassPrototype extends Controller, Method>(uri: string, options: MCPResourceOptions): MethodDecorator<ClassPrototype, Method, any>
/**
 * Method Decorator, serve the action as a resource of the MCP servers.
 * The variables of a URI template ("device://{sn}/status") are merged into the input, as the route parameters
 * @param uri
 * @param dtoConstructor
 * @param options
 */
export function MCPResource<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(uri: string, dtoConstructor: DTOConstructor, options: MCPResourceOptions): MethodDecorator<ClassPrototype, Method, any>
export function MCPResource<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(uri: string, dtoConstructorOrOptions?: DTOConstructor | MCPResourceOptions, options?: MCPResourceOptions): MethodDecorator<ClassPrototype, Method, any> {
    return (target: ClassPrototype, propertyKey: any, descriptor: TypedPropertyDescriptor<Method>): TypedPropertyDescriptor<Method> => {
        RegisterMCPAction('resource', uri, target, propertyKey, dtoConstructorOrOptions, options, SplitOptions)
        return descriptor
    }
}
