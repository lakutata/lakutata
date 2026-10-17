# 设备上的服务

这个示例为小型 Linux 机器（例如树莓派或网关）构建一个服务：它每 10 秒读取一次机器的负载、内存和温度，在内存中保留最近一小时的读数，并通过 HTTP 提供这些读数。它从 `service` 模板及其 `installer` 功能开始，展示定时任务、自己编写的组件及其选项、lakutata 的监控器、用环境变量配置服务，以及把服务安装到机器上、让它随系统启动的安装包。

| 方法 | 路由 | 作用 |
|---|---|---|
| `GET` | `/readings?limit=10` | 取最近的读数，最新的在前 |
| `GET` | `/status` | 取服务的运行时长、读数条数，以及服务自身的 CPU 和内存占用 |
| `GET` | `/health` | 检查进程是否在响应（模板自带） |

## 1. 创建项目

```bash
npx @lakutata/cli create --name telemetry --template service --with installer --yes
cd telemetry
rm packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
```

项目是一个工作区，服务在 `packages/app` 中（见 [ProjectStructure](../ProjectStructure.md)）。`installer` 功能添加了制作安装包所需的内容：`packages/app/package.json` 中的 `lakutata.installer` 配置、`package:host` 和 `package:linux` 脚本、`Dockerfile.installer`、`@lakutata/builder`，以及 `packages/resources` 中的图标。服务不需要再安装其他包：定时任务和监控器都是 lakutata 自带的。这里还删掉了模板中的示例控制器。

## 2. 传感器

**`packages/app/src/components/Sensors.ts`**

```typescript
import os from 'node:os'
import {readFile} from 'node:fs/promises'
import {Component, DTO} from 'lakutata'
import {Configurable} from 'lakutata/decorator/di'

/**
 * 传感器测得的数据
 */
export type Measures = {
    /**
     * 机器最近一分钟的平均负载
     */
    load: number
    /**
     * 已用内存占机器内存的百分比
     */
    memory: number
    /**
     * CPU 温度（摄氏度），系统不提供时为 null
     */
    temperature: number | null
}

/**
 * 机器的传感器：负载、内存和 CPU 温度。设备有自己的传感器（接在串口或 I2C 上）时，就由这个组件读取它们
 */
export class Sensors extends Component {

    /**
     * 温度文件，单位是千分之一摄氏度（Linux 的 thermal zone）
     */
    @Configurable(DTO.String().required())
    protected readonly temperatureFile: string

    /**
     * 读取传感器
     */
    public async read(): Promise<Measures> {
        return {
            load: Math.round(os.loadavg()[0] * 100) / 100,
            memory: Math.round((1 - os.freemem() / os.totalmem()) * 1000) / 10,
            temperature: await this.temperature()
        }
    }

    /**
     * CPU 温度；温度文件读不到时（macOS、Windows、没有 thermal zone 的机器）为 null
     */
    protected async temperature(): Promise<number | null> {
        try {
            return Math.round(Number(await readFile(this.temperatureFile, 'utf8')) / 100) / 10
        } catch {
            return null
        }
    }
}
```

组件是长期存在的对象，整个应用中只有一个（见 [Objects](../Objects.md)）。这个组件：

- 读取最近一分钟的平均负载（`os.loadavg()`，在 Windows 上总是 0），以及已用内存所占的比例；
- 从 Linux 的 thermal zone 读取 CPU 温度：这是一个以千分之一摄氏度为单位的文件（`48312` 表示 48.3 °C）。机器上没有这个文件时（例如 Mac），温度为 `null`；
- 有一个选项 `temperatureFile`：创建组件时，`@Configurable` 会用声明的规则校验服务选项中给出的值。

如果设备有自己的传感器（接在串口或 I2C 上），就由这个组件读取它们，服务的其他部分不用改。

## 3. 读数

**`packages/app/src/components/Readings.ts`**

