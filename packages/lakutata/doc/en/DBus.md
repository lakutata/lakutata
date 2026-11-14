# Lakutata D-Bus

D-Bus is the message bus of Linux desktops and system services: through it, a machine's programs call each other's
methods, read each other's properties and listen to each other's signals. The `@lakutata/dbus` package serves
controller methods as D-Bus service methods, exposes objects, properties and signals, and calls other services as a
client. It is not part of `lakutata`:

```bash
npm install lakutata @lakutata/dbus
```

It needs a D-Bus daemon: a Linux machine's session bus or system bus, or a private bus started with `dbus-daemon` (for
tests, and on macOS with Homebrew's `dbus` package).

## 1. A service

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

```text
$ gdbus call --session --dest com.example.DeviceService --object-path /com/example/Manager --method com.example.Manager.Ping
('pong',)
$ gdbus call --session --dest com.example.DeviceService --object-path /com/example/Manager --method com.example.Manager.Configure "{'sn': <'A1'>, 'retries': <3>}"
({'sn': <'A1'>, 'retries': <3>},)
```

- `@DBusInterface(name, {path})` makes a controller an interface, served at an object path. Several controllers with
  the same path are interfaces of the same object.
- `@DBusMethod(name, DTO?, options?)` makes a controller method an interface method. Its options are those of every
  action, and `returns`, the type of its result (section 3).
- Every object also implements `org.freedesktop.DBus.Properties`, `Introspectable` and `Peer`; the root object `/`
  implements `ObjectManager`.
- On a machine with systemd, `busctl --user call com.example.DeviceService /com/example/Manager com.example.Manager
  Ping` does the same as the first `gdbus` command.

## 2. The adapter

| Option | Default | Meaning |
|---|---|---|
| `service` | required | The service's well-known name: elements of letters, digits and `_`, separated by dots |
| `bus` | `'session'` | `'session'` (the address in `DBUS_SESSION_BUS_ADDRESS`), `'system'`, an address (`'unix:path=…'`, `'tcp:host=…,port=…'`), or the socket path of a private bus |
| `replaceExisting` | `false` | Take the name from its owner, when the owner allows it |
| `allowReplacement` | `false` | Let another service take the name |
| `decode` | `{int64: 'number'}` | How arguments are decoded (section 3) |
| `name`, `middlewares` | | The adapter's name, and the middlewares for its calls, which run after the entrypoint's |

- The adapter connects and takes the name when the application launches. The launch fails when the bus cannot be
  reached (for `'session'`, also when `DBUS_SESSION_BUS_ADDRESS` is not set) or when another connection owns the name.
- D-Bus allows `-` in service names, but this adapter does not: the service name prefixes error names, which may not
  contain it.
- On the system bus, a policy file in `/etc/dbus-1/system.d/` must allow the process to own the name.
- With `allowReplacement`, a service that takes the name with `replaceExisting` receives calls from then on. The
  replaced application keeps running without the name, and does not regain it when the other one stops.
- When the application stops, the adapter releases the name (new calls fail with
  `org.freedesktop.DBus.Error.ServiceUnknown`), lets calls in progress finish, then disconnects.

## 3. Arguments and results

**The input.** A method with a DTO takes one argument, a dictionary of variants (`a{sv}`) holding the DTO's properties;
a method without a DTO takes no argument. The input goes through middlewares, validation and access control, as on
other transports. A variant accepts any type, so a dictionary of strings (`a{ss}`) is also accepted.

| D-Bus type | JavaScript value |
|---|---|
| `s`, `o` | A string |
| `y`, `n`, `i`, `u`, `d` | A number |
| `x`, `t` (64 bits) | A number when it is a safe integer, otherwise a bigint |
| `b` | A boolean |
| `as`, `ai`… | An array |
| `a{…}` | An object |
| `(…)` | An array |

64-bit integers are decoded as numbers so that `DTO.Number()` accepts them; `decode: {int64: 'bigint'}` keeps them as
bigints, for `DTO.BigInt()`.

**The result** has the type of the `returns` option: a signature such as `'s'`, or a DTO, sent as `a{sv}`. Without
`returns`, it has the type of the `@Return` schema:

| `@Return` schema | D-Bus type |
|---|---|
| An object, a DTO | `a{sv}` |
| A string | `s` |
| A boolean | `b` |
| An integer (`.integer()`) | `x` |
| Another number | `d` |
| A bigint | `x` |
| An array | `av` |
| Anything else | `v` |

- Without `returns` and `@Return`, the method has no result.
- Dates are sent as ISO strings, and `null` and `undefined` values are left out of objects and arrays: a variant has
  no null. A method whose result is `a{sv}` and that returns nothing sends `{}`.
