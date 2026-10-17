# Lakutata D-Bus

D-Bus is the message bus of the Linux desktops and system services: the programs of a machine call each other's
methods, read each other's properties and listen to each other's signals through it. The package `@lakutata/dbus`
serves controller methods as the methods of a D-Bus service, exposes objects, properties and signals, and calls the
other services as a client. It is not part of `lakutata`:

```bash
npm install lakutata @lakutata/dbus
```

It needs a D-Bus daemon: the session bus or the system bus of a Linux machine, or a private bus started with
`dbus-daemon` (for the tests, and on macOS with the `dbus` package of Homebrew).

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
  the same path are the interfaces of the same object.
- `@DBusMethod(name, DTO?, options?)` makes a method of the controller a method of the interface. Its options are
  those of every action, and `returns`, the type of its result (section 3).
- Every object also implements `org.freedesktop.DBus.Properties`, `Introspectable` and `Peer`; the root object `/`
  implements `ObjectManager`.
- On a machine with systemd, `busctl --user call com.example.DeviceService /com/example/Manager com.example.Manager
  Ping` does the same as the first `gdbus` command.

## 2. The adapter

| Option | Default | Meaning |
|---|---|---|
| `service` | required | The well-known name of the service: elements of letters, digits and `_`, separated by dots |
| `bus` | `'session'` | `'session'` (the address in `DBUS_SESSION_BUS_ADDRESS`), `'system'`, an address (`'unix:path=…'`, `'tcp:host=…,port=…'`), or the path of the socket of a private bus |
| `replaceExisting` | `false` | Take the name from its owner, when the owner allows it |
| `allowReplacement` | `false` | Let another service take the name |
| `decode` | `{int64: 'number'}` | How the arguments are decoded (section 3) |
| `name`, `middlewares` | | The name of the adapter, and the middlewares of its calls, after those of the entrypoint |

- The adapter connects and takes the name when the application starts. A bus that cannot be reached (for `'session'`,
  also a `DBUS_SESSION_BUS_ADDRESS` not set), or a name owned by another connection, makes the start fail.
- D-Bus allows `-` in the names of the services, but this adapter does not: the name of the service prefixes the names
  of the errors, which may not hold it.
- On the system bus, a policy file in `/etc/dbus-1/system.d/` must allow the process to own the name.
- With `allowReplacement`, a service that takes the name with `replaceExisting` receives the calls from then on. The
  replaced application keeps running without the name, and does not get it back when the other one stops.
- When the application stops, the adapter releases the name (new calls fail with
  `org.freedesktop.DBus.Error.ServiceUnknown`), lets the calls in progress end, then disconnects.

## 3. Arguments and results

**The input.** A method with a DTO takes one argument, a dictionary of variants (`a{sv}`) holding the properties of the
DTO; a method without a DTO takes no argument. The input goes through the middlewares, the validation and the access
control, as on the other transports. A variant accepts any type, so a dictionary of strings (`a{ss}`) is accepted too.

| D-Bus type | JavaScript value |
|---|---|
| `s`, `o` | A string |
| `y`, `n`, `i`, `u`, `d` | A number |
| `x`, `t` (64 bits) | A number when it is a safe integer, else a bigint |
| `b` | A boolean |
| `as`, `ai`… | An array |
| `a{…}` | An object |
| `(…)` | An array |

The 64-bit integers are decoded as numbers so that `DTO.Number()` accepts them; `decode: {int64: 'bigint'}` keeps them
as bigints, for `DTO.BigInt()`.

**The result** has the type of the `returns` option: a signature such as `'s'`, or a DTO, sent as `a{sv}`. Without
`returns`, it has the type of the schema of `@Return`:

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
- The dates are sent as ISO strings, and the `null` and `undefined` values are left out of the objects and arrays: a
  variant has no null. A method that returns `a{sv}` and returns nothing sends `{}`.
- A method whose result is a single type (`'s'`, `'i'`…) must return a value: `undefined` fails the call.
- The `Map`s, the `Buffer`s and the typed values of `dbus-sdk` (`new DBusUInt32(7)`) are sent as they are.

## 4. Objects, properties and signals

The path of an interface is either a path (`/com/example/Manager`), whose object is exported when the adapter starts,
or a template (`/com/example/Devices/{sn}`), whose objects the application adds and removes with `DBusObjectManager`.
The variables of the path are merged into the input of the methods, over the values sent by the client.

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

- `DBusObjectManager` is a component of every application: inject it (`@Inject(DBusObjectManager)`) without declaring
  it. The objects added before the adapter starts are exported when it starts. The clients learn of the objects added
  and removed through the signals `InterfacesAdded` and `InterfacesRemoved` of the root object.
- A property keeps one value per object, its `initial` value until it is set. `setPropertyValue()` validates the value
  with the `schema` of the property, and tells the clients of the change (`PropertiesChanged`).
- A client may write a `writable` property: the value is validated (the error is given to the client), kept, and
  `propertyWritten` is emitted. A write that must reach a device, or that may fail after its validation, is better a
  method, whose errors reach the caller.
- `emitSignal()` validates the data with the DTO of the signal, and returns whether an object at that path sends it.
- The signatures of the properties and of the signals are checked when they are defined.

## 5. Errors

An error thrown by a method, its validation or its access control included, reaches the caller as a D-Bus error, with
its message:

| Error thrown | D-Bus error name |
|---|---|
| An exception with an `errno` (`E_OFFLINE`) | `com.example.DeviceService.E_OFFLINE` |
| An `errno` that holds dots (`org.example.Device.Offline`) | `org.example.Device.Offline` |
| An `errno` that does not start with a letter (`500`, `_HIDDEN`) | `com.example.DeviceService.E500`, `….E_HIDDEN` |
| An error without `errno` (`Error`, `TypeError`) | `com.example.DeviceService.Error`, `….TypeError` |

The other cases are answered before any action runs: `org.freedesktop.DBus.Error.UnknownObject` for an object that does
not exist, `UnknownMethod` for a method that does not exist, `InvalidArgs` for arguments of the wrong type; the bus
answers `ServiceUnknown` when no application owns the name.

## 6. The context and the access control

In a D-Bus method, `this.context` is a `DBusContext`: its `type` is `'DBUS'` (`DBUS_CONTEXT_TYPE`), `path` is the path
of the object called, `interface` and `member` name the method, and `data` holds the dictionary received, before the
validation.

The access rules of the entrypoint apply to the methods declared with `acl: true` when their `supportContextTypes()`
include `DBUS_CONTEXT_TYPE` (see [Middlewares](Middlewares.md)). The context does not tell who calls: a rule cannot
check the caller, which is the job of the bus policy on the system bus.

## 7. The client

`DBusClientComponent` connects to a bus when it is created, to call the services, read their properties and listen to
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
| `busAddress` | required | The address of the bus (`'unix:path=/var/run/dbus/system_bus_socket'`), not `'session'` nor a path |
| `timeout` | 20 seconds | How long the connection may take, in milliseconds |
| `callTimeout` | none | How long a call may wait for its reply, in milliseconds; a call can give its own `timeout` |
| `decode` | `{int64: 'number'}` | How the replies and the signals are decoded |

- `invoke()` resolves with the array of the output arguments; the methods of an interface (`device.method.Status()`)
  resolve with the value itself.
- A call that fails rejects with an `Error` whose `name` is the D-Bus error name
  (`com.example.DeviceService.E_OFFLINE`); it has no `errno`.
- The component disconnects when the application stops.
