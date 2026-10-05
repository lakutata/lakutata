import {after, afterEach, before, it} from 'node:test'
import assert from 'node:assert'
import {Container, type ComponentOptions, type ModuleOptions} from '@lakutata/core'
import {BuildEntrypoints, Entrypoint, type ActionInvocation, type MiddlewareHandler, type Next} from '@lakutata/entrypoint'
import {
    buildDBusClientOptions,
    DBus,
    DBusClientComponent,
    DBusClientOptions,
    DBusContext,
    DBusEntrypoint,
    DBusEntrypointOptions,
    DBusObjectManager,
    DBusPropertyWrite
} from '../exports/DBus.js'
import {describeBus, StartBus, TestBus} from './support/Bus.js'
import {contexts, DeviceChanged, DeviceController, DeviceLevel, DeviceState, ManagerController} from './support/Controllers.js'

const SERVICE: string = 'com.example.Devices'

let bus: TestBus

//The entrypoints and the clients of a test, released after it even when it fails
const started: { container: Container, client: DBus }[] = []

/**
 * Wait
 * @param ms
 */
function Sleep(ms: number): Promise<void> {
    return new Promise((resolve: () => void): unknown => setTimeout(resolve, ms))
}

/**
 * Start an entrypoint serving the controllers on the bus
 * @param options
 * @param entrypointOptions
 */
async function Start(options: Partial<DBusEntrypointOptions> = {}, entrypointOptions: Record<string, unknown> = {}): Promise<{ container: Container, manager: DBusObjectManager, client: DBus }> {
    const container: Container = new Container()
    await container.set(Entrypoint, BuildEntrypoints({
        controllers: [ManagerController, DeviceController],
        ...entrypointOptions,
        dbus: DBusEntrypoint({bus: bus.socket, service: SERVICE, ...options})
    }))
    const manager: DBusObjectManager = await container.get(DBusObjectManager)
    const client: DBus = await DBus.connect({socket: bus.socket})
    started.push({container: container, client: client})
    return {container: container, manager: manager, client: client}
}

/**
 * Call a method of the service
 * @param client
 * @param objectPath
 * @param iface
 * @param method
 * @param input
 */
async function Call(client: DBus, objectPath: string, iface: string, method: string, input?: Record<string, unknown>): Promise<any[]> {
    return await client.invoke({
        service: SERVICE,
        objectPath: objectPath,
        interface: iface,
        method: method,
        ...(input ? {signature: 'a{sv}', args: [input]} : {})
    })
}

