import {DTO, type MethodDecorator} from '@lakutata/core'
import type {Controller} from '@lakutata/entrypoint'
import type {ActionOptions} from '@lakutata/entrypoint/channel'
import type {MCPContext} from '../context/MCPContext.js'
import type {MCPMetadata} from '../lib/Metadata.js'
import {RegisterMCPAction} from '../lib/RegisterMCPAction.js'

/**
 * The options of a prompt: the options of an action, with the MCP metadata of the prompt
 */
export type MCPPromptOptions = ActionOptions<MCPContext> & {
    /**
     * The name of the prompt shown to the users
     */
    title?: string
}

/**
 * Split the MCP metadata from the action options
 * @param options
 */
function SplitOptions(options: MCPPromptOptions): [MCPMetadata, ActionOptions<MCPContext>] {
    const {title, ...actionOptions} = options
    return [title !== undefined ? {title: title} : {}, actionOptions]
}

/**
 * Method Decorator, serve the action as a prompt of the MCP servers: its arguments are the properties of the DTO (given as strings by the clients),
 * it returns the messages of the prompt
 * @param name
 */
export function MCPPrompt<ClassPrototype extends Controller, Method>(name: string): MethodDecorator<ClassPrototype, Method, any>
/**
 * Method Decorator, serve the action as a prompt of the MCP servers: its arguments are the properties of the DTO (given as strings by the clients),
 * it returns the messages of the prompt
 * @param name
 * @param dtoConstructor
 */
export function MCPPrompt<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(name: string, dtoConstructor: DTOConstructor): MethodDecorator<ClassPrototype, Method, any>
/**
 * Method Decorator, serve the action as a prompt of the MCP servers: its arguments are the properties of the DTO (given as strings by the clients),
 * it returns the messages of the prompt
 * @param name
 * @param options
 */
export function MCPPrompt<ClassPrototype extends Controller, Method>(name: string, options: MCPPromptOptions): MethodDecorator<ClassPrototype, Method, any>
/**
 * Method Decorator, serve the action as a prompt of the MCP servers: its arguments are the properties of the DTO (given as strings by the clients),
 * it returns the messages of the prompt
 * @param name
 * @param dtoConstructor
 * @param options
 */
export function MCPPrompt<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(name: string, dtoConstructor: DTOConstructor, options: MCPPromptOptions): MethodDecorator<ClassPrototype, Method, any>
export function MCPPrompt<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(name: string, dtoConstructorOrOptions?: DTOConstructor | MCPPromptOptions, options?: MCPPromptOptions): MethodDecorator<ClassPrototype, Method, any> {
    return (target: ClassPrototype, propertyKey: any, descriptor: TypedPropertyDescriptor<Method>): TypedPropertyDescriptor<Method> => {
        RegisterMCPAction('prompt', name, target, propertyKey, dtoConstructorOrOptions, options, SplitOptions)
        return descriptor
    }
}
