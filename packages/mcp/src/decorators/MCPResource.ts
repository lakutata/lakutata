import {DTO, type MethodDecorator} from '@lakutata/core'
import type {Controller} from '@lakutata/entrypoint'
import type {ActionOptions} from '@lakutata/entrypoint/channel'
import type {MCPContext} from '../context/MCPContext.js'
import type {MCPMetadata} from '../lib/Metadata.js'
import {registerMCPAction} from '../lib/RegisterMCPAction.js'

/**
 * The options of {@link MCPResource}: the options of a controller action (`name`, `description`, `acl`, `rule`,
 * `groups`, `middlewares`), with the resource's MCP metadata. The `description` is the resource's description given to
 * the clients.
 */
export type MCPResourceOptions = ActionOptions<MCPContext> & {
    /**
     * The resource's name in the lists of resources (`'catalog'`).
     * @default the action's name (its `name` option, else `ControllerClass:method`)
     */
    resourceName?: string
    /**
     * The resource's name as the clients show it to the users (`'The device catalog'`).
     * @default undefined
     */
    title?: string
    /**
     * The content type of the resource (`'application/json'`): announced in the lists, and the type of the contents
     * read, unless the action returns a file with its own type.
     * @default undefined: `text/plain` for a string, `application/json` for a value sent as JSON,
     * `application/octet-stream` for bytes
     */
    mimeType?: string
    /**
     * Who the resource is meant for: `'user'`, `'assistant'` (the model), or both.
     * @default undefined
     */
    audience?: ('user' | 'assistant')[]
    /**
     * How important the resource is, from 0 (optional) to 1 (required); the clients may rank the resources with it.
     * @default undefined
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
 * Serve a controller action as a resource of the MCP servers: read-only data addressed by a URI, which the application
 * or the user attaches to the conversation. A URI without variables (`'device://catalog'`) is listed by
 * `resources/list`; a URI template (`'device://{sn}/status'`) is listed by `resources/templates/list`, and its
 * variables are merged into the action's input, as route parameters (the input holds nothing else). The URIs are not
 * prefixed by the controllers.
 *
 * The result is converted by {@link toResourceResult}: a string is a text, bytes and files a text or a blob by their
 * content type, the other values JSON, and a `ReadResourceResult` is sent as it is. An error thrown by the action is a
 * protocol error: "invalid parameters" for the client errors (a `statusCode` from 400 to 499), an internal error
 * otherwise, with the message `errno: message`. The clients may subscribe to a resource, and
 * `MCPNotifier.resourceUpdated()` tells them when it changes.
 * @param uri The resource's URI, or URI template with variables in braces; it must start with a scheme
 * (`device://`, `file:`).
 * @returns The method decorator.
 * @throws {TypeError} When the method is declared, if the URI has no scheme.
 * @example
 * ```typescript
 * import {DTO} from 'lakutata'
 * import {Controller} from 'lakutata/com/entrypoint'
 * import {Expect} from 'lakutata/decorator/dto'
 * import {MCPResource} from '@lakutata/mcp'
 *
 * class DeviceSnDTO extends DTO {
 *     @Expect(DTO.String().required())
 *     public sn: string
 * }
 *
 * export class DeviceController extends Controller {
 *     //A URI template: device://A1/status reads the status of the device A1, as JSON
 *     @MCPResource('device://{sn}/status', DeviceSnDTO, {mimeType: 'application/json', description: 'The status of a device'})
 *     public async status(input: DeviceSnDTO): Promise<{sn: string, online: boolean}> {
 *         return {sn: input.sn, online: true}
 *     }
 *
 *     //A URI listed by resources/list, read as a text
 *     @MCPResource('device://catalog', {resourceName: 'catalog', title: 'The device catalog'})
 *     public async catalog(): Promise<string> {
 *         return 'A1, B2'
 *     }
 * }
 * ```
 */
export function MCPResource<ClassPrototype extends Controller, Method>(uri: string): MethodDecorator<ClassPrototype, Method, any>
/**
 * Serve a controller action as a resource of the MCP servers, read-only data addressed by a URI, its input validated by
 * a DTO. The variables of a URI template (`'device://{sn}/status'`) are merged into the input, as route parameters; an
 * error thrown by the action is a protocol error.
 * @param uri The resource's URI, or URI template with variables in braces; it must start with a scheme
 * (`device://`, `file:`).
 * @param dtoConstructor The DTO validating the input: the variables of the URI template, as strings.
 * @returns The method decorator.
 * @throws {TypeError} When the method is declared, if the URI has no scheme.
 */
export function MCPResource<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(uri: string, dtoConstructor: DTOConstructor): MethodDecorator<ClassPrototype, Method, any>
/**
 * Serve a controller action as a resource of the MCP servers, read-only data addressed by a URI, with options. The
 * variables of a URI template (`'device://{sn}/status'`) are merged into the input, as route parameters; an error
 * thrown by the action is a protocol error.
 * @param uri The resource's URI, or URI template with variables in braces; it must start with a scheme
 * (`device://`, `file:`).
 * @param options The options of the action, and the resource's MCP metadata (`resourceName`, `title`, `mimeType`,
 * `audience`, `priority`).
 * @returns The method decorator.
 * @throws {TypeError} When the method is declared, if the URI has no scheme.
 */
export function MCPResource<ClassPrototype extends Controller, Method>(uri: string, options: MCPResourceOptions): MethodDecorator<ClassPrototype, Method, any>
/**
 * Serve a controller action as a resource of the MCP servers, read-only data addressed by a URI, its input validated by
 * a DTO, with options. The variables of a URI template (`'device://{sn}/status'`) are merged into the input, as route
 * parameters; an error thrown by the action is a protocol error.
 * @param uri The resource's URI, or URI template with variables in braces; it must start with a scheme
 * (`device://`, `file:`).
 * @param dtoConstructor The DTO validating the input: the variables of the URI template, as strings.
 * @param options The options of the action, and the resource's MCP metadata (`resourceName`, `title`, `mimeType`,
 * `audience`, `priority`).
 * @returns The method decorator.
 * @throws {TypeError} When the method is declared, if the URI has no scheme.
 */
export function MCPResource<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(uri: string, dtoConstructor: DTOConstructor, options: MCPResourceOptions): MethodDecorator<ClassPrototype, Method, any>
export function MCPResource<ClassPrototype extends Controller, Method, DTOConstructor extends typeof DTO = typeof DTO>(uri: string, dtoConstructorOrOptions?: DTOConstructor | MCPResourceOptions, options?: MCPResourceOptions): MethodDecorator<ClassPrototype, Method, any> {
    return (target: ClassPrototype, propertyKey: any, descriptor: TypedPropertyDescriptor<Method>): TypedPropertyDescriptor<Method> => {
        registerMCPAction('resource', uri, target, propertyKey, dtoConstructorOrOptions, options, SplitOptions)
        return descriptor
    }
}