describeBus('DBus adapter', (): void => {

    before(async (): Promise<void> => {
        bus = await StartBus()
    })

    after(async (): Promise<void> => {
        await bus?.stop()
    })

    afterEach(async (): Promise<void> => {
        for (const {container, client} of started.splice(0)) {
            await client.disconnect().catch((): undefined => undefined)
            await container.destroy().catch((): undefined => undefined)
        }
    })

    it('serves the methods of the static objects', async (): Promise<void> => {
        const trace: string[] = []
        const traced: MiddlewareHandler = async (invocation: ActionInvocation, next: Next): Promise<unknown> => {
            trace.push(`${invocation.context.type}:${(invocation.context as DBusContext).interface}.${(invocation.context as DBusContext).member}`)
            return next()
        }
        const {container, client} = await Start({}, {middlewares: [traced]})
        assert.deepStrictEqual(await Call(client, '/com/example/Manager', 'com.example.Manager', 'Ping'), ['pong'])
        //The input and the result of @Return are dictionaries of variants
        assert.deepStrictEqual(await Call(client, '/com/example/Manager', 'com.example.Manager', 'Configure', {sn: 'A1', retries: 3}), [{sn: 'A1', online: true, retries: 3}])
        assert.deepStrictEqual(await Call(client, '/com/example/Manager', 'com.example.Manager', 'Reset'), [])
        assert.deepStrictEqual(trace, ['DBUS:com.example.Manager.Ping', 'DBUS:com.example.Manager.Configure', 'DBUS:com.example.Manager.Reset'])
        const xml: string = (await client.invoke({service: SERVICE, objectPath: '/com/example/Manager', interface: 'org.freedesktop.DBus.Introspectable', method: 'Introspect'}))[0]
        assert.match(xml, /<method name="Configure">\s*<arg direction="in" type="a\{sv}" name="input"\/>\s*<arg direction="out" type="a\{sv}" name="output"\/>/)
        assert.match(xml, /<method name="Ping">\s*<arg direction="out" type="s" name="output"\/>/)
        await client.disconnect()
        await container.destroy()
    })

    it('gives the errors to the callers', async (): Promise<void> => {
        const {container, manager, client} = await Start()
        manager.addObject('/com/example/Devices/OFF')
        await assert.rejects(Call(client, '/com/example/Devices/OFF', 'com.example.Device', 'Reboot', {}), {name: `${SERVICE}.E_OFFLINE`, message: 'The device OFF is offline'})
        //The input is validated by the DTO
        await assert.rejects(Call(client, '/com/example/Manager', 'com.example.Manager', 'Configure', {sn: 'A1', retries: -1}), {name: `${SERVICE}.E_INVALID_VALUE`})
        await client.disconnect()
        await container.destroy()
    })

    it('adds and removes the objects of the templates', async (): Promise<void> => {
        const {container, manager, client} = await Start()
        await assert.rejects(Call(client, '/com/example/Devices/A1', 'com.example.Device', 'Status', {}))
        assert.strictEqual(manager.addObject('/com/example/Devices/A1'), true)
        contexts.length = 0
        //The variables of the path are merged into the input, over the data
        assert.deepStrictEqual(await Call(client, '/com/example/Devices/A1', 'com.example.Device', 'Status', {sn: 'other'}), [{sn: 'A1', online: true}])
        assert.strictEqual(contexts[0].path, '/com/example/Devices/A1')
        assert.deepStrictEqual(manager.objects(), ['/com/example/Devices/A1'])
        //The ObjectManager of the service lists the objects
        const managed: Record<string, unknown> = (await client.invoke({service: SERVICE, objectPath: '/', interface: 'org.freedesktop.DBus.ObjectManager', method: 'GetManagedObjects'}))[0]
        assert.ok(Object.keys(managed).includes('/com/example/Devices/A1'))
        assert.strictEqual(manager.removeObject('/com/example/Devices/A1'), true)
        await assert.rejects(Call(client, '/com/example/Devices/A1', 'com.example.Device', 'Status', {}))
        assert.throws((): boolean => manager.addObject('/com/example/Devices/{sn}'), /template/)
        await client.disconnect()
        await container.destroy()
    })

    it('keeps the fixed objects exported when they are removed', async (): Promise<void> => {
        const {container, manager, client} = await Start()
        //A path without variables, exported by the adapter at its start, is also added
        assert.strictEqual(manager.addObject('/com/example/Manager'), true)
        assert.strictEqual(manager.hasObject('/com/example/Manager'), true)
        manager.setPropertyValue('/com/example/Manager', DeviceState, 'running')
        assert.strictEqual(manager.removeObject('/com/example/Manager'), true)
        //Only what addObject added is removed: the object stays exported, with its values
        assert.strictEqual(manager.hasObject('/com/example/Manager'), false)
        assert.deepStrictEqual(manager.objects(), [])
        assert.strictEqual(manager.getPropertyValue('/com/example/Manager', DeviceState), 'running')
        assert.deepStrictEqual(await Call(client, '/com/example/Manager', 'com.example.Manager', 'Ping'), ['pong'])
        const managed: Record<string, unknown> = (await client.invoke({service: SERVICE, objectPath: '/', interface: 'org.freedesktop.DBus.ObjectManager', method: 'GetManagedObjects'}))[0]
        assert.ok(Object.keys(managed).includes('/com/example/Manager'))
        assert.strictEqual(manager.removeObject('/com/example/Manager'), false)
        await client.disconnect()
        await container.destroy()
    })

    it('declares the client with buildDBusClientOptions', async (): Promise<void> => {
        const options: ComponentOptions<DBusClientOptions> = buildDBusClientOptions({busAddress: `unix:path=${bus.socket}`, timeout: 5000})
        //The declaration is accepted by the components of a module
        const components: ModuleOptions['components'] = {dbus: options}
        assert.strictEqual(components!.dbus, options)
        assert.strictEqual(options.class, DBusClientComponent)
        const container: Container = new Container()
        try {
            const dbus: DBusClientComponent = await container.setNamed('dbus', options.class, options)
            assert.ok(dbus instanceof DBusClientComponent)
            assert.ok((await dbus.listNames()).includes('org.freedesktop.DBus'))
        } finally {
            await container.destroy()
        }
    })

    it('encodes the Maps and the typed values of the results', async (): Promise<void> => {
        const {client} = await Start()
        //The keys of a Map keep their types, the 64-bit integers are bigints for the clients decoding them so
        assert.deepStrictEqual((await Call(client, '/com/example/Manager', 'com.example.Manager', 'Counters'))[0], {1: 10n, 2: 20n})
        const [size] = await client.invoke({service: SERVICE, objectPath: '/com/example/Manager', interface: 'com.example.Manager', method: 'Size', decode: {types: 'variants'}})
        assert.strictEqual(size.signature, 'u')
        assert.strictEqual(size.value, 7)
    })

    it('listens to the events of the bus, calls without reply and decodes the 64-bit integers as numbers', async (): Promise<void> => {
        const container: Container = new Container()
        try {
            const dbus: DBusClientComponent = await container.setNamed('dbus', DBusClientComponent, {busAddress: `unix:path=${bus.socket}`})
            const online: string[] = []
            const owners: string[] = []
            dbus.on('serviceOnline', (name: string): unknown => online.push(name))
            dbus.on('nameOwnerChanged', (name: string): unknown => owners.push(name))
            await Sleep(100)
            await Start()
            await Sleep(100)
            assert.ok(online.includes(SERVICE))
            assert.ok(owners.includes(SERVICE))
            assert.strictEqual(dbus.invoke({service: SERVICE, objectPath: '/com/example/Manager', interface: 'com.example.Manager', method: 'Reset', noReply: true}), undefined)
            const [counters] = await dbus.invoke({service: SERVICE, objectPath: '/com/example/Manager', interface: 'com.example.Manager', method: 'Counters'})
            assert.deepStrictEqual(counters, {1: 10, 2: 20})
        } finally {
            await container.destroy()
        }
    })

    it('serves the properties', async (): Promise<void> => {
        const {container, manager, client} = await Start()
        manager.addObject('/com/example/Devices/B2')
        const get = async (name: string): Promise<unknown> => (await client.invoke({service: SERVICE, objectPath: '/com/example/Devices/B2', interface: 'org.freedesktop.DBus.Properties', method: 'Get', signature: 'ss', args: ['com.example.Device', name]}))[0]
        assert.strictEqual(await get('State'), 'idle')
        //The application updates a property, the clients are notified
        const changes: unknown[] = []
        const properties = await client.getInterface(SERVICE, '/com/example/Devices/B2', 'org.freedesktop.DBus.Properties')
        properties.signal.on('PropertiesChanged', (iface: string, changed: Record<string, unknown>): unknown => changes.push([iface, changed]))
        await Sleep(100)
        manager.setPropertyValue('/com/example/Devices/B2', DeviceState, 'running')
        await Sleep(100)
        assert.strictEqual(await get('State'), 'running')
        assert.deepStrictEqual(changes, [['com.example.Device', {State: 'running'}]])
        //A client writes a writable property, the application is told
        const writes: DBusPropertyWrite[] = []
        manager.on('propertyWritten', (write: DBusPropertyWrite): unknown => writes.push(write))
        await client.invoke({service: SERVICE, objectPath: '/com/example/Devices/B2', interface: 'org.freedesktop.DBus.Properties', method: 'Set', signature: 'ssv', args: ['com.example.Device', 'Level', 5]})
        assert.strictEqual(await get('Level'), 5)
        assert.strictEqual(manager.getPropertyValue('/com/example/Devices/B2', DeviceLevel), 5)
        assert.deepStrictEqual(writes.map((write: DBusPropertyWrite): unknown => [write.path, write.interface, write.property.name, write.value]), [['/com/example/Devices/B2', 'com.example.Device', 'Level', 5]])
        //An invalid value is refused, the read-only properties cannot be written
        await assert.rejects(client.invoke({service: SERVICE, objectPath: '/com/example/Devices/B2', interface: 'org.freedesktop.DBus.Properties', method: 'Set', signature: 'ssv', args: ['com.example.Device', 'Level', 50]}))
        assert.strictEqual(await get('Level'), 5)
        await assert.rejects(client.invoke({service: SERVICE, objectPath: '/com/example/Devices/B2', interface: 'org.freedesktop.DBus.Properties', method: 'Set', signature: 'ssv', args: ['com.example.Device', 'State', 'hacked']}))
        await client.disconnect()
        await container.destroy()
    })

    it('emits the signals', async (): Promise<void> => {
        const {container, manager, client} = await Start()
        manager.addObject('/com/example/Devices/C3')
        const received: unknown[] = []
        const device = await client.getInterface(SERVICE, '/com/example/Devices/C3', 'com.example.Device')
        device.signal.on('Changed', (data: unknown): unknown => received.push(data))
        await Sleep(100)
        assert.strictEqual(manager.emitSignal('/com/example/Devices/C3', DeviceChanged, {sn: 'C3', online: false}), true)
        await Sleep(100)
        assert.deepStrictEqual(received, [{sn: 'C3', online: false}])
        //The data of a signal is validated, an object not exported emits nothing
        assert.throws((): boolean => manager.emitSignal('/com/example/Devices/C3', DeviceChanged, {sn: 'C3'} as any))
        assert.strictEqual(manager.emitSignal('/com/example/Devices/NONE', DeviceChanged, {sn: 'NONE', online: true}), false)
        await client.disconnect()
        await container.destroy()
    })

    it('exports the objects added before it started, and fails when the name is owned', async (): Promise<void> => {
        const first = await Start()
        first.manager.addObject('/com/example/Devices/D4')
        //Another entrypoint of the same application cannot own the name
        const second: Container = new Container()
        await assert.rejects(second.set(Entrypoint, BuildEntrypoints({controllers: [ManagerController], dbus: DBusEntrypoint({bus: bus.socket, service: SERVICE})})), /owned by another service/)
        await second.destroy()
        await first.client.disconnect()
        await first.container.destroy()
    })

    it('stops gracefully', async (): Promise<void> => {
        const {container, client} = await Start()
        const inProgress: Promise<any[]> = Call(client, '/com/example/Manager', 'com.example.Manager', 'Slow')
        await Sleep(30)
        await container.destroy()
        assert.deepStrictEqual(await inProgress, ['slow'])
        await assert.rejects(Call(client, '/com/example/Manager', 'com.example.Manager', 'Ping'))
        await client.disconnect()
    })
})
