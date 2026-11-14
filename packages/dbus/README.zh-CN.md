# @lakutata/dbus

[English](README.md) | 中文

[Lakutata](https://github.com/lakutata/lakutata) 框架的 D-Bus 传输方式。应用在一条总线（系统总线、会话总线或私有总线）上持有一个服务名称，将控制器作为 D-Bus 对象的接口提供，包括方法、属性和信号。本包还提供一个 D-Bus 客户端组件，用于调用总线上的其他服务、读取这些服务的属性并监听其信号。协议由 [dbus-sdk](https://github.com/myq1991/node-dbus-sdk) 实现，本包也重新导出了 dbus-sdk 的类。`lakutata` 包不重新导出本包，请从 `@lakutata/dbus` 导入。

## 安装

```shell
npm install lakutata @lakutata/dbus
```

- 需要一个 D-Bus 守护进程，Linux 上通常都已具备：系统总线（`/var/run/dbus/system_bus_socket`）、桌面会话的会话总线（`DBUS_SESSION_BUS_ADDRESS`），或者私有的 `dbus-daemon`。若要在系统总线上持有名称，需要总线策略允许（`/etc/dbus-1/system.d/` 中的一个文件）。
- 需要 Node.js `>=18.10.0`。本包的 peer 依赖 `@lakutata/core` 和 `@lakutata/entrypoint` 会随 `lakutata` 一起安装。

## 用法

### 一个 D-Bus 服务

`dbusEntrypoint` 是入口的 `dbus` 适配器。以 `@DBusInterface` 声明的控制器在一个对象路径上提供一个接口，该控制器的 `@DBusMethod` 动作即为该接口的方法。

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
    //没有参数，返回一个字符串（s）
    @DBusMethod('Ping', {returns: 's'})
    public async ping(): Promise<string> {
        return 'pong'
    }

    //一个 a{sv} 参数，返回一个 a{sv} 字典（@Return 的类型）
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

- **输入**：带 DTO 的方法接受一个参数，即包含 DTO 各个属性的变体字典（`a{sv}`）；没有 DTO 的方法不接受参数。与其他传输方式一样，输入会经过入口的中间件、校验和访问控制。
- **结果**：类型由 `returns` 选项指定（一个 DTO，以 `a{sv}` 发送；或者 `'s'` 这样的签名），未设置该选项时取自 `@Return` 的校验规则：对象对应 `a{sv}`，字符串对应 `s`，布尔值对应 `b`，整数和 bigint 对应 `x`，其他数字对应 `d`，数组对应 `av`，其他值对应变体 `v`。两者都没有时，方法没有结果。日期以 ISO 字符串发送，对象和数组中值为 `null` 和 `undefined` 的项会被去掉（变体不能为 null）。结果为单个类型（`'s'`、`'i'`……）的方法必须返回一个值，返回 `undefined` 会导致调用失败。
- **错误**作为 D-Bus 错误连同消息一起返回给调用方，错误名称为服务名称加上错误的 `errno`（`com.example.DeviceService.E_OFFLINE`）。`errno` 中不以字母开头的段会加上前缀 `E`（`500` 变为 `E500`，`_HIDDEN` 变为 `E_HIDDEN`）。
- **上下文**：方法的上下文是 `DBusContext`，带有 `context.path`、`context.interface` 和 `context.member`。
- **路径相同的多个控制器**是同一个对象的多个接口。每个对象还实现了 `org.freedesktop.DBus.Properties`、`Introspectable` 和 `Peer`；根对象 `/` 实现了 `ObjectManager`。
- 方法还可以同时带有其他传输方式的装饰器（`@ServiceAction`、`@GET`……）。

### 适配器

```text
dbus: dbusEntrypoint({bus: 'system', service: 'com.example.DeviceService', replaceExisting: true})
```

- `bus`：`'session'`（默认值，使用 `DBUS_SESSION_BUS_ADDRESS` 中的地址）、`'system'`（`DBUS_SYSTEM_BUS_ADDRESS`，未设置时为 `unix:path=/var/run/dbus/system_bus_socket`）、一个总线地址（`unix:path=…`、`tcp:host=…,port=…`），或者私有总线的套接字路径。
- `service`：服务的公认名称，由两段或更多段组成，各段由字母、数字和 `_` 构成，以点分隔。D-Bus 也允许服务名称中包含 `-`，但该名称会作为错误名称的前缀，而错误名称中不能包含该字符。名称已被其他连接持有时，适配器启动失败。设置 `replaceExisting` 时，如果名称的持有者允许，适配器即接管名称；设置 `allowReplacement` 时，允许其他服务接管名称，此后被替换的适配器会继续运行，但不再持有名称，也无法取回。
- `decode`：方法调用的参数和客户端写入的属性值的解码方式（`dbus-sdk` 的 `DecodeOpts`）。使用默认值（`{int64: 'number'}`）时，64 位整数如果是安全整数则解码为数字，否则解码为 bigint，以便 `DTO.Number()` 接受这些值；`{int64: 'bigint'}` 将其全部解码为 bigint，供 `DTO.BigInt()` 使用。
- `name` 和 `middlewares`：适配器的名称，以及适配器处理调用时使用的中间件（在全局中间件之后执行）。
- 适配器随入口一起平稳停止：先释放名称，等待正在处理的调用结束，再关闭连接。

### 对象、属性与信号

接口的路径可以是一个具体路径（`/com/example/Manager`），也可以是一个模板（`/com/example/Devices/{sn}`）。具体路径上的对象在适配器启动时导出，并在适配器运行期间始终保持导出（`DBusObjectManager.removeObject()` 不会移除该对象）。模板的对象通过 `DBusObjectManager` 添加和移除。与路由参数一样，路径中的变量会合并到方法的输入中，并覆盖客户端发送的值。

属性是对象的一个值，由 `DBusObjectManager` 保存。应用设置属性，客户端读取属性，并在属性变化时收到通知（`PropertiesChanged`）；在设置之前，属性的值为 `initial`。客户端也可以写入 `writable` 属性：值先经过属性的 `schema` 校验（校验错误返回给客户端），然后保存，并由 `DBusObjectManager` 发出 `propertyWritten` 事件。如果写入需要传递到设备，或者在校验通过后仍可能失败，更适合实现为方法，这样错误能够返回给调用方。发出信号时，信号的数据由其 DTO 校验。

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
    //输入中的 sn 取自对象路径
    @DBusMethod('Status', DeviceSnDTO)
    @Return(StatusDTO)
    public async status(input: DeviceSnDTO): Promise<StatusDTO> {
        return {sn: input.sn, online: true} as StatusDTO
    }
}

