# @lakutata/dbus

The D-Bus channel of the [lakutata](https://github.com/lakutata/lakutata) framework. The application owns a service
name on a bus (the system bus, the session bus or a private bus) and serves its controllers as interfaces of D-Bus
objects, with methods, properties and signals. The package also provides a D-Bus client component that calls other
services on a bus, reads their properties and listens to their signals. The protocol is implemented by
[dbus-sdk](https://github.com/myq1991/node-dbus-sdk), whose classes this package re-exports. The umbrella package
`lakutata` does not re-export this package: import it from `@lakutata/dbus`.

## Installation

```shell
npm install lakutata @lakutata/dbus
```

- It needs a D-Bus daemon, as found on Linux: the system bus (`/var/run/dbus/system_bus_socket`), the session bus of
  a desktop session (`DBUS_SESSION_BUS_ADDRESS`), or a private `dbus-daemon`. To own a name on the system bus, a bus
  policy must allow it (a file in `/etc/dbus-1/system.d/`).
- It needs Node.js 22 or later. Its peer dependencies, `@lakutata/core` and `@lakutata/entrypoint`, are installed with
  `lakutata`.

## Usage

### A D-Bus service

`dbusEntrypoint` is the entrypoint's `dbus` adapter. A controller declared with `@DBusInterface` serves an interface at
an object path, and its `@DBusMethod` actions are the methods of that interface.

```typescript
import {Application, DTO} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {Expect, Return} from 'lakutata/decorator/dto'
import {dbusEntrypoint, DBusInterface, DBusMethod} from '@lakutata/dbus'

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
        entrypoint: buildEntrypoints({
            controllers: [ManagerController],
            dbus: dbusEntrypoint({bus: 'session', service: 'com.example.DeviceService'})
        })
    },
    bootstrap: ['entrypoint']
}))
```

- **Input**: a method with a DTO takes one argument, a dictionary of variants (`a{sv}`) holding the DTO's properties;
  a method without a DTO takes no argument. The input goes through the entrypoint's middlewares, validation and access
  control, as on the other channels.
- **Result**: its type is given by the `returns` option (a DTO, sent as `a{sv}`, or a signature such as `'s'`), or
  else by the `@Return` schema: an object becomes `a{sv}`, a string `s`, a boolean `b`, an integer or a bigint `x`, any
  other number `d`, an array `av`, and any other value a variant `v`. Without either, the method has no result. Dates
  are sent as ISO strings, and `null` and `undefined` values are left out of objects and arrays (a variant cannot hold
  null). A method whose result is a single type (`'s'`, `'i'`…) must return a value: `undefined` fails the call.
- **Errors** reach the callers as D-Bus errors named after their `errno` and prefixed with the service name
  (`com.example.DeviceService.E_OFFLINE`), with their message. An element of the `errno` that does not start with a
  letter gets an `E` prefix (`500` becomes `E500`, `_HIDDEN` becomes `E_HIDDEN`).
- **Context**: the context of the methods is a `DBusContext`, with `context.path`, `context.interface` and
  `context.member`.
- **Several controllers** with the same path are interfaces of the same objects. Every object also implements
  `org.freedesktop.DBus.Properties`, `Introspectable` and `Peer`, and the root object `/` implements `ObjectManager`.
- A method can also carry the decorators of other channels (`@ServiceAction`, `@GET`…).

### The adapter

```text
dbus: dbusEntrypoint({bus: 'system', service: 'com.example.DeviceService', replaceExisting: true})
```

- `bus`: `'session'` (the default: the address in `DBUS_SESSION_BUS_ADDRESS`), `'system'` (`DBUS_SYSTEM_BUS_ADDRESS`,
  else `unix:path=/var/run/dbus/system_bus_socket`), a bus address (`unix:path=…`, `tcp:host=…,port=…`), or the socket
  path of a private bus.
- `service`: the well-known name of the service, two or more elements of letters, digits and `_` separated by dots.
  D-Bus also allows `-` in service names, but this name prefixes the error names, which cannot contain it. The adapter
  fails to start when another connection owns the name. `replaceExisting` takes the name over when its owner allows
  it, and `allowReplacement` lets another service take it over: the replaced adapter then keeps running without the
  name, and does not get it back.
- `decode`: how the arguments of method calls and the property values written by clients are decoded (`DecodeOpts`
  of `dbus-sdk`). By default (`{int64: 'number'}`), 64-bit integers arrive as numbers when they are safe integers, else
  as bigints, so that `DTO.Number()` accepts them; `{int64: 'bigint'}` decodes them all as bigints, for `DTO.BigInt()`.
- `name` and `middlewares`: the adapter's name, and the middlewares for its calls (run after the global ones).
- It stops gracefully with the entrypoint: it releases the name, lets the calls in progress finish, then closes the
  connection.

### Objects, properties and signals

The path of an interface is either a fixed path (`/com/example/Manager`) or a template (`/com/example/Devices/{sn}`).
The object at a fixed path is exported when the adapter starts and stays exported while it runs
(`DBusObjectManager.removeObject()` does not remove it). The objects of a template are added and removed with
`DBusObjectManager`. The variables of the path are merged into the input of the methods, like route parameters, and
take precedence over the values sent by the client.

A property is a value of an object, kept by `DBusObjectManager`. The application sets it, and clients read it and are
notified when it changes (`PropertiesChanged`); until it is set, it has its `initial` value. Clients can also write a
`writable` property: the value is validated by the property's `schema` (validation errors are returned to the client),
stored, and `DBusObjectManager` emits `propertyWritten`. A write that must reach a device, or that may fail after
validation, is better made a method, whose errors are returned to the caller. A signal's data is validated by its DTO
when the signal is emitted.

```typescript
import {Component, DTO} from 'lakutata'
import {Controller} from 'lakutata/com/entrypoint'
import {Expect, Return} from 'lakutata/decorator/dto'
import {Inject} from 'lakutata/decorator/di'
import {
    DBusInterface,
    DBusMethod,
    DBusObjectManager,
    defineDBusProperty,
    defineDBusSignal,
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

export const DeviceChanged = defineDBusSignal<StatusDTO>('Changed', StatusDTO)
export const DeviceState = defineDBusProperty<string>('State', 's', {initial: 'idle'})
export const DeviceLevel = defineDBusProperty<number>('Level', 'i', {writable: true, initial: 1, schema: DTO.Number().integer().min(0).max(10)})

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

`DBusObjectManager` is autoloaded, one per application: inject it into any object (`@Inject(DBusObjectManager)`) or get
it with `getObject(DBusObjectManager)`. Objects added before the adapter starts are exported when it starts. The
service's `ObjectManager` tells clients about added and removed objects (`InterfacesAdded`, `InterfacesRemoved`).

### The client

`DBusClientComponent` connects to a bus when it is created; use it to call services, read their objects and
properties, and listen to their signals. It disconnects when the application stops.

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
        dbus.on('nameOwnerChanged', (name: string, oldOwner: string, newOwner: string): void => console.log(name, oldOwner, newOwner))
    })
```

`buildDBusClientOptions(options)` builds the same declaration from typed options:
`dbus: buildDBusClientOptions({busAddress: 'unix:path=/var/run/dbus/system_bus_socket'})`.

## API

| Export | What it is |
|---|---|
| `dbusEntrypoint`, `DBusEntrypointOptions` | The entrypoint's adapter (for its `dbus` option) and its options: `bus`, `service`, `replaceExisting`, `allowReplacement`, `decode`, `name`, `middlewares` |
| `DBusInterface`, `DBusInterfaceOptions` | Class decorator: a controller served as a D-Bus interface at an object path or path template |
| `DBusMethod`, `DBusMethodOptions` | Method decorator: serves an action as a method of the interface; the options include the type of its result (`returns`) |
| `defineDBusSignal`, `DBusSignalDefinition` | Declares a signal, with its DTO or signature |
| `defineDBusProperty`, `DBusPropertyDefinition`, `DBusPropertyOptions` | Declares a property: its signature, `writable`, `initial`, `schema` |
| `DBusInterfaceDeclaration` | The declaration recorded by `@DBusInterface` |
| `DBusObjectManager` | Manages the objects of path templates, property values and signals: `addObject`, `removeObject`, `hasObject`, `objects`, `setPropertyValue`, `getPropertyValue`, `emitSignal`; the `propertyWritten` event |
| `DBusPropertyWrite` | A property write by a client: the argument of `propertyWritten` |
| `DBusContext`, `DBusContextParams`, `DBUS_CONTEXT_TYPE` | The context of method calls: `path`, `interface`, `member` |
| `DBusChannel` | The definition of the `dbus` channel, for custom adapters |
| `DBusClientComponent` | The client: `invoke`, `interface`, `interfaceSignal`, `object`, `service`, `services`, `listNames`, `listBusNames`, `listServices`, `listActivatableNames`, `nameHasOwner`, `getNameOwner`, `addMatch`, `removeMatch`, `uniqueName`; `on`, `once`, `off` and `removeListener` for the connection events (`serviceOnline`, `serviceOffline`, `serviceReplaced`, `methodCall`, `nameOwnerChanged`, `nameLost`, `nameAcquired`, `connectionClose`, `connectionError`) |
| `buildDBusClientOptions`, `DBusClientOptions` | The client's declaration and options: `busAddress`, `timeout`, `callTimeout`, `decode` (`DecodeOpts` of `dbus-sdk`; 64-bit integers are numbers by default) |
| `DBus`, `DBusRemoteInterface`, `DBusObject`, `DBusService`, `LocalService`, `LocalObject`, `LocalInterface`, `DBusSignedValue`, `DBusSignalEmitter`, `Signature`, `createDBusError`, `RequestNameFlags`, `RequestNameResultCode`, `BusNameBasicInfo`, `ConnectOpts`, `DecodeOpts`, `InvokeOpts` | Re-exported from dbus-sdk 2 (`DBusRemoteInterface` is its `DBusInterface`; see its MIGRATION.md for the changes from 1.x) |

The typings document every declaration, with examples.

## Errors

| Error | When |
|---|---|
| `TypeError` | An invalid interface, member or service name, object path, or signature (of a property, a signal or a `returns` option), when it is declared or `dbusEntrypoint()` is called; `DBusObjectManager.addObject()` with a template; the adapter's start, when a `@DBusMethod` belongs to a controller without `@DBusInterface` |
| `Error` (`The DBus name … is owned by another service`) | The adapter's start, when another connection owns the service name; the entrypoint fails to start |
| The errors of dbus-sdk (`UnknownBusAddressError`, a connection error…) | The adapter's start or the client's creation, when the bus cannot be reached; the client's calls, when a method replies with a D-Bus error |
| `InvalidValueException` (from `lakutata`) | `setPropertyValue()` or `emitSignal()` with a value that its schema or DTO rejects; the client's creation, when `busAddress` is missing |
| `InvalidObjectOptionsException` (from `lakutata`) | An option of the client has an invalid value (`timeout`, `decode`…); the application fails to start |

Errors thrown by the actions reach the callers as D-Bus errors named after their `errno`
(`com.example.DeviceService.E_OFFLINE`), with their message. A client that writes an invalid property value also gets
a D-Bus error.

## See also

- `doc/en/DBus.md` in the `lakutata` package (Chinese version in `doc/zh`): the guide to D-Bus.
- `@lakutata/entrypoint` (`lakutata/com/entrypoint`): the entrypoint, controllers, middlewares and access control (see
  `doc/en/Controllers.md`, `Entrypoint.md` and `Middlewares.md` in the `lakutata` package, and their Chinese versions
  in `doc/zh`).
- [dbus-sdk](https://github.com/myq1991/node-dbus-sdk): the D-Bus protocol, its client classes and its local services.
- `@lakutata/core` (`lakutata`): components, `Application` and dependency injection.