```typescript
import {Component, DTO} from 'lakutata'
import {Configurable} from 'lakutata/decorator/di'
import {type Measures} from './Sensors.js'

/**
 * 一条读数：传感器测得的数据，以及测量的时间
 */
export type Reading = { time: string } & Measures

/**
 * 最近的读数，保存在内存中：条数达到 size 后，新读数替换最旧的一条
 */
export class Readings extends Component {

    /**
     * 最多保留多少条读数
     */
    @Configurable(DTO.Number().integer().min(1).required())
    protected readonly size: number

    protected readonly readings: Reading[] = []

    /**
     * 已保留的读数条数
     */
    public get count(): number {
        return this.readings.length
    }

    /**
     * 保存一条读数
     * @param reading
     */
    public add(reading: Reading): void {
        this.readings.push(reading)
        if (this.readings.length > this.size) this.readings.shift()
    }

    /**
     * 最近的读数，最新的在前
     * @param limit
     */
    public latest(limit: number): Reading[] {
        return this.readings.slice(-limit).reverse()
    }
}
```

- 读数保存在内存中，最多 `size` 条（和 `temperatureFile` 一样是组件的选项）：新读数会替换最旧的一条。服务重启后读数就没有了，第 11 节介绍如何保留它们。
- 组件是单例：虽然每次执行和每个请求都有自己的控制器，但添加读数的定时任务和读取读数的 HTTP 动作用的是同一个组件实例。

## 4. 输入

**`packages/app/src/dtos/ReadingsDTO.ts`**

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

/**
 * 要取最近多少条读数（查询字符串是文本，由 strict(false) 转换）
 */
export class ReadingsDTO extends DTO {
    @Expect(DTO.Number().integer().min(1).max(1000).strict(false).default(10))
    public limit: number
}
```

`limit` 是要取的读数条数：从 1 到 1000，默认为 10。查询字符串是文本：`.strict(false)` 把 `'3'` 转换为数字 3，不合法的值在动作运行之前就会被拒绝（见 [DTOValidation](../DTOValidation.md)）。

## 5. 控制器

**`packages/app/src/controllers/ReadingController.ts`**

```typescript
import {Controller, type ScheduleContext} from 'lakutata/com/entrypoint'
import {type CpuMonitor, type MemoryMonitor} from 'lakutata/com/monitor'
import {GET, Schedule} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {type Reading, type Readings} from '../components/Readings.js'
import {type Sensors} from '../components/Sensors.js'
import {ReadingsDTO} from '../dtos/ReadingsDTO.js'

export class ReadingController extends Controller {

    @Inject('sensors')
    protected readonly sensors: Sensors

    @Inject('readings')
    protected readonly readings: Readings

    /**
     * 服务自身的 CPU 和内存
     */
    @Inject('cpu')
    protected readonly cpu: CpuMonitor

    @Inject('memory')
    protected readonly memory: MemoryMonitor

    /**
     * 启动时读取一次传感器，之后每隔 SAMPLE_EVERY（默认 10 秒）读取一次
     */
    @Schedule({every: process.env.SAMPLE_EVERY ?? '10s', immediate: true})
    public async sample(): Promise<void> {
        const context: ScheduleContext = this.context as ScheduleContext
        this.readings.add({time: context.scheduledAt.toISOString(), ...await this.sensors.read()})
    }

    /**
     * GET /readings?limit=10：最近的读数，最新的在前
     * @param input
     */
    @GET('/readings', ReadingsDTO)
    public async list(input: ReadingsDTO): Promise<Reading[]> {
        return this.readings.latest(input.limit)
    }