//在应用的 components 中声明
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
        //路径模板与它匹配的各个接口会导出这个对象
        this.manager.addObject(path)
        this.manager.setPropertyValue(path, DeviceState, 'running')
        this.manager.emitSignal(path, DeviceChanged, {sn: sn, online: true} as StatusDTO)
    }

    public unplug(sn: string): void {
        this.manager.removeObject(`/com/example/Devices/${sn}`)
    }
}
```

`DBusObjectManager` 会自动注册，每个应用一个，可以注入到任何对象中（`@Inject(DBusObjectManager)`），也可以通过 `getObject(DBusObjectManager)` 获取。在适配器启动之前添加的对象，会在适配器启动时导出。服务的 `ObjectManager` 会在对象添加和移除时通知客户端（`InterfacesAdded`、`InterfacesRemoved`）。

### 客户端

`DBusClientComponent` 在创建时连接总线，用于调用服务、读取服务的对象和属性，以及监听服务的信号。应用停止时，该组件断开连接。

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
        //显式给出签名的方法调用：得到输出参数组成的数组
        const [status] = await dbus.invoke({
            service: 'com.example.DeviceService',
            objectPath: '/com/example/Devices/A1',
            interface: 'com.example.Device',
            method: 'Status',
            signature: 'a{sv}',
            args: [{sn: 'A1'}]
        })
        console.log(status)
        //根据对象的内省信息构建的接口
        const device: DBusRemoteInterface = await dbus.interface('com.example.DeviceService', '/com/example/Devices/A1', 'com.example.Device')
        console.log(await device.property.State.get())
        device.signal.on('Changed', (data: unknown): void => console.log(data))
        //连接的事件
        dbus.on('nameOwnerChanged', (name: string, oldOwner: string, newOwner: string): void => console.log(name, oldOwner, newOwner))
    })
```

`buildDBusClientOptions(options)` 以带类型的选项生成相同的声明：`dbus: buildDBusClientOptions({busAddress: 'unix:path=/var/run/dbus/system_bus_socket'})`。

## API

