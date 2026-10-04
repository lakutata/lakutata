import EventEmitter from 'node:events'
import {FlexibleDTO} from '@lakutata/core/dtos'
import type {ChannelActionInfo, ChannelRuntime, EntrypointAdapter, MiddlewareDefinition} from '@lakutata/entrypoint'
import {DBusSignedValue, LocalInterface, LocalObject, LocalService, RequestNameFlags, RequestNameResultCode, type ConnectOpts} from 'dbus-sdk'
import {DBusChannel} from '../channel/DBusChannel.js'
import {DBusContext} from '../context/DBusContext.js'
import {ATTACH, DBusObjectManager, type DBusObjectSink, STORE} from '../components/DBusObjectManager.js'
import {type DBusInterfaceDeclaration, type DBusPropertyDefinition, type DBusSignalDefinition, GetDBusInterfaceDeclaration} from '../lib/Declarations.js'
import {CheckInterfaceName, CompilePathTemplate, ErrorName, type PathTemplate} from '../lib/Names.js'
import {Encodable, SchemaSignature} from '../lib/Signature.js'

/**
 * The options of {@link DBusEntrypoint}: the bus to connect to, and the service name to own on it.
 */
export type DBusEntrypointOptions = {
    /**
     * The adapter's name, which tells it apart from the entrypoint's other adapters.
     * @default undefined
     */
    name?: string
    /**
     * The bus to connect to: `'session'` (the address in `DBUS_SESSION_BUS_ADDRESS`), `'system'` (the address in
     * `DBUS_SYSTEM_BUS_ADDRESS`, else `unix:path=/var/run/dbus/system_bus_socket`), the address of a bus
     * (`'unix:path=/run/my-bus.sock'`, `'tcp:host=127.0.0.1,port=5555'`), or the path of the socket of a private bus.
     * The adapter fails to start when the bus cannot be reached (for `'session'`, also when `DBUS_SESSION_BUS_ADDRESS`
     * is not set).
     * @default 'session'
     */
    bus?: 'session' | 'system' | string
    /**
     * The well-known name the service owns on the bus (`'com.example.DeviceService'`): two or more elements separated by
     * dots. The clients address the service by it, and it prefixes the names of the D-Bus errors. On the system bus,
     * the bus policy (`/etc/dbus-1/system.d/`) must allow the process to own it.
     */
    service: string
    /**
     * Take the name from its current owner when that owner allowed it to be replaced (`allowReplacement`). Without it,
     * the adapter fails to start when another connection owns the name; the request is never queued.
     * @default false
     */
    replaceExisting?: boolean
    /**
     * Let another connection take the name with `replaceExisting`. The adapter is not stopped when the name is taken:
     * the clients reach the new owner.
     * @default false
     */
    allowReplacement?: boolean
    /**
     * The middlewares of this adapter's method calls, run after the entrypoint's global middlewares.
     * @default []
     */
    middlewares?: MiddlewareDefinition[]
}

/**
 * The interfaces served at a path template
 */
type TemplateInterfaces = {
    template: PathTemplate
    interfaces: Map<string, {
        declaration?: DBusInterfaceDeclaration
        methods: ChannelActionInfo[]
    }>
}

/**
 * An object exported
 */
type ExportedObject = {
    object: LocalObject
    signals: Map<string, { signal: DBusSignalDefinition<any>, emitter: EventEmitter }[]>
    properties: Map<DBusPropertyDefinition<any>, string[]>
}

/**
 * The connection options of a bus
 * @param bus
 */
function ConnectOptions(bus: string): ConnectOpts {
    if (bus === 'session') return {busAddress: process.env.DBUS_SESSION_BUS_ADDRESS}
    if (bus === 'system') return {busAddress: process.env.DBUS_SYSTEM_BUS_ADDRESS ?? 'unix:path=/var/run/dbus/system_bus_socket'}
    if (/^[a-z]+:/.test(bus)) return {busAddress: bus}
    return {socket: bus}
}

/**
 * The error given to the caller of a method
 * @param error
 */
function MethodError(error: unknown): Error {
    const {errMsg, message} = (error && typeof error === 'object' ? error : {}) as { errMsg?: unknown, message?: unknown }
    const methodError: Error = new Error(typeof errMsg === 'string' && errMsg ? errMsg : typeof message === 'string' ? message : String(error))
    methodError.name = ErrorName(error)
    return methodError
}

