import {DTO, type MethodDecorator} from '@lakutata/core'
import type {Controller} from '@lakutata/entrypoint'
import type {ActionOptions} from '@lakutata/entrypoint/channel'
import type {MCPContext} from '../context/MCPContext.js'
import type {MCPMetadata} from '../lib/Metadata.js'
import {RegisterMCPAction} from '../lib/RegisterMCPAction.js'

/**
 * The options of {@link MCPTool}: the options of a controller action (`name`, `description`, `acl`, `rule`,
 * `groups`, `middlewares`), with the tool's MCP metadata. The `description` is the tool's description given to the
 * model: write what the tool does and when to use it.
 */
export type MCPToolOptions = ActionOptions<MCPContext> & {
    /**
     * The tool's name as the clients show it to the users (`'Device status'`); the clients show its `name` without it.
     * @default undefined
     */
    title?: string
    /**
     * A hint that the tool does not change its environment (`readOnlyHint`); the clients may call it without asking the
     * user.
     * @default undefined (the clients assume `false`)
     */
    readOnly?: boolean
    /**
     * A hint that the tool may destroy or overwrite data (`destructiveHint`); the clients ask the user before calling
     * it.
     * @default undefined (the clients assume `true` for a tool which is not read-only)
     */
    destructive?: boolean
    /**
     * A hint that calling the tool again with the same input has no additional effect (`idempotentHint`).
     * @default undefined (the clients assume `false`)
     */
    idempotent?: boolean
    /**
     * A hint that the tool reaches the world outside the application, such as the internet or other systems
     * (`openWorldHint`).
     * @default undefined (the clients assume `true`)
     */
    openWorld?: boolean
    /**
     * The DTO describing the tool's result: its JSON schema is the tool's output schema, and the clients read the result
     * as structured content. The action must then return an object: a plain object, or a DTO instance (any class
     * instance whose JSON is an object), given as the structured content. Any other value (a string, an array, nothing)
     * is answered with an error result naming the action and the type it returned.
     * @default undefined (no output schema)
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
 * Serve a controller action as a tool of the MCP servers: a function the model decides to call. Nothing is exposed to
 * the models by default: only the actions declared with `@MCPTool` are tools. The tool's name is prefixed by its
 * controller's `@Prefix({mcp})`, joined with `_` (`device_status`). Its input schema is the JSON schema of its DTO; the
 * input goes through the entrypoint's middlewares, the DTO validation and the access control, as in the other channels.
 *
 * The result is converted by {@link toToolResult}: a string is a text, a plain object (and, for a tool with `output`, a
 * DTO instance) is its JSON and the structured content, `Result.file()` an image, an audio clip or an embedded
 * resource, a `CallToolResult` is sent as it is. An
 * error thrown by the action is not a protocol error: the model gets a result with `isError: true` and the text
 * `errno: message`, and may correct its input and call the tool again. The same method may also carry the decorators
 * of the other channels (`@GET`, `@ServiceAction`…).
 * @param name The tool's name, before its controller's prefix: 1 to 128 letters, digits, `_`, `-` or `.`.
 * @returns The method decorator.
 * @throws {TypeError} When the method is declared, if the name is invalid.
 * @example
 * ```typescript
 * import {DTO} from 'lakutata'
 * import {Controller} from 'lakutata/com/entrypoint'
 * import {GET, Prefix} from 'lakutata/decorator/ctrl'
 * import {Expect} from 'lakutata/decorator/dto'
 * import {MCPTool} from '@lakutata/mcp'
 *
 * class DeviceSnDTO extends DTO {
 *     @Expect(DTO.String().required().description('The serial number of the device'))
 *     public sn: string
 * }
 *
 * class StatusDTO extends DTO {
 *     @Expect(DTO.String().required())
 *     public sn: string
 *
 *     @Expect(DTO.Boolean().required())
 *     public online: boolean
 * }
 *
 * @Prefix({route: '/device', mcp: 'device'})
 * export class DeviceController extends Controller {
 *     //The tool device_status, also served at GET /device/status/:sn
 *     @GET('/status/:sn', DeviceSnDTO)
 *     @MCPTool('status', DeviceSnDTO, {description: 'The online status of a device', readOnly: true, output: StatusDTO})
 *     public async status(input: DeviceSnDTO): Promise<StatusDTO> {
 *         //A plain object or a DTO instance: the structured content of the result
 *         return {sn: input.sn, online: true} as StatusDTO
 *     }
 *
 *     //The tool device_reboot: the clients ask the user before calling it
 *     @MCPTool('reboot', DeviceSnDTO, {description: 'Reboot a device', destructive: true})
 *     public async reboot(input: DeviceSnDTO): Promise<string> {
 *         return `Rebooting ${input.sn}`
 *     }
 * }
 * ```
 */
export function MCPTool<ClassPrototype extends Controller, Method>(name: string): MethodDecorator<ClassPrototype, Method, any>
/**
 * Serve a controller action as a tool of the MCP servers, its input validated by a DTO whose JSON schema is the tool's
 * input schema. The name is prefixed by the controller's `@Prefix({mcp})`; an error thrown by the action is given to
 * the model as a result with `isError: true`.
 * @param name The tool's name, before its controller's prefix: 1 to 128 letters, digits, `_`, `-` or `.`.
 * @param dtoConstructor The DTO of the tool's input: its JSON schema is the tool's input schema, given to the model
 * (describe its properties with `.description()`).
 * @returns The method decorator.
 * @throws {TypeError} When the method is declared, if the name is invalid.
 */
export function MCPTool<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(name: string, dtoConstructor: DTOConstructor): MethodDecorator<ClassPrototype, Method, any>
/**
 * Serve a controller action as a tool of the MCP servers, with options: its input is accepted as it is. The name is
 * prefixed by the controller's `@Prefix({mcp})`; an error thrown by the action is given to the model as a result with
 * `isError: true`.
 * @param name The tool's name, before its controller's prefix: 1 to 128 letters, digits, `_`, `-` or `.`.
 * @param options The options of the action, and the tool's MCP metadata (`title`, the hints, `output`).
 * @returns The method decorator.
 * @throws {TypeError} When the method is declared, if the name is invalid.
 */
export function MCPTool<ClassPrototype extends Controller, Method>(name: string, options: MCPToolOptions): MethodDecorator<ClassPrototype, Method, any>
/**
 * Serve a controller action as a tool of the MCP servers, its input validated by a DTO whose JSON schema is the tool's
 * input schema, with options. The name is prefixed by the controller's `@Prefix({mcp})`; an error thrown by the action
 * is given to the model as a result with `isError: true`.
 * @param name The tool's name, before its controller's prefix: 1 to 128 letters, digits, `_`, `-` or `.`.
 * @param dtoConstructor The DTO of the tool's input: its JSON schema is the tool's input schema, given to the model
 * (describe its properties with `.description()`).
 * @param options The options of the action, and the tool's MCP metadata (`title`, the hints, `output`).
 * @returns The method decorator.
 * @throws {TypeError} When the method is declared, if the name is invalid.
 */
export function MCPTool<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(name: string, dtoConstructor: DTOConstructor, options: MCPToolOptions): MethodDecorator<ClassPrototype, Method, any>
export function MCPTool<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(name: string, dtoConstructorOrOptions?: DTOConstructor | MCPToolOptions, options?: MCPToolOptions): MethodDecorator<ClassPrototype, Method, any> {
    return (target: ClassPrototype, propertyKey: any, descriptor: TypedPropertyDescriptor<Method>): TypedPropertyDescriptor<Method> => {
        RegisterMCPAction('tool', name, target, propertyKey, dtoConstructorOrOptions, options, SplitOptions)
        return descriptor
    }
}