    /**
     * GET /status：服务自身的状态，由监控器从启动时开始测量
     */
    @GET('/status')
    public async status(): Promise<{ uptime: number, readings: number, cpu: number, memory: number }> {
        return {
            uptime: Math.round(process.uptime()),
            readings: this.readings.count,
            //平均 CPU 使用率，以单个核心的百分比表示
            cpu: this.cpu.statistics.usageAvg,
            //常驻内存，单位为字节
            memory: this.memory.statistics.physicalUsed
        }
    }
}
```

- 一个控制器可以包含多种传输方式的动作（见 [Controllers](../Controllers.md)）：`sample()` 是定时任务，`list()` 和 `status()` 是 HTTP 动作。`sample()` 的每次执行都像请求一样处理，都会创建一个新的控制器。
- `@Schedule({every, immediate: true})` 在启动时执行一次 `sample()`，之后每过一个间隔执行一次（见 [Schedules](../Schedules.md)）。`this.context` 是本次执行的 `ScheduleContext`：其中的 `scheduledAt` 是本次执行的计划时间，用作读数的时间。
- 间隔是在定义这个类时（也就是加载它所在的模块时）从 `SAMPLE_EVERY` 读取的，所以取的是进程启动时的环境变量（来自 shell，或者安装后服务的环境变量文件）。如果值不是时长（例如没有单位的 `30`），服务在启动时就会停止：`SyntaxError: Invalid duration "30": such as "500ms", "30s", "5m", "1h30m" or "1d"`。
- 监控器测量的是服务本身，而不是机器（见 [Monitor](../Monitor.md)）：`usageAvg` 是进程自启动以来的平均 CPU 使用率，以单个核心的百分比表示；`physicalUsed` 是进程的常驻内存，单位为字节。从这两个值可以看出服务在小型机器上是否足够轻量。

## 6. 服务的选项

**`packages/app/src/config/Config.ts`**

```typescript
import type {ApplicationOptions} from 'lakutata'
import {buildEntrypoints, scheduleEntrypoint} from 'lakutata/com/entrypoint'
import {expressHTTPEntrypoint, jsonEnvelope} from 'lakutata/adapter/express'
import {CpuMonitor, MemoryMonitor} from 'lakutata/com/monitor'
import compression from 'compression'
import {authenticate} from '../middlewares/Authenticate.js'
import {Readings} from '../components/Readings.js'
import {Sensors} from '../components/Sensors.js'
import {HealthController} from '../controllers/HealthController.js'
import {ReadingController} from '../controllers/ReadingController.js'

/**
 * 服务的选项
 * @param port HTTP 服务器的端口，默认取环境变量 PORT，没有时为 8080
 * @param kept 保留的读数条数，默认取环境变量 READINGS_KEPT，没有时为 360（每 10 秒一条，正好一小时）
 */
