# Lakutata D-Bus

D-Bus 是 Linux 桌面和系统服务使用的消息总线：同一台机器上的程序通过它调用彼此的方法、读取彼此的属性、监听彼此的信号。`@lakutata/dbus` 包把控制器方法作为 D-Bus 服务的方法提供出来，对外暴露对象、属性和信号，也可以作为客户端调用其他服务。它不属于 `lakutata`：

```bash
npm install lakutata @lakutata/dbus
```

它需要一个 D-Bus 守护进程：Linux 机器上的会话总线或系统总线，或者用 `dbus-daemon` 启动的私有总线（用于测试；在 macOS 上可以使用 Homebrew 的 `dbus` 包）。

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

- `@DBusInterface(name, {path})` 让控制器成为一个接口，在某个对象路径上提供。路径相同的多个控制器，是同一个对象的多个接口。
- `@DBusMethod(name, DTO?, options?)` 让控制器的方法成为接口的方法。它的选项是所有动作共有的选项，外加结果的类型 `returns`（第 3 节）。
- 每个对象还实现了 `org.freedesktop.DBus.Properties`、`Introspectable` 和 `Peer`；根对象 `/` 实现了 `ObjectManager`。
- 在使用 systemd 的机器上，`busctl --user call com.example.DeviceService /com/example/Manager com.example.Manager Ping` 与第一条 `gdbus` 命令的作用相同。

## 2. 适配器

| 选项 | 默认值 | 含义 |
|---|---|---|
| `service` | 必填 | 服务的公认名称：由字母、数字和 `_` 组成的若干段，以点分隔 |
| `bus` | `'session'` | `'session'`（`DBUS_SESSION_BUS_ADDRESS` 中的地址）、`'system'`、一个地址（`'unix:path=…'`、`'tcp:host=…,port=…'`），或者私有总线的套接字路径 |
| `replaceExisting` | `false` | 在名称的持有者允许时，从它那里接管名称 |
| `allowReplacement` | `false` | 允许其他服务接管名称 |
| `decode` | `{int64: 'number'}` | 参数如何解码（第 3 节） |
| `name`、`middlewares` | | 适配器的名字，以及它的调用使用的中间件，在入口的中间件之后执行 |

- 应用启动时，适配器连接总线并获取名称。连不上总线（对于 `'session'`，没有设置 `DBUS_SESSION_BUS_ADDRESS` 也一样），或者名称已被其他连接持有，都会让启动失败。
- D-Bus 允许服务名称中有 `-`，但这个适配器不允许：服务名称是错误名称的前缀，而错误名称中不能有 `-`。
- 在系统总线上，需要 `/etc/dbus-1/system.d/` 中的策略文件允许进程持有这个名称。
- 设置 `allowReplacement` 时，用 `replaceExisting` 接管名称的服务从此收到所有调用。被替换的应用仍在运行，但没有名称，在另一个服务停止后也拿不回名称。
- 应用停止时，适配器先释放名称（新的调用以 `org.freedesktop.DBus.Error.ServiceUnknown` 失败），等正在处理的调用结束，再断开连接。

## 3. 参数与结果

**输入。** 带 DTO 的方法接受一个参数：一个变体字典（`a{sv}`），包含 DTO 的各个属性；没有 DTO 的方法不接受参数。输入与其他传输方式一样，经过中间件、校验和访问控制。变体可以是任何类型，所以字符串字典（`a{ss}`）也能被接受。

| D-Bus 类型 | JavaScript 值 |
|---|---|
| `s`、`o` | 字符串 |
| `y`、`n`、`i`、`u`、`d` | 数字 |
| `x`、`t`（64 位） | 安全整数时为数字，否则为 bigint |
| `b` | 布尔值 |
| `as`、`ai`…… | 数组 |
| `a{…}` | 对象 |
| `(…)` | 数组 |

64 位整数解码为数字，这样 `DTO.Number()` 才能接受它们；`decode: {int64: 'bigint'}` 把它们保留为 bigint，供 `DTO.BigInt()` 使用。

**结果**的类型是 `returns` 选项：`'s'` 这样的签名，或者一个 DTO（以 `a{sv}` 发送）。没有 `returns` 时，类型取自 `@Return` 的校验规则：

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

