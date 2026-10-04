# @lakutata/dbus

The D-Bus channel of the [lakutata](https://github.com/lakutata/lakutata) framework: the application owns a service
name on a bus (the system bus, the session bus or a private bus) and serves its controllers as the interfaces of D-Bus
objects: their methods, properties and signals. It also has a D-Bus client component, to call the other services of a
bus, read their properties and listen to their signals. The protocol is implemented by
[dbus-sdk](https://github.com/myq1991/node-dbus-sdk), whose classes this package re-exports. The umbrella package
`lakutata` does not re-export it: import it from `@lakutata/dbus`.

## Installation

```shell
npm install lakutata @lakutata/dbus
```

- It needs a D-Bus daemon, as on Linux: the system bus (`/var/run/dbus/system_bus_socket`), the session bus of a
  desktop session (`DBUS_SESSION_BUS_ADDRESS`), or a private `dbus-daemon`. Owning a name on the system bus needs a bus
  policy allowing it (a file of `/etc/dbus-1/system.d/`).
- dbus-sdk builds a native module (`native-machine-id`) with node-gyp when it is installed: a recent node-gyp is needed
  with Python 3.12 or later.
- Node.js 22 or later; its peer dependencies `@lakutata/core` and `@lakutata/entrypoint` come with `lakutata`.

## Usage

### A D-Bus service

`DBusEntrypoint` is the `dbus` adapter of the entrypoint. A controller declared with `@DBusInterface` serves an
interface at an object path; its `@DBusMethod` actions are the interface's methods.

```typescript
import {Application, DTO} from 'lakutata'
import {BuildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {Expect, Return} from 'lakutata/decorator/dto'
import {DBusEntrypoint, DBusInterface, DBusMethod} from '@lakutata/dbus'

class ConfigureDTO extends DTO {
    @Expect(DTO.String().required())
    public sn: string

    @Expect(DTO.Number().integer().min(0).optional())
    public retries?: number
}

@DBusInterface('com.example.Manager', {path: '/com/example/Manager'})
class ManagerController extends Controller {
    //No argument, returns a string (s)
    @DBusMethod('Ping', {returns: 's'})
    public async ping(): Promise<string> {
        return 'pong'
    }

    //One argument a{sv}, returns a dictionary a{sv} (the type of @Return)
    @DBusMethod('Configure', ConfigureDTO)
    @Return(ConfigureDTO)
    public async configure(input: ConfigureDTO): Promise<ConfigureDTO> {
        return input
    }
}

//busctl --user call com.example.DeviceService /com/example/Manager com.example.Manager Ping
Application.run(() => ({
    id: 'devices.app',
    name: 'Devices',
    components: {
        entrypoint: BuildEntrypoints({
            controllers: [ManagerController],
            dbus: DBusEntrypoint({bus: 'session', service: 'com.example.DeviceService'})
        })
    },
    bootstrap: ['entrypoint']
}))
```

- **The input** of a method with a DTO is one argument, a dictionary of variants (`a{sv}`) holding the DTO's
  properties; a method without a DTO takes no argument. The input goes through the middlewares, the validation and the
  access control of the entrypoint, as in the other channels.
- **The result** has the type of the `returns` option (a DTO is `a{sv}`, or a signature such as `'s'`), or else the type
  of the `@Return` schema: an object is `a{sv}`, a string `s`, a boolean `b`, an integer `x`, another number `d`, an
  array `av`, the other values a variant `v`. Without them, the method has no result. The dates are sent as ISO
  strings, the `null` and `undefined` values are left out (a variant has no null).
- **The errors** reach the callers as D-Bus errors named after their `errno`, prefixed by the service name
  (`com.example.DeviceService.E_OFFLINE`), with their message.
- **The context** of the methods is a `DBusContext`: `context.path`, `context.interface` and `context.member`.
- **Several controllers** at the same path are the interfaces of the same objects. The objects implement
  `org.freedesktop.DBus.Properties`, `Introspectable` and `Peer`, and the root object `/` implements `ObjectManager`.
- A method may also carry the decorators of the other channels (`@ServiceAction`, `@GET`…).

### The adapter

```text
dbus: DBusEntrypoint({bus: 'system', service: 'com.example.DeviceService', replaceExisting: true})
```

- `bus`: `'session'` (default, the address in `DBUS_SESSION_BUS_ADDRESS`), `'system'` (`DBUS_SYSTEM_BUS_ADDRESS`, else
  `unix:path=/var/run/dbus/system_bus_socket`), the address of a bus (`unix:path=…`, `tcp:host=…,port=…`), or the path
  of the socket of a private bus.
- `service`: the well-known name of the service. The adapter fails to start when another connection owns it
  (`replaceExisting` takes it when its owner allows it, `allowReplacement` lets another service take it).
- `name` and `middlewares`: the adapter's name, and the middlewares of its calls (after the global ones).
- It stops gracefully with the entrypoint: the name is released, the calls in progress end, then the connection
  closes.

### Objects, properties and signals

The path of an interface is either a path (`/com/example/Manager`), whose object is exported when the adapter starts
and stays exported while it runs (`DBusObjectManager.removeObject()` does not remove it), or a template
(`/com/example/Devices/{sn}`), whose objects are added and removed with `DBusObjectManager`. The
variables of the path are merged into the input of the methods, as the route parameters (they take precedence over the
client's input).

A property is a value of an object, kept by `DBusObjectManager`: the application sets it, the clients read it and are
notified of its changes (`PropertiesChanged`); until it is set, its value is its `initial` value. A `writable`
property is also written by the clients: the value is validated by the property's `schema` (the errors are given to the
client), kept, and `DBusObjectManager` emits `propertyWritten`. A write which must reach a device, or may fail after
the validation, is better a method: its errors are given to the caller. A signal's data is validated by its DTO when it
is emitted.

```typescript
import {Component, DTO} from 'lakutata'
import {Controller} from 'lakutata/com/entrypoint'
import {Expect, Return} from 'lakutata/decorator/dto'
import {Inject} from 'lakutata/decorator/di'
import {
    DBusInterface,
    DBusMethod,
    DBusObjectManager,
    DefineDBusProperty,
    DefineDBusSignal,
    type DBusPropertyWrite
} from '@lakutata/dbus'

class DeviceSnDTO extends DTO {
    @Expect(DTO.String().required())
    public sn: string
}

class StatusDTO extends DTO {
    @Expect(DTO.String().required())
    public sn: string

    @Expect(DTO.Boolean().required())
    public online: boolean
}

export const DeviceChanged = DefineDBusSignal<StatusDTO>('Changed', StatusDTO)
export const DeviceState = DefineDBusProperty<string>('State', 's', {initial: 'idle'})
export const DeviceLevel = DefineDBusProperty<number>('Level', 'i', {writable: true, initial: 1, schema: DTO.Number().integer().min(0).max(10)})

@DBusInterface('com.example.Device', {path: '/com/example/Devices/{sn}', signals: [DeviceChanged], properties: [DeviceState, DeviceLevel]})
export class DeviceController extends Controller {
    //The sn of the input is the one of the object path
    @DBusMethod('Status', DeviceSnDTO)
    @Return(StatusDTO)
    public async status(input: DeviceSnDTO): Promise<StatusDTO> {
        return {sn: input.sn, online: true} as StatusDTO
    }
}

//Registered in the components of the application
export class Devices extends Component {
    @Inject(DBusObjectManager)
    protected readonly manager: DBusObjectManager

    protected async init(): Promise<void> {
        this.manager.on('propertyWritten', (write: DBusPropertyWrite): void => {
            if (write.property === DeviceLevel) console.log(`${write.path}: level ${write.value}`)
        })
    }

    public plug(sn: string): void {
        const path: string = `/com/example/Devices/${sn}`
        //Exported by the interfaces of the matching templates
        this.manager.addObject(path)
        this.manager.setPropertyValue(path, DeviceState, 'running')
        this.manager.emitSignal(path, DeviceChanged, {sn: sn, online: true} as StatusDTO)
    }

    public unplug(sn: string): void {
        this.manager.removeObject(`/com/example/Devices/${sn}`)
    }
}
```

`DBusObjectManager` is autoloaded, one per application: inject it in any object (`@Inject(DBusObjectManager)`) or get
it (`getObject(DBusObjectManager)`). The objects added before the adapter starts are exported when it starts. The
clients are told of the objects added and removed by the `ObjectManager` of the service (`InterfacesAdded`,
`InterfacesRemoved`).

### The client

`DBusClientComponent` connects to a bus when it is created, to call the services, read their objects and properties,
and listen to their signals; it disconnects when the application stops.

```typescript
import {Application} from 'lakutata'
import {DBusClientComponent, type DBusRemoteInterface} from '@lakutata/dbus'

Application
    .run(() => ({
        id: 'client.app',
        name: 'Client',
        components: {
            dbus: {class: DBusClientComponent, busAddress: 'unix:path=/var/run/dbus/system_bus_socket', timeout: 5000}
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const dbus: DBusClientComponent = await app.getObject('dbus')
        //A method call with an explicit signature: the output arguments, as an array
        const [status] = await dbus.invoke({
            service: 'com.example.DeviceService',
            objectPath: '/com/example/Devices/A1',
            interface: 'com.example.Device',
            method: 'Status',
            signature: 'a{sv}',
            args: [{sn: 'A1'}]
        })
        console.log(status)
        //An interface built from the introspection of its object
        const device: DBusRemoteInterface = await dbus.interface('com.example.DeviceService', '/com/example/Devices/A1', 'com.example.Device')
        console.log(await device.property.State.get())
        device.signal.on('Changed', (data: unknown): void => console.log(data))
        //The events of the connection
        dbus.on('NameOwnerChanged', (name: string, oldOwner: string, newOwner: string): void => console.log(name, oldOwner, newOwner))
    })
```

`buildDBusClientOptions(options)` builds the same declaration from typed options:
`dbus: buildDBusClientOptions({busAddress: 'unix:path=/var/run/dbus/system_bus_socket'})`.

## API

| Export | What it is |
|---|---|
| `DBusEntrypoint`, `DBusEntrypointOptions` | The adapter of the entrypoint (its `dbus` option): the bus, the service name |
| `DBusInterface`, `DBusInterfaceOptions` | Class decorator: a controller served as a D-Bus interface at an object path or path template |
| `DBusMethod`, `DBusMethodOptions` | Method decorator: an action served as a method of the interface, the type of its result |
| `DefineDBusSignal`, `DBusSignalDefinition` | Declares a signal, its DTO or signature |
| `DefineDBusProperty`, `DBusPropertyDefinition`, `DBusPropertyOptions` | Declares a property: its signature, `writable`, `initial`, `schema` |
| `DBusInterfaceDeclaration` | The declaration `@DBusInterface` records |
| `DBusObjectManager` | The objects of the templates, the property values and the signals: `addObject`, `removeObject`, `hasObject`, `objects`, `setPropertyValue`, `getPropertyValue`, `emitSignal`; the `propertyWritten` event |
| `DBusPropertyWrite` | A property written by a client, the argument of `propertyWritten` |
| `DBusContext`, `DBusContextParams`, `DBUS_CONTEXT_TYPE` | The context of the method calls: `path`, `interface`, `member` |
| `DBusChannel` | The definition of the `dbus` channel, for the custom adapters |
| `DBusClientComponent` | The client: `invoke`, `interface`, `interfaceSignal`, `object`, `service`, `services`, `listNames`, `listServices`, `nameHasOwner`, `getNameOwner`, `addMatch`, the connection events |
| `buildDBusClientOptions`, `DBusClientOptions` | The client's declaration and options: `busAddress`, `timeout`, `advancedResponse`, `convertBigIntToNumber` |
| `DBus`, `DBusRemoteInterface`, `DBusObject`, `DBusService`, `LocalService`, `LocalObject`, `LocalInterface`, `DBusSignedValue`, `DBusSignalEmitter`, `Signature`, `CreateDBusError`, `RequestNameFlags`, `RequestNameResultCode`, `ConnectOpts`, `InvokeOpts` | Re-exported from dbus-sdk (`DBusRemoteInterface` is its `DBusInterface`) |

The typings document each declaration with examples.

## Errors

| Error | When |
|---|---|
| `TypeError` | An invalid interface, member or service name, or object path, when the class is declared or `DBusEntrypoint()` is called; `DBusObjectManager.addObject()` with a template; the start of the adapter, when a `@DBusMethod` belongs to a controller without `@DBusInterface` |
| `Error` (`The DBus name … is owned by another service`) | The adapter's start, when another connection owns the service name; the entrypoint fails to start |
| The errors of dbus-sdk (`UnknownBusAddressError`, a connection error…) | The adapter's start or the client's creation, when the bus cannot be reached; the client's calls, when a method answers a D-Bus error |
| `InvalidValueException` (from `lakutata`) | `setPropertyValue()` or `emitSignal()` with a value its schema or DTO refuses; the client's options when it is created |

The errors thrown by the actions are given to the callers as D-Bus errors named after their `errno`
(`com.example.DeviceService.E_OFFLINE`), with their message; a client writing an invalid property value gets a D-Bus
error too.

## See also

- `@lakutata/entrypoint` (`lakutata/com/entrypoint`): the entrypoint, the controllers, the middlewares and the access
  control (`doc/en/ActionPattern.md` of the package `lakutata`, Chinese in `doc/zh`).
- [dbus-sdk](https://github.com/myq1991/node-dbus-sdk): the D-Bus protocol, its client classes and its local services.
- `@lakutata/core` (`lakutata`): the components, `Application` and the dependency injection.
