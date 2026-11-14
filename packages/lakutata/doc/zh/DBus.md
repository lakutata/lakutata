# Lakutata D-Bus

D-Bus 是 Linux 桌面和系统服务所使用的消息总线，同一台机器上的程序通过它调用彼此的方法、读取彼此的属性、监听彼此的信号。`@lakutata/dbus` 包将控制器方法作为 D-Bus 服务的方法提供，对外暴露对象、属性和信号，也可以作为客户端调用其他服务。该包不属于 `lakutata`，需要单独安装：

```bash
npm install lakutata @lakutata/dbus
```

该包需要一个 D-Bus 守护进程，可以是 Linux 机器上的会话总线或系统总线，也可以是通过 `dbus-daemon` 启动的私有总线（用于测试；在 macOS 上可以使用 Homebrew 的 `dbus` 包）。

## 1. 一个服务

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

- `@DBusInterface(name, {path})` 使控制器成为一个接口，在指定的对象路径上提供。路径相同的多个控制器是同一个对象的多个接口。
- `@DBusMethod(name, DTO?, options?)` 使控制器的方法成为接口的方法。其选项为所有动作共有的选项，外加结果的类型 `returns`（第 3 节）。
- 每个对象还实现了 `org.freedesktop.DBus.Properties`、`Introspectable` 和 `Peer`；根对象 `/` 实现了 `ObjectManager`。
- 在使用 systemd 的机器上，`busctl --user call com.example.DeviceService /com/example/Manager com.example.Manager Ping` 与第一条 `gdbus` 命令的作用相同。

## 2. 适配器

| 选项 | 默认值 | 含义 |
|---|---|---|
| `service` | 必填 | 服务的公认名称：由字母、数字和 `_` 组成的若干段，以点分隔 |
| `bus` | `'session'` | `'session'`（`DBUS_SESSION_BUS_ADDRESS` 中的地址）、`'system'`、一个地址（`'unix:path=…'`、`'tcp:host=…,port=…'`），或者私有总线的套接字路径 |
| `replaceExisting` | `false` | 在名称的当前持有者允许时，从其手中接管名称 |
| `allowReplacement` | `false` | 允许其他服务接管名称 |
| `decode` | `{int64: 'number'}` | 参数的解码方式（第 3 节） |
| `name`、`middlewares` | | 适配器的名称，以及该适配器的调用所使用的中间件（在入口的中间件之后执行） |

- 应用启动时，适配器连接总线并获取名称。如果无法连接总线（对于 `'session'`，未设置 `DBUS_SESSION_BUS_ADDRESS` 时同样如此），或名称已被其他连接持有，应用将启动失败。
- D-Bus 允许服务名称中包含 `-`，但该适配器不允许，因为服务名称会用作错误名称的前缀，而错误名称中不能包含 `-`。
- 在系统总线上，需要 `/etc/dbus-1/system.d/` 中的策略文件允许进程持有该名称。
- 设置 `allowReplacement` 后，通过 `replaceExisting` 接管名称的服务从此接收所有调用。被替换的应用仍在运行，但不再持有名称，并且在另一个服务停止后也无法重新取得名称。
- 应用停止时，适配器先释放名称（新的调用以 `org.freedesktop.DBus.Error.ServiceUnknown` 失败），待正在处理的调用结束后再断开连接。

## 3. 参数与结果

**输入。** 带 DTO 的方法接受一个参数，即包含 DTO 各个属性的变体字典（`a{sv}`）；没有 DTO 的方法不接受参数。与其他传输方式相同，输入会经过中间件、校验和访问控制。变体可以是任何类型，因此字符串字典（`a{ss}`）同样可以被接受。

| D-Bus 类型 | JavaScript 值 |
|---|---|
| `s`、`o` | 字符串 |
| `y`、`n`、`i`、`u`、`d` | 数字 |
| `x`、`t`（64 位） | 安全整数时为数字，否则为 bigint |
| `b` | 布尔值 |
| `as`、`ai`…… | 数组 |
| `a{…}` | 对象 |
| `(…)` | 数组 |

64 位整数解码为数字，以便 `DTO.Number()` 接受这些值；`decode: {int64: 'bigint'}` 将其保留为 bigint，供 `DTO.BigInt()` 使用。

**结果**的类型由 `returns` 选项指定，可以是 `'s'` 这样的签名，也可以是一个 DTO（以 `a{sv}` 发送）。未指定 `returns` 时，类型取自 `@Return` 的校验规则：

| `@Return` 的校验规则 | D-Bus 类型 |
|---|---|
| 对象、DTO | `a{sv}` |
| 字符串 | `s` |
| 布尔值 | `b` |
| 整数（`.integer()`） | `x` |
| 其他数字 | `d` |
| bigint | `x` |
| 数组 | `av` |
| 其他 | `v` |