- 既没有 `returns` 也没有 `@Return` 时，方法没有结果。
- 日期以 ISO 字符串发送，对象和数组中的 `null` 和 `undefined` 会被去掉：变体没有 null。结果为 `a{sv}` 的方法什么都不返回时，发送 `{}`。
- 结果为单个类型（`'s'`、`'i'`……）的方法必须返回一个值：返回 `undefined` 会让调用失败。
- `Map`、`Buffer` 以及 `dbus-sdk` 的带类型的值（`new DBusUInt32(7)`）按原样发送。

## 4. 对象、属性与信号

接口的路径可以是一个具体路径（`/com/example/Manager`），它的对象在适配器启动时导出；也可以是一个模板（`/com/example/Devices/{sn}`），由应用通过 `DBusObjectManager` 添加和移除它的对象。路径中的变量会合并到方法的输入中，覆盖客户端发送的值。

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

- `DBusObjectManager` 是每个应用都有的组件：不需要声明，直接注入（`@Inject(DBusObjectManager)`）即可。在适配器启动之前添加的对象，会在它启动时导出。客户端通过根对象的 `InterfacesAdded` 和 `InterfacesRemoved` 信号得知对象的添加和移除。
- 属性为每个对象保存一个值，在设置之前是它的 `initial` 值。`setPropertyValue()` 用属性的 `schema` 校验值，并告诉客户端值已变化（`PropertiesChanged`）。
- 客户端可以写入 `writable` 属性：值经过校验（错误交给客户端）后保存，并发出 `propertyWritten`。需要传到设备上、或者校验通过后仍可能失败的写入，更适合做成方法，这样错误能交给调用方。
- `emitSignal()` 用信号的 DTO 校验数据，并返回这个路径上是否有对象发送了它。
- 属性和信号的签名在定义时就会检查。

## 5. 错误

方法抛出的错误，包括校验和访问控制的错误，会作为 D-Bus 错误连同消息一起交给调用方：

| 抛出的错误 | D-Bus 错误名称 |
|---|---|
| 带 `errno` 的异常（`E_OFFLINE`） | `com.example.DeviceService.E_OFFLINE` |
| 含有点的 `errno`（`org.example.Device.Offline`） | `org.example.Device.Offline` |
| 不以字母开头的 `errno`（`500`、`_HIDDEN`） | `com.example.DeviceService.E500`、`….E_HIDDEN` |
| 没有 `errno` 的错误（`Error`、`TypeError`） | `com.example.DeviceService.Error`、`….TypeError` |

其他情况在到达任何动作之前就被响应：对象不存在时为 `org.freedesktop.DBus.Error.UnknownObject`，方法不存在时为 `UnknownMethod`，参数类型不对时为 `InvalidArgs`；没有应用持有这个名称时，总线以 `ServiceUnknown` 响应。

## 6. 上下文与访问控制

在 D-Bus 方法中，`this.context` 是一个 `DBusContext`：它的 `type` 是 `'DBUS'`（`DBUS_CONTEXT_TYPE`），`path` 是被调用对象的路径，`interface` 和 `member` 指明方法，`data` 是收到的字典，未经校验。

入口的访问规则适用于以 `acl: true` 声明的方法，前提是规则的 `supportContextTypes()` 包含 `DBUS_CONTEXT_TYPE`（见 [Middlewares](Middlewares.md)）。上下文不提供调用方的身份：访问规则无法检查调用方，这是系统总线上的总线策略要做的事。

## 7. 客户端

`DBusClientComponent` 在创建时连接总线，用来调用服务、读取它们的属性、监听它们的信号：

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
| `timeout` | 20 秒 | 连接最多可以用多长时间，单位毫秒 |
| `callTimeout` | 无 | 调用最多等待回复多长时间，单位毫秒；单次调用可以给出自己的 `timeout` |
| `decode` | `{int64: 'number'}` | 回复和信号如何解码 |

- `invoke()` 得到输出参数组成的数组；接口的方法（`device.method.Status()`）直接得到值本身。
- 调用失败时，得到一个 `Error`，它的 `name` 是 D-Bus 错误名称（`com.example.DeviceService.E_OFFLINE`），没有 `errno`。
- 应用停止时，组件断开连接。
