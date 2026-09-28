# @lakutata/dbus

The DBus channel of the [lakutata](https://github.com/lakutata/lakutata) framework: the controllers are served as the
interfaces of DBus objects (their methods, properties and signals), on the system bus, the session bus or a private
bus. It also has the DBus client component. The protocol is [dbus-sdk](https://github.com/myq1991/node-dbus-sdk).

```bash
npm install @lakutata/dbus
```

## Interfaces

A controller declared with `@DBusInterface` serves a DBus interface at an object path; its `@DBusMethod` actions are the
methods of the interface. The input of a method is its DTO, given as one dictionary of variants (`a{sv}`), and goes
through the middlewares, the validation and the access control of the entrypoint.

```ts
import {DTO} from 'lakutata'
import {Controller} from 'lakutata/com/entrypoint'
import {Return} from 'lakutata/decorator/dto'
import {DBusInterface, DBusMethod, DefineDBusProperty, DefineDBusSignal} from '@lakutata/dbus'

export const DeviceChanged = DefineDBusSignal('Changed', StatusDTO)
export const DeviceState = DefineDBusProperty<string>('State', 's', {initial: 'idle'})
export const DeviceLevel = DefineDBusProperty<number>('Level', 'i', {writable: true, initial: 1, schema: DTO.Number().integer().min(0).max(10)})

@DBusInterface('com.example.Device', {path: '/com/example/Devices/{sn}', signals: [DeviceChanged], properties: [DeviceState, DeviceLevel]})
class DeviceController extends Controller {

    @DBusMethod('Status', DeviceSnDTO)
    @Return(StatusDTO)
    public async status(input: DeviceSnDTO): Promise<StatusDTO> { ... }

    @DBusMethod('Reboot', DeviceSnDTO)
    public async reboot(input: DeviceSnDTO): Promise<void> { ... }
}
```

- **The path** of an interface is a path (`/com/example/Manager`): its object is exported when the adapter starts; or a
  template (`/com/example/Devices/{sn}`): its objects are added and removed with `DBusObjectManager`, and the variables
  of their path are merged into the input of the methods, as the route parameters (they take precedence over it).
- **The result** of a method is described by the schema of its `@Return` (a DTO is a dictionary of variants, a string
  `s`, a boolean `b`, an integer `x`, a number `d`, an array `av`, the other values a variant `v`), or by the `returns`
  option (a DTO or a signature). Without them, the method has no result.
- **The errors** are given to the callers as DBus errors named after their `errno`, prefixed by the name of the service
  (`com.example.DeviceService.E_OFFLINE`), with their message.
- **The interfaces of several controllers** at a same path are the interfaces of the same objects. The objects
  implement `org.freedesktop.DBus.Properties`, `Introspectable`, `Peer`, and the root object `ObjectManager`.

### Properties

A property is a value of an object, kept by the adapter: the application sets it, the clients read it.

- `DBusObjectManager.setPropertyValue(path, property, value)` sets it, the clients are notified (`PropertiesChanged`);
- until it is set, its value is its `initial` value;
- a `writable` property is also written by the clients: the value is validated by the `schema` of the property (the
  errors are given to the client), kept, and `DBusObjectManager` emits `propertyWritten`:

```ts
manager.on('propertyWritten', ({path, interface, property, value}: DBusPropertyWrite) => { ... })
```

A write which must reach a device, or may fail after the validation, is better a method: its errors are given to the
caller.

### Signals

`DBusObjectManager.emitSignal(path, signal, data)` emits a signal of an object; its data is validated by the DTO of the
signal.

## DBusObjectManager

Inject it in any object (`@Inject(DBusObjectManager)`) or get it (`getObject(DBusObjectManager)`): it is autoloaded, one
per application.

```ts
manager.addObject('/com/example/Devices/A1')             //Exported by the interfaces of the matching templates
manager.setPropertyValue('/com/example/Devices/A1', DeviceState, 'running')
manager.emitSignal('/com/example/Devices/A1', DeviceChanged, {sn: 'A1', online: true})
manager.removeObject('/com/example/Devices/A1')
```

The objects added before the adapter starts are exported when it starts. The clients are told of the objects added and
removed by the `ObjectManager` of the service (`InterfacesAdded`, `InterfacesRemoved`).

## DBusEntrypoint

```ts
entrypoint: BuildEntrypoints({
    controllers: [DeviceController],
    dbus: DBusEntrypoint({bus: 'system', service: 'com.example.DeviceService'})
})
```

- `bus`: `'session'` (default), `'system'`, the address of a bus (`unix:path=…`, `tcp:host=…`), or the path of the socket
  of a private bus;
- `service`: the name of the service. The adapter fails to start when the name is owned by another service
  (`replaceExisting` takes it when its owner allows it, `allowReplacement` lets another service take it);
- it stops gracefully with the entrypoint: the name is released, the calls in progress end, then the connection closes.

The context of the methods is a `DBusContext`: `context.path`, `context.interface` and `context.member`.

## The client

`DBusClientComponent` connects to a bus to call the services, read their objects and listen to their signals:

```ts
components: {
    dbus: buildDBusClientOptions({busAddress: 'unix:path=/var/run/dbus/system_bus_socket'})
}
```

## Installation

dbus-sdk builds a native module (`native-machine-id`) with node-gyp when it is installed: a recent node-gyp is needed
with Python 3.12 or later.