- A method whose result is a single type (`'s'`, `'i'`…) must return a value: the call fails when it returns
  `undefined`.
- `Map`s, `Buffer`s and `dbus-sdk` typed values (`new DBusUInt32(7)`) are sent unchanged.

## 4. Objects, properties and signals

An interface's path is either a path (`/com/example/Manager`), whose object is exported when the adapter starts, or a
template (`/com/example/Devices/{sn}`), whose objects the application adds and removes with `DBusObjectManager`. The
path's variables are merged into the methods' input, over the values the client sends.

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

//Declared in the components of the application
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
        this.manager.addObject(path)
        this.manager.setPropertyValue(path, DeviceState, 'running')
        this.manager.emitSignal(path, DeviceChanged, {sn: sn, online: true} as StatusDTO)
    }

    public unplug(sn: string): void {
        this.manager.removeObject(`/com/example/Devices/${sn}`)
    }
}
```

- Every application has a `DBusObjectManager` component: inject it (`@Inject(DBusObjectManager)`) without declaring
  it. Objects added before the adapter starts are exported when it starts. Clients learn of added and removed objects
  through the root object's `InterfacesAdded` and `InterfacesRemoved` signals.
- A property keeps one value per object, its `initial` value until it is set. `setPropertyValue()` validates the value
  with the property's `schema`, and notifies clients of the change (`PropertiesChanged`).
- A client may write a `writable` property: the value is validated (the client receives the error), stored, and
  `propertyWritten` is emitted. A write that must reach a device, or that may fail after its validation, is better
  implemented as a method, whose errors reach the caller.
- `emitSignal()` validates the data with the signal's DTO, and returns whether an object at that path sends it.
- Property and signal signatures are checked when they are defined.

## 5. Errors

An error thrown by a method, including its validation and its access control, reaches the caller as a D-Bus error, with
its message:

| Error thrown | D-Bus error name |
|---|---|
| An exception with an `errno` (`E_OFFLINE`) | `com.example.DeviceService.E_OFFLINE` |
| An `errno` that holds dots (`org.example.Device.Offline`) | `org.example.Device.Offline` |
| An `errno` that does not start with a letter (`500`, `_HIDDEN`) | `com.example.DeviceService.E500`, `….E_HIDDEN` |
| An error without `errno` (`Error`, `TypeError`) | `com.example.DeviceService.Error`, `….TypeError` |

The adapter responds to other cases before any action runs: `org.freedesktop.DBus.Error.UnknownObject` for an object
that does not exist, `UnknownMethod` for a method that does not exist, `InvalidArgs` for arguments of the wrong type;
the bus responds with `ServiceUnknown` when no application owns the name.

## 6. The context and the access control

In a D-Bus method, `this.context` is a `DBusContext`: its `type` is `'DBUS'` (`DBUS_CONTEXT_TYPE`), `path` is the called
object's path, `interface` and `member` name the method, and `data` holds the received dictionary, before validation.

The entrypoint's access rules apply to methods declared with `acl: true` when their `supportContextTypes()` include
`DBUS_CONTEXT_TYPE` (see [Middlewares and Access Control](Middlewares.md)). The context does not identify the caller, so
a rule cannot check it; on the system bus, that is the job of the bus policy.

## 7. The client

`DBusClientComponent` connects to a bus when it is created, to call services, read their properties and listen to
their signals:

```typescript
import {Application} from 'lakutata'
import {DBusClientComponent, type DBusRemoteInterface} from '@lakutata/dbus'

Application
    .run(() => ({
        id: 'client.app',
        name: 'Client',
        components: {
            dbus: {class: DBusClientComponent, busAddress: process.env.DBUS_SESSION_BUS_ADDRESS!, callTimeout: 5000}
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const dbus: DBusClientComponent = await app.getObject('dbus')
        //A call with its signature: the output arguments, as an array
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
    })
```

| Option | Default | Meaning |
|---|---|---|
| `busAddress` | required | The bus address (`'unix:path=/var/run/dbus/system_bus_socket'`), not `'session'` or a path |
| `timeout` | 20 seconds | How long the connection may take, in milliseconds |
| `callTimeout` | none | How long a call may wait for its reply, in milliseconds; a call can specify its own `timeout` |
| `decode` | `{int64: 'number'}` | How replies and signals are decoded |

- `invoke()` resolves with an array of the output arguments; an interface's methods (`device.method.Status()`) resolve
  with the value itself.
- A call that fails rejects with an `Error` whose `name` is the D-Bus error name
  (`com.example.DeviceService.E_OFFLINE`); it has no `errno`.
- The component disconnects when the application stops.