- 既未指定 `returns` 也未使用 `@Return` 时，方法没有结果。
- 日期以 ISO 字符串发送；对象和数组中的 `null` 和 `undefined` 会被移除，因为变体没有 null。结果为 `a{sv}` 的方法未返回任何值时，发送 `{}`。
- 结果为单个类型（`'s'`、`'i'`……）的方法必须返回一个值，返回 `undefined` 会导致调用失败。
- `Map`、`Buffer` 以及 `dbus-sdk` 的带类型值（`new DBusUInt32(7)`）按原样发送。

## 4. 对象、属性与信号

接口的路径可以是一个具体路径（`/com/example/Manager`），其对象在适配器启动时导出；也可以是一个模板（`/com/example/Devices/{sn}`），其对象由应用通过 `DBusObjectManager` 添加和移除。路径中的变量会合并到方法的输入中，并覆盖客户端发送的值。

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
        this.manager.addObject(path)
        this.manager.setPropertyValue(path, DeviceState, 'running')
        this.manager.emitSignal(path, DeviceChanged, {sn: sn, online: true} as StatusDTO)
    }

    public unplug(sn: string): void {
        this.manager.removeObject(`/com/example/Devices/${sn}`)
    }
}
```

- `DBusObjectManager` 是每个应用都具备的组件，无需声明，直接注入（`@Inject(DBusObjectManager)`）即可。在适配器启动之前添加的对象，会在适配器启动时导出。客户端通过根对象的 `InterfacesAdded` 和 `InterfacesRemoved` 信号获知对象的添加和移除。
- 属性为每个对象保存一个值，在设置之前为其 `initial` 值。`setPropertyValue()` 使用属性的 `schema` 校验值，并通知客户端值已变化（`PropertiesChanged`）。
- 客户端可以写入 `writable` 属性，值经过校验（错误返回给客户端）后保存，并发出 `propertyWritten`。如果写入需要传递到设备，或者在校验通过后仍可能失败，更适合实现为方法，这样错误能够返回给调用方。
- `emitSignal()` 使用信号的 DTO 校验数据，并返回该路径上是否有对象发送了此信号。
- 属性和信号的签名在定义时就会检查。

## 5. 错误

方法抛出的错误（包括校验和访问控制产生的错误）会作为 D-Bus 错误，连同错误消息一起返回给调用方：

| 抛出的错误 | D-Bus 错误名称 |
|---|---|
| 带 `errno` 的异常（`E_OFFLINE`） | `com.example.DeviceService.E_OFFLINE` |
| 包含点号的 `errno`（`org.example.Device.Offline`） | `org.example.Device.Offline` |
| 不以字母开头的 `errno`（`500`、`_HIDDEN`） | `com.example.DeviceService.E500`、`….E_HIDDEN` |
| 没有 `errno` 的错误（`Error`、`TypeError`） | `com.example.DeviceService.Error`、`….TypeError` |

其他情况由适配器在任何动作运行之前响应：对象不存在时为 `org.freedesktop.DBus.Error.UnknownObject`，方法不存在时为 `UnknownMethod`，参数类型错误时为 `InvalidArgs`。没有应用持有该名称时，由总线以 `ServiceUnknown` 响应。

## 6. 上下文与访问控制

在 D-Bus 方法中，`this.context` 是一个 `DBusContext`：其 `type` 为 `'DBUS'`（`DBUS_CONTEXT_TYPE`），`path` 为被调用对象的路径，`interface` 和 `member` 指明所调用的方法，`data` 为收到的字典（未经校验）。

入口的访问规则适用于以 `acl: true` 声明的方法，前提是规则的 `supportContextTypes()` 包含 `DBUS_CONTEXT_TYPE`（见[中间件与访问控制](Middlewares.md)）。上下文不提供调用方的身份，因此访问规则无法检查调用方；在系统总线上，这项工作由总线策略负责。

## 7. 客户端

`DBusClientComponent` 在创建时连接总线，用于调用服务、读取服务的属性和监听服务的信号：

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
        //带签名的调用：输出参数组成的数组
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
    })
```

| 选项 | 默认值 | 含义 |
|---|---|---|
| `busAddress` | 必填 | 总线的地址（`'unix:path=/var/run/dbus/system_bus_socket'`），不能是 `'session'`，也不能是路径 |
| `timeout` | 20 秒 | 建立连接的最长时间，单位为毫秒 |
| `callTimeout` | 无 | 调用等待回复的最长时间，单位为毫秒；单次调用可以指定自身的 `timeout` |
| `decode` | `{int64: 'number'}` | 回复和信号的解码方式 |

- `invoke()` 返回由输出参数组成的数组；接口的方法（`device.method.Status()`）直接返回值本身。
- 调用失败时会得到一个 `Error`，其 `name` 为 D-Bus 错误名称（`com.example.DeviceService.E_OFFLINE`），且没有 `errno`。
- 应用停止时，组件断开连接。