| 导出 | 说明 |
|---|---|
| `dbusEntrypoint`、`DBusEntrypointOptions` | 供入口的 `dbus` 选项使用的适配器，及其选项：`bus`、`service`、`replaceExisting`、`allowReplacement`、`decode`、`name`、`middlewares` |
| `DBusInterface`、`DBusInterfaceOptions` | 类装饰器：将控制器作为 D-Bus 接口，在一个对象路径或路径模板上提供 |
| `DBusMethod`、`DBusMethodOptions` | 方法装饰器：将动作作为接口的方法提供；选项包括结果的类型（`returns`） |
| `defineDBusSignal`、`DBusSignalDefinition` | 声明一个信号，以及信号的 DTO 或签名 |
| `defineDBusProperty`、`DBusPropertyDefinition`、`DBusPropertyOptions` | 声明一个属性：属性的签名、`writable`、`initial`、`schema` |
| `DBusInterfaceDeclaration` | `@DBusInterface` 记录的声明 |
| `DBusObjectManager` | 管理路径模板的对象、属性值和信号：`addObject`、`removeObject`、`hasObject`、`objects`、`setPropertyValue`、`getPropertyValue`、`emitSignal`；`propertyWritten` 事件 |
| `DBusPropertyWrite` | 客户端对属性的一次写入，即 `propertyWritten` 的参数 |
| `DBusContext`、`DBusContextParams`、`DBUS_CONTEXT_TYPE` | 方法调用的上下文：`path`、`interface`、`member` |
| `DBusChannel` | `dbus` 传输方式的定义，供自定义适配器使用 |
| `DBusClientComponent` | 客户端：`invoke`、`interface`、`interfaceSignal`、`object`、`service`、`services`、`listNames`、`listBusNames`、`listServices`、`listActivatableNames`、`nameHasOwner`、`getNameOwner`、`addMatch`、`removeMatch`、`uniqueName`；通过 `on`、`once`、`off` 和 `removeListener` 处理连接的事件（`serviceOnline`、`serviceOffline`、`serviceReplaced`、`methodCall`、`nameOwnerChanged`、`nameLost`、`nameAcquired`、`connectionClose`、`connectionError`） |
| `buildDBusClientOptions`、`DBusClientOptions` | 客户端的声明及其选项：`busAddress`、`timeout`、`callTimeout`、`decode`（`dbus-sdk` 的 `DecodeOpts`；64 位整数默认解码为数字） |
| `DBus`、`DBusRemoteInterface`、`DBusObject`、`DBusService`、`LocalService`、`LocalObject`、`LocalInterface`、`DBusSignedValue`、`DBusSignalEmitter`、`Signature`、`createDBusError`、`RequestNameFlags`、`RequestNameResultCode`、`BusNameBasicInfo`、`ConnectOpts`、`DecodeOpts`、`InvokeOpts` | 从 dbus-sdk 2 重新导出（`DBusRemoteInterface` 即 dbus-sdk 的 `DBusInterface`；相对 1.x 的变化见 dbus-sdk 的 MIGRATION.md） |

类型声明中的每一项都附有说明和示例。

## 错误

| 错误 | 抛出时机 |
|---|---|
| `TypeError` | 声明时或调用 `dbusEntrypoint()` 时，接口名、成员名、服务名称、对象路径或签名（属性、信号或 `returns` 选项的签名）不合法；使用模板调用 `DBusObjectManager.addObject()`；适配器启动时，某个 `@DBusMethod` 所在的控制器没有 `@DBusInterface` |
| `Error`（`The DBus name … is owned by another service`） | 适配器启动时，服务名称已被其他连接持有；入口启动失败（入口列在 `bootstrap` 中时，应用随之启动失败） |
| dbus-sdk 的错误（`UnknownBusAddressError`、连接错误……） | 适配器启动或客户端创建时无法连接总线；客户端调用的方法以 D-Bus 错误回复 |
| `InvalidValueException`（来自 `lakutata`） | `setPropertyValue()` 或 `emitSignal()` 的值被校验规则或 DTO 拒绝；客户端创建时缺少 `busAddress` |
| `InvalidObjectOptionsException`（来自 `lakutata`） | 客户端某个选项的值无效（`timeout`、`decode`……）；应用启动失败 |

动作抛出的错误作为 D-Bus 错误连同消息一起返回给调用方，错误名称取自错误的 `errno`（`com.example.DeviceService.E_OFFLINE`）。客户端写入不合法的属性值时，也会收到 D-Bus 错误。

## 另见

- 网站上的指南：[D-Bus](https://lakutata.com/zh/guide/DBus)。
- `lakutata` 包中的 `doc/zh/DBus.md`：D-Bus 指南。
- `@lakutata/entrypoint`（`lakutata/com/entrypoint`）：入口、控制器、中间件和访问控制（见 `lakutata` 包中的 `doc/zh/Controllers.md`、`Entrypoint.md` 和 `Middlewares.md`）。
- [dbus-sdk](https://github.com/myq1991/node-dbus-sdk)：D-Bus 协议的实现，以及该库的客户端类和本地服务。
- `@lakutata/core`（`lakutata`）：组件、`Application` 和依赖注入。