/**
 * Build the D-Bus adapter of the entrypoint (its `dbus` option): the application owns a service name on a bus and
 * serves the controllers declared with `@DBusInterface` as the interfaces of its objects, their `@DBusMethod` actions
 * as the methods. The objects of the paths without variables are exported when the adapter starts, until it stops
 * ({@link DBusObjectManager.removeObject} does not remove them); the objects of the path templates are exported when
 * they are added with {@link DBusObjectManager.addObject}, before or after the start.
 *
 * Starting connects to the bus and requests the name. The adapter stops gracefully with the entrypoint: it releases the
 * name (no new call reaches it), the calls in progress end, then the connection closes. It needs a D-Bus daemon, as on
 * Linux: the system bus, a session bus, or a private `dbus-daemon`.
 * @param options The bus, the service name and how it is owned, the adapter's middlewares.
 * @returns The adapter, to give to the `dbus` option of `BuildEntrypoints()`.
 * @throws {TypeError} At once, when the service name is invalid; when the adapter starts, when an action declared with
 * `@DBusMethod` belongs to a controller without `@DBusInterface`.
 * @throws {Error} When the adapter starts, if the bus cannot be reached, or if another connection owns the name
 * (`The DBus name … is owned by another service`): the entrypoint fails to start.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {BuildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {DBusEntrypoint, DBusInterface, DBusMethod} from '@lakutata/dbus'
 *
 * @DBusInterface('com.example.Manager', {path: '/com/example/Manager'})
 * class ManagerController extends Controller {
 *     @DBusMethod('Ping', {returns: 's'})
 *     public async ping(): Promise<string> {
 *         return 'pong'
 *     }
 * }
 *
 * //busctl --system call com.example.DeviceService /com/example/Manager com.example.Manager Ping
 * Application.run(() => ({
 *     id: 'devices.app',
 *     name: 'Devices',
 *     components: {
 *         entrypoint: BuildEntrypoints({
 *             controllers: [ManagerController],
 *             dbus: DBusEntrypoint({bus: 'system', service: 'com.example.DeviceService'})
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * }))
 * ```
 */