export function config(port: number = Number(process.env.PORT ?? 8080), kept: number = Number(process.env.READINGS_KEPT ?? 360)): ApplicationOptions {
    return {
        id: 'telemetry',
        name: 'telemetry',
        mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
        components: {
            //测量服务自身 CPU 和内存的监控器
            cpu: {class: CpuMonitor},
            memory: {class: MemoryMonitor},
            sensors: {class: Sensors, temperatureFile: process.env.TEMPERATURE_FILE ?? '/sys/class/thermal/thermal_zone0/temp'},
            readings: {class: Readings, size: kept},
            entrypoint: buildEntrypoints({
                controllers: [HealthController, ReadingController],
                //执行 @Schedule 定时任务
                schedule: scheduleEntrypoint(),
                http: expressHTTPEntrypoint({
                    port: port,
                    //结果和错误都是 {errno, errMsg, data}，状态码都是 200
                    respond: jsonEnvelope({errorStatus: 200}),
                    body: {limit: '1mb'},
                    server: {keepAliveTimeout: 60000, headersTimeout: 65000},
                    middlewares: [authenticate],
                    before: (app): void => void app.use(compression())
                })
            })
        },
        //监控器从启动时开始测量
        bootstrap: ['cpu', 'memory', 'entrypoint']
    }
}
```

这是模板中的 `Config.ts`，改动如下：

- 新增监控器 `cpu` 和 `memory`，并把它们列在 `bootstrap` 中，让它们从启动时开始测量；
- 新增 `sensors` 和 `readings` 组件及其选项；
- 用 `ReadingController` 替换示例控制器，并加上定时适配器 `scheduleEntrypoint()`，没有它，`@Schedule` 定时任务永远不会执行（见 [Entrypoint](../Entrypoint.md)）；
- 请求体的上限从 100 MB 改为 1 MB：这个 API 只读取查询字符串。

服务通过环境变量配置：

| 变量 | 默认值 | 作用 |
|---|---|---|
| `PORT` | `8080` | HTTP API 的端口 |
| `SAMPLE_EVERY` | `10s` | 两次读数之间的间隔：`500ms`、`30s`、`5m` 这样的时长 |
| `READINGS_KEPT` | `360` | 保留多少条读数 |
| `TEMPERATURE_FILE` | `/sys/class/thermal/thermal_zone0/temp` | 温度文件 |
| `API_TOKEN` | 无 | 设置后，请求必须带上 `Authorization: Bearer <API_TOKEN>`（模板中的中间件） |
| `MODE` | `development` | 安装后的服务为 `production`；它优先于 `mode` 选项（见 [Application](../Application.md)） |

值不合法时，服务在启动时就会停止，日志会说明原因：

```bash
READINGS_KEPT=0 npm start
```

```
[2026-10-17T14:55:03.108Z] ERROR (telemetry): The service cannot start: The option "size" of "readings" (Readings) is invalid: "size" must be greater than or equal to 1
```

## 7. 安装包

**`packages/app/package.json`**

```json
{
  "name": "app",
  "version": "0.0.1",
  "description": "Reads the load, the memory and the temperature of the machine, and serves them over HTTP",
  "author": "",
  "license": "UNLICENSED",
  "private": true,
  "type": "module",
  "main": "build/App.js",
  "scripts": {
    "clean": "lakutata clean",
    "build": "tsc",
    "rebuild": "npm run clean && npm run build",
    "dev": "npm run rebuild && node build/App.js",
    "start": "node build/App.js",
    "test": "node --test \"build/tests/**/*.spec.js\"",
    "package": "lakutata package installer"
  },
  "dependencies": {
    "compression": "^1.8.1",
    "express": "^5.2.1",
    "lakutata": "^3.0.0"
  },
  "devDependencies": {
    "@types/compression": "^1.8.1",
    "@types/express": "^5.0.6"
  },
  "bin": {
    "telemetry": "build/App.js"
  },
  "lakutata": {
    "icon": "../resources/logo.png",
    "installer": {
      "name": "telemetry",
      "service": {
        "env": {
          "PORT": "8080",
          "SAMPLE_EVERY": "10s",
          "READINGS_KEPT": "360"
        },
        "restart": "always"
      },
      "linux": {
        "targets": [
          "deb",
          "rpm",
          "tar.gz"
        ]
      }
    }
  }
}
```

这是 `installer` 功能生成的 `package.json`，加上了描述和服务的选项（见 [Installers](../Installers.md)）：

- `bin` 给出程序名 `telemetry`，软件包会把它加入 PATH（Linux 上是 `/usr/bin/telemetry`）；
- `description` 是软件包和服务的描述；
- `service` 把服务注册到系统中：Linux 上由 systemd 运行，macOS 上由 launchd 运行，Windows 上作为 Windows 服务运行。安装时启用并启动服务，升级时重启它，卸载时停止并禁用它；
- `service.env` 是服务的环境变量，写在它的环境变量文件中（见第 10 节）；
- `restart: "always"` 让服务每次结束后都重新启动；默认值 `on-failure` 只在失败时重启；
- 服务以 `telemetry` 用户运行，这是安装时创建的系统用户；它的工作目录是 `/var/lib/telemetry`，数据可以写在这里；
- `linux.targets` 是要制作的 Linux 软件包：deb（Debian、Ubuntu、Raspberry Pi OS）、rpm（Fedora、Red Hat），以及一个 tar.gz 压缩包，压缩包只包含应用本身，不注册服务。

软件包的维护者取自 `lakutata.installer.maintainer`，没有时取 `package.json` 的 `author`；两者都没有时，工具会给出警告。

## 8. 运行

```bash
SAMPLE_EVERY=2s npm run dev
```

在另一个终端中：

```bash
curl 'localhost:8080/readings?limit=3'
# {"errno":null,"errMsg":null,"data":[{"time":"2026-10-17T14:50:33.497Z","load":1.94,"memory":75.8,"temperature":null},{"time":"2026-10-17T14:50:31.497Z","load":1.94,"memory":75.8,"temperature":null},{"time":"2026-10-17T14:50:29.497Z","load":1.94,"memory":75.9,"temperature":null}]}

