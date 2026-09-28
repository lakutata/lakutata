import EventEmitter from 'node:events'
import {FlexibleDTO, GetMethodReturnSchema} from '@lakutata/core/internal'
import type {IBaseObjectConstructor, Schema} from '@lakutata/core'
import type {ChannelActionInfo, ChannelRuntime, Controller, EntrypointAdapter, MiddlewareDefinition} from '@lakutata/entrypoint'
import {DBusSignedValue, LocalInterface, LocalObject, LocalService, RequestNameFlags, RequestNameResultCode} from 'dbus-sdk'
import type {ConnectOpts} from 'dbus-sdk'
import {DBusChannel} from '../channel/DBusChannel.js'
import {DBusContext} from '../context/DBusContext.js'
import {ATTACH, DBusObjectManager, type DBusObjectSink, STORE} from '../components/DBusObjectManager.js'
import {type DBusInterfaceDeclaration, type DBusPropertyDefinition, type DBusSignalDefinition, GetDBusInterfaceDeclaration} from '../lib/Declarations.js'
import {CheckInterfaceName, CompilePathTemplate, ErrorName, type PathTemplate} from '../lib/Names.js'
import {Encodable, SchemaSignature} from '../lib/Signature.js'

export type DBusEntrypointOptions = {
    /**
     * The adapter name
     */
    name?: string
    /**
     * The bus: 'session' (default), 'system', the address of a bus ("unix:path=…", "tcp:host=…") or the path of the socket of a private bus
     */
    bus?: 'session' | 'system' | string
    /**
     * The well-known name of the service on the bus ("com.example.DeviceService")
     */
    service: string
    /**
     * Take the name from its current owner if it allows it, false by default: the adapter fails to start when the name is owned
     */
    replaceExisting?: boolean
    /**
     * Let another service take the name, false by default
     */
    allowReplacement?: boolean
    /**
     * The middlewares of the methods of this adapter, run after the global middlewares
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
 * The DBus service of the application: the controllers declared with @DBusInterface are the interfaces of its objects,
 * their @DBusMethod actions are the methods; the objects of the templates are added and removed with DBusObjectManager
 * @param options
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
     * @param runtime
     * @param action
     */
    const resultSignature = (runtime: ChannelRuntime<DBusContext>, action: ChannelActionInfo): string | undefined => {
        if (action.address.returns !== undefined) return action.address.returns
        const controller: IBaseObjectConstructor<Controller> | undefined = runtime.controllers.find((candidate: IBaseObjectConstructor<Controller>): boolean => candidate.name === action.controller)
        const schema: Schema | undefined = controller ? GetMethodReturnSchema(controller.prototype, action.method) : undefined
        return schema ? SchemaSignature(schema) : undefined
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
                    const returns: string | undefined = resultSignature(runtime, action)
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

            //The objects of the paths without variables are exported at once
            for (const {template} of templates.values()) if (template.static) addObject(template.template)
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
                    if (!exported.delete(path)) return false
                    return localService.removeObject(path)
                },
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