export function DBusEntrypoint(options: DBusEntrypointOptions): EntrypointAdapter<DBusContext> {
    CheckInterfaceName(options.service)
    let service: LocalService | undefined
    let detach: (() => void) | undefined
    const exported: Map<string, ExportedObject> = new Map()

    /**
     * The interfaces of the controllers and of the actions, by path template
     * @param runtime
     */
    const collect = (runtime: ChannelRuntime<DBusContext>): Map<string, TemplateInterfaces> => {
        const templates: Map<string, TemplateInterfaces> = new Map()
        const interfacesAt = (path: string, name: string): { declaration?: DBusInterfaceDeclaration, methods: ChannelActionInfo[] } => {
            let template: TemplateInterfaces | undefined = templates.get(path)
            if (!template) {
                template = {template: CompilePathTemplate(path), interfaces: new Map()}
                templates.set(path, template)
            }
            let interfaces = template.interfaces.get(name)
            if (!interfaces) {
                interfaces = {methods: []}
                template.interfaces.set(name, interfaces)
            }
            return interfaces
        }
        for (const controller of runtime.controllers) {
            const declaration: DBusInterfaceDeclaration | undefined = GetDBusInterfaceDeclaration(controller)
            if (declaration) interfacesAt(declaration.path, declaration.interface).declaration = declaration
        }
        for (const action of runtime.actions) {
            const {path, interface: interfaceName, member} = action.address
            if (path === undefined || interfaceName === undefined) throw new TypeError(`The DBus method ${member} of ${action.controller} has no interface: declare its controller with @DBusInterface`)
            interfacesAt(path, interfaceName).methods.push(action)
        }
        return templates
    }

    /**
     * The signature of the result of a method: its returns option, or the schema of @Return
     * @param action
     */
    const resultSignature = (action: ChannelActionInfo): string | undefined => {
        if (action.address.returns !== undefined) return action.address.returns
        return action.returnSchema ? SchemaSignature(action.returnSchema) : undefined
    }

    return {
        channel: 'dbus',
        definition: DBusChannel,
        name: options.name,
        middlewares: options.middlewares,
        start: async (runtime: ChannelRuntime<DBusContext>): Promise<void> => {
            const templates: Map<string, TemplateInterfaces> = collect(runtime)
            const manager: DBusObjectManager = await runtime.getObject(DBusObjectManager)
            const localService: LocalService = new LocalService(options.service)
            service = localService

            /**
             * Build the interface of an object
             * @param path
             * @param name
             * @param served
             * @param variables
             * @param object
             */
            const buildInterface = (path: string, name: string, served: { declaration?: DBusInterfaceDeclaration, methods: ChannelActionInfo[] }, variables: Record<string, string>, object: ExportedObject): LocalInterface => {
                const localInterface: LocalInterface = new LocalInterface(name)
                for (const action of served.methods) {
                    const returns: string | undefined = resultSignature(action)
                    const hasInput: boolean = action.dto !== FlexibleDTO
                    localInterface.defineMethod({
                        name: action.address.member,
                        inputArgs: hasInput ? [{name: 'input', type: 'a{sv}'}] : [],
                        outputArgs: returns ? [{name: 'output', type: returns}] : [],
                        method: async (input?: Record<string, unknown>): Promise<unknown> => {
                            const context: DBusContext = new DBusContext({path: path, interface: name, member: action.address.member, data: input && typeof input === 'object' ? input : {}})
                            let result: unknown
                            try {
                                result = await runtime.dispatchTo(action, context, {params: variables})
                            } catch (error: unknown) {
                                throw MethodError(error)
                            }
                            if (!returns) return undefined
                            return Encodable(returns === 'a{sv}' && (result === undefined || result === null) ? {} : result)
                        }
                    })
                }
                for (const property of served.declaration?.properties ?? []) {
                    localInterface.defineProperty({
                        name: property.name,
                        type: property.type,
                        getter: (): unknown => Encodable(manager.getPropertyValue(path, property)),
                        //A value written by a client is validated synchronously: its errors are given to the client
                        setter: property.writable ? (value: unknown): void => {
                            let validated: unknown
                            try {
                                validated = property.validate(value)
                            } catch (error: unknown) {
                                //The errors given to DBus are plain errors (the name of an exception is read only)
                                throw MethodError(error)
                            }
                            manager[STORE]({path: path, interface: name, property: property, value: validated})
                        } : undefined,
                        emitPropertiesChanged: property.writable
                    })
                    object.properties.set(property, [...(object.properties.get(property) ?? []), name])
                }
                for (const signal of served.declaration?.signals ?? []) {
                    const emitter: EventEmitter = new EventEmitter()
                    localInterface.defineSignal({name: signal.name, args: [{name: 'data', type: signal.type}], eventEmitter: emitter})
                    const signals = object.signals.get(signal.name) ?? []
                    signals.push({signal: signal, emitter: emitter})
                    object.signals.set(signal.name, signals)
                }
                return localInterface
            }

            /**
             * Export an object
             * @param path
             */
            const addObject = (path: string): boolean => {
                if (exported.has(path)) return true
                const object: ExportedObject = {object: new LocalObject(path), signals: new Map(), properties: new Map()}
                let served: boolean = false
                for (const {template, interfaces} of templates.values()) {
                    const variables: Record<string, string> | undefined = template.match(path)
                    if (!variables) continue
                    interfaces.forEach((interfaceServed, name: string): unknown => object.object.addInterface(buildInterface(path, name, interfaceServed, variables, object)))
                    served = true
                }
                if (!served) return false
                exported.set(path, object)
                localService.addObject(object.object)
                return true
            }

            //The objects of the paths without variables are exported at once, and kept until the adapter closes
            const fixed: Set<string> = new Set()
            for (const {template} of templates.values()) {
                if (!template.static) continue
                fixed.add(template.template)
                addObject(template.template)
            }
            const connect: ConnectOpts = ConnectOptions(options.bus ?? 'session')
            let flags: number = RequestNameFlags.DBUS_NAME_FLAG_DO_NOT_QUEUE
            if (options.replaceExisting) flags |= RequestNameFlags.DBUS_NAME_FLAG_REPLACE_EXISTING
            if (options.allowReplacement) flags |= RequestNameFlags.DBUS_NAME_FLAG_ALLOW_REPLACEMENT
            const result: RequestNameResultCode = await localService.run({...connect, flags: flags} as any)
            if (result !== RequestNameResultCode.DBUS_REQUEST_NAME_REPLY_PRIMARY_OWNER && result !== RequestNameResultCode.DBUS_REQUEST_NAME_REPLY_ALREADY_OWNER) {
                await localService.stop().catch((): undefined => undefined)
                throw new Error(`The DBus name ${options.service} is owned by another service`)
            }
            const sink: DBusObjectSink = {
                addObject: addObject,
                removeObject: (path: string): boolean => {
                    if (fixed.has(path) || !exported.delete(path)) return false
                    return localService.removeObject(path)
                },
                isFixed: (path: string): boolean => fixed.has(path),
                emitSignal: (path: string, signal: DBusSignalDefinition<any>, data: unknown): boolean => {
                    const emitters = exported.get(path)?.signals.get(signal.name)?.filter((candidate): boolean => candidate.signal === signal)
                    if (!emitters?.length) return false
                    emitters.forEach(({emitter}): unknown => emitter.emit(signal.name, Encodable(data)))
                    return true
                },
                propertyChanged: (path: string, property: DBusPropertyDefinition<any>, value: unknown): void => {
                    const object: ExportedObject | undefined = exported.get(path)
                    const interfaces: string[] | undefined = object?.properties.get(property)
                    if (!object || !interfaces) return
                    const signed: DBusSignedValue = DBusSignedValue.parse(property.type, Encodable(value))[0]
                    interfaces.forEach((name: string): void => object.object.propertiesInterface.emitPropertiesChanged(name, {[property.name]: signed}, []))
                }
            }
            detach = manager[ATTACH](sink)
        },
        stop: async (): Promise<void> => {
            //The name is released: no new call reaches the service, the calls in progress end
            detach?.()
            detach = undefined
            await service?.dbus?.releaseName(options.service).catch((): undefined => undefined)
        },
        close: async (): Promise<void> => {
            await service?.dbus?.disconnect().catch((): undefined => undefined)
            exported.clear()
            service = undefined
        }
    }
}