curl localhost:8080/status
# {"errno":null,"errMsg":null,"data":{"uptime":6,"readings":3,"cpu":0.29407,"memory":117686272}}

curl 'localhost:8080/readings?limit=abc'
# {"errno":"E_INVALID_VALUE","errMsg":"\"limit\" must be a number","data":null}
```

服务启动时先取一条读数，之后每 2 秒一条。这里是在 Mac 上运行的，所以温度为 `null`；在有 thermal zone 的 Linux 机器上，它是 CPU 的温度（摄氏度）。

## 9. 测试

模板中的测试换成了针对读数的测试。它自己写一个 thermal zone 文件（42.5 摄氏度），然后启动服务，每 200 毫秒读取一次，只保留 3 条读数：

**`packages/app/src/tests/App.spec.ts`**

```typescript
import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
import {Application} from 'lakutata'

const PORT: number = Number(process.env.TEST_PORT ?? 18089)

/**
 * 带上令牌向服务发一个请求，返回 {errno, errMsg, data}
 * @param route
 */
async function request(route: string): Promise<{ errno: string | null, data: any }> {
    const response: Response = await fetch(`http://127.0.0.1:${PORT}${route}`, {headers: {Authorization: 'Bearer test-token'}})
    return await response.json() as { errno: string | null, data: any }
}

