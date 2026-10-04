import {DTO, type MethodDecorator} from '@lakutata/core'
import type {Controller} from '@lakutata/entrypoint'
import type {ActionOptions} from '@lakutata/entrypoint/channel'
import type {MCPContext} from '../context/MCPContext.js'
import type {MCPMetadata} from '../lib/Metadata.js'
import {RegisterMCPAction} from '../lib/RegisterMCPAction.js'

/**
 * The options of {@link MCPPrompt}: the options of a controller action (`name`, `description`, `acl`, `rule`,
 * `groups`, `middlewares`), with the prompt's MCP metadata. The `description` is the prompt's description, shown by the
 * clients and returned with its messages.
 */
export type MCPPromptOptions = ActionOptions<MCPContext> & {
    /**
     * The prompt's name as the clients show it to the users (`'Diagnose a device'`).
     * @default undefined
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
 * Serve a controller action as a prompt of the MCP servers: a template of messages the user picks in the client (its
 * slash commands). Its arguments are the properties of its DTO, which the clients give as strings; the input goes
 * through the entrypoint's middlewares, the DTO validation and the access control. The prompt's name is prefixed by
 * its controller's `@Prefix({mcp})`, joined with `_`, as the tools.
 *
 * The result is converted by {@link ToPromptResult}: a string is a message of the user, an array the messages (strings
 * for the user, or `{role, content}`), a `GetPromptResult` is sent as it is. An error thrown by the action is a
 * protocol error: "invalid parameters" for the client errors (a `statusCode` from 400 to 499), an internal error
 * otherwise.
 * @param name The prompt's name, before its controller's prefix: 1 to 128 letters, digits, `_`, `-` or `.`.
 * @returns The method decorator.
 * @throws {TypeError} When the method is declared, if the name is invalid.
 * @example
 * ```typescript
 * import {DTO} from 'lakutata'
 * import {Controller} from 'lakutata/com/entrypoint'
 * import {Prefix} from 'lakutata/decorator/ctrl'
 * import {Expect} from 'lakutata/decorator/dto'
 * import {MCPPrompt} from '@lakutata/mcp'
 *
 * class DeviceSnDTO extends DTO {
 *     @Expect(DTO.String().required().description('The serial number of the device'))
 *     public sn: string
 * }
 *
 * @Prefix({mcp: 'device'})
 * export class DeviceController extends Controller {
 *     //The prompt device_diagnose: one message of the user
 *     @MCPPrompt('diagnose', DeviceSnDTO, {title: 'Diagnose a device', description: 'Diagnose the failures of a device'})
 *     public async diagnose(input: DeviceSnDTO): Promise<string> {
 *         return `Diagnose the device ${input.sn} from its status and its logs.`
 *     }
 *
 *     //Several messages: strings for the user, or {role, content}
 *     @MCPPrompt('handover', DeviceSnDTO)
 *     public async handover(input: DeviceSnDTO): Promise<unknown[]> {
 *         return [`Take over the device ${input.sn}.`, {role: 'assistant', content: {type: 'text', text: 'Ready.'}}]
 *     }
 * }
 * ```
 */
export function MCPPrompt<ClassPrototype extends Controller, Method>(name: string): MethodDecorator<ClassPrototype, Method, any>
/**
 * Serve a controller action as a prompt of the MCP servers, a template of messages the user picks, its arguments the
 * properties of a DTO. The name is prefixed by the controller's `@Prefix({mcp})`; an error thrown by the action is a
 * protocol error.
 * @param name The prompt's name, before its controller's prefix: 1 to 128 letters, digits, `_`, `-` or `.`.
 * @param dtoConstructor The DTO of the prompt's arguments: its properties are the arguments, given as strings.
 * @returns The method decorator.
 * @throws {TypeError} When the method is declared, if the name is invalid.
 */
export function MCPPrompt<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(name: string, dtoConstructor: DTOConstructor): MethodDecorator<ClassPrototype, Method, any>
/**
 * Serve a controller action as a prompt of the MCP servers, a template of messages the user picks, with options. The
 * name is prefixed by the controller's `@Prefix({mcp})`; an error thrown by the action is a protocol error.
 * @param name The prompt's name, before its controller's prefix: 1 to 128 letters, digits, `_`, `-` or `.`.
 * @param options The options of the action, and the prompt's `title`.
 * @returns The method decorator.
 * @throws {TypeError} When the method is declared, if the name is invalid.
 */
export function MCPPrompt<ClassPrototype extends Controller, Method>(name: string, options: MCPPromptOptions): MethodDecorator<ClassPrototype, Method, any>
/**
 * Serve a controller action as a prompt of the MCP servers, a template of messages the user picks, its arguments the
 * properties of a DTO, with options. The name is prefixed by the controller's `@Prefix({mcp})`; an error thrown by the
 * action is a protocol error.
 * @param name The prompt's name, before its controller's prefix: 1 to 128 letters, digits, `_`, `-` or `.`.
 * @param dtoConstructor The DTO of the prompt's arguments: its properties are the arguments, given as strings.
 * @param options The options of the action, and the prompt's `title`.
 * @returns The method decorator.
 * @throws {TypeError} When the method is declared, if the name is invalid.
 */
export function MCPPrompt<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(name: string, dtoConstructor: DTOConstructor, options: MCPPromptOptions): MethodDecorator<ClassPrototype, Method, any>
export function MCPPrompt<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(name: string, dtoConstructorOrOptions?: DTOConstructor | MCPPromptOptions, options?: MCPPromptOptions): MethodDecorator<ClassPrototype, Method, any> {
    return (target: ClassPrototype, propertyKey: any, descriptor: TypedPropertyDescriptor<Method>): TypedPropertyDescriptor<Method> => {
        RegisterMCPAction('prompt', name, target, propertyKey, dtoConstructorOrOptions, options, SplitOptions)
        return descriptor
    }
}