describe('telemetry', (): void => {

    let app: Application
    let directory: string

    before(async (): Promise<void> => {
        //一个 42.5 摄氏度的 thermal zone
        directory = await mkdtemp(path.join(os.tmpdir(), 'telemetry-'))
        await writeFile(path.join(directory, 'temp'), '42500\n')
        process.env.TEMPERATURE_FILE = path.join(directory, 'temp')
        process.env.API_TOKEN = 'test-token'
        //每 200 毫秒一条读数：间隔是在加载控制器时读取的，所以先设置 SAMPLE_EVERY，再导入选项
        process.env.SAMPLE_EVERY = '200ms'
        const {config} = await import('../config/Config.js')
        app = await new Promise<Application>((resolve: (app: Application) => void): void => {
            Application.run(config(PORT, 3)).onLaunched((launched: Application): void => resolve(launched))
        })
    })

    after(async (): Promise<void> => {
        await app?.dispose()
        await rm(directory, {recursive: true, force: true})
    })

    it('refuses the requests without authentication', async (): Promise<void> => {
        const response: Response = await fetch(`http://127.0.0.1:${PORT}/readings`)
        assert.deepStrictEqual(await response.json(), {errno: 'E_UNAUTHORIZED', errMsg: 'The request is not authenticated', data: null})
    })

    it('samples the sensors on its schedule and keeps the latest readings', async (): Promise<void> => {
        //启动时一条，之后每 200 毫秒一条，只保留最近的 3 条
        await sleep(1000)
        const {data: readings} = await request('/readings')
        assert.strictEqual(readings.length, 3)
        assert.ok(readings[0].time > readings[1].time && readings[1].time > readings[2].time)
        for (const reading of readings) {
            assert.strictEqual(reading.temperature, 42.5)
            assert.ok(reading.load >= 0)
            assert.ok(reading.memory > 0 && reading.memory <= 100)
        }
        assert.strictEqual((await request('/readings?limit=1')).data.length, 1)
    })

    it('refuses an invalid limit', async (): Promise<void> => {
        assert.strictEqual((await request('/readings?limit=0')).errno, 'E_INVALID_VALUE')
    })

    it('gives the status of the service', async (): Promise<void> => {
        const {data: status} = await request('/status')
        assert.strictEqual(status.readings, 3)
        assert.ok(status.cpu >= 0)
        assert.ok(status.memory > 0)
    })
})
```

设置好 `SAMPLE_EVERY` 之后才导入选项，因为间隔是在加载控制器的模块时读取的。`node --test` 让每个测试文件在单独的进程中运行，所以这里设置的环境变量不会影响其他测试文件。

```bash
npm test
```

```
app │   ✔ refuses the requests without authentication
app │   ✔ samples the sensors on its schedule and keeps the latest readings
app │   ✔ refuses an invalid limit
app │   ✔ gives the status of the service
app │ ℹ pass 4
✔ test ran in app
```

## 10. 安装到设备上

安装包中是一个内嵌 Node.js 的可执行文件，它按制作时所在的系统和架构构建（见 [Packaging](../Packaging.md)）。`installer` 功能的两个脚本把安装包写到 `dist/installer`：

- `npm run package:linux` 在 Docker 容器中（`Dockerfile.installer`）制作 Linux 软件包，在 macOS 和 Windows 上也能用；软件包的架构就是 Docker 的架构：在 Apple 芯片的 Mac 上是 arm64，与装 64 位系统的树莓派 4、5 相同。文件名由包名、版本和架构组成：`telemetry_0.0.1_arm64.deb`、`telemetry-0.0.1-1.aarch64.rpm` 和 `telemetry-0.0.1-linux-arm64.tar.gz`。要为 x64 机器制作，就给 Docker 指定对应的平台：`docker buildx build --platform linux/amd64 --file Dockerfile.installer --output type=local,dest=dist/installer .`
- `npm run package:host` 制作当前机器的安装包：在 Linux 上是同样的软件包；在 macOS 上是 `pkg` 安装包（launchd 服务）和 tar.gz 压缩包；在 Windows 上是 NSIS 和 MSI 安装程序（Windows 服务）以及 zip 压缩包。

在运行 Debian 或 Raspberry Pi OS 的设备上：

```bash
sudo apt install ./telemetry_0.0.1_arm64.deb
systemctl status telemetry                    # 已启用并启动
journalctl -u telemetry -f                    # 服务的日志
curl 'localhost:8080/readings?limit=1'
```

服务的环境变量文件 `/etc/telemetry/telemetry.env` 中包含 `MODE=production` 和 `package.json` 中的 `service.env`：

```
# The environment of the service telemetry, read when it starts (systemctl restart telemetry)
MODE="production"
PORT="8080"
SAMPLE_EVERY="10s"
READINGS_KEPT="360"
```

要修改服务的配置，就编辑这个文件，然后重启服务：

```bash
sudoedit /etc/telemetry/telemetry.env         # 例如 SAMPLE_EVERY="30s"、API_TOKEN="…"
sudo systemctl restart telemetry
```

升级（用 `sudo apt install` 安装下一个版本）会保留你对环境变量文件的修改，并重启服务。`sudo apt remove telemetry` 会停止服务并删除应用，但保留环境变量文件和工作目录。

## 11. 下一步

- 要在重启后保留读数，可以把它们存进服务工作目录中的 SQLite 数据库，使用相对路径（安装后，`readings.sqlite` 就是 `/var/lib/telemetry/readings.sqlite`），做法见 [带数据库的 REST API](RestAPI.md)。它的驱动 better-sqlite3 是原生插件，安装包会把它放在可执行文件旁边（见 [Packaging](../Packaging.md) 第 3 节）。
- 要把读数发送到服务器，可以在 `sample()` 中通过 [NATS](../NATS.md) 发布，或者把它们加入[队列](../Queue.md)。
- 在 Linux 设备上，服务还可以和系统打交道：通过 [D-Bus](../DBus.md) 调用系统的服务，或者用 [containerd](../ContainerdIntegration.md) 或 [Docker](../DockerIntegration.md) 运行容器。
