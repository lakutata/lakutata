# A service on a device

This example builds a service for a small Linux machine, such as a Raspberry Pi or a gateway: it reads the load, the
memory and the temperature of the machine every 10 seconds, keeps the last hour of readings in memory, and serves them
over HTTP. It starts from the `service` template with its `installer` feature, and shows a scheduled action, components
of its own with their options, the lakutata monitors, configuration through environment variables, and the packages that
install the service on the machine and start it with the system.

| Method | Route | What it does |
|---|---|---|
| `GET` | `/readings?limit=10` | Gives the latest readings, the newest first |
| `GET` | `/status` | Gives the uptime of the service, its number of readings, and its own CPU and memory use |
| `GET` | `/health` | Tells whether the process answers (from the template) |

## 1. Create the project

```bash
npx @lakutata/cli create --name telemetry --template service --with installer --yes
cd telemetry
rm packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
```

The project is a workspace whose service is `packages/app` ([ProjectStructure](../ProjectStructure.md)). The `installer`
feature adds what is needed to make the installers: the `lakutata.installer` configuration in
`packages/app/package.json`, the `package:host` and `package:linux` scripts, `Dockerfile.installer`,
`@lakutata/builder`, and the icon in `packages/resources`. The service needs no other package: the schedules and the
monitors are part of lakutata. The example controller of the template is removed.

## 2. The sensors

**`packages/app/src/components/Sensors.ts`**

```typescript
import os from 'node:os'
import {readFile} from 'node:fs/promises'
import {Component, DTO} from 'lakutata'
import {Configurable} from 'lakutata/decorator/di'

/**
 * What the sensors measure
 */
export type Measures = {
    /**
     * The load average of the machine over the last minute
     */
    load: number
    /**
     * The memory in use, as a percentage of the memory of the machine
     */
    memory: number
    /**
     * The temperature of the CPU in degrees Celsius, or null when the system does not report it
     */
    temperature: number | null
}

/**
 * The sensors of the machine: its load, its memory and the temperature of its CPU. On a device with its own sensors
 * (on a serial port or I2C), this is the component that reads them
 */
export class Sensors extends Component {

    /**
     * The temperature file, in thousandths of a degree (a Linux thermal zone)
     */
    @Configurable(DTO.String().required())
    protected readonly temperatureFile: string

    /**
     * Read the sensors
     */
    public async read(): Promise<Measures> {
        return {
            load: Math.round(os.loadavg()[0] * 100) / 100,
            memory: Math.round((1 - os.freemem() / os.totalmem()) * 1000) / 10,
            temperature: await this.temperature()
        }
    }

    /**
     * The temperature, or null when its file cannot be read (macOS, Windows, a machine without a thermal zone)
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

A component is a long-lived object, one for the whole application ([Objects](../Objects.md)). This one:

- reads the load average over the last minute (`os.loadavg()`, always 0 on Windows), and the share of the memory in use;
- reads the temperature of the CPU from a Linux thermal zone: a file that holds thousandths of a degree (`48312` for
  48.3 °C). On a machine without one, such as a Mac, the temperature is `null`;
- has an option, `temperatureFile`: when the component is created, `@Configurable` checks the value given in the options
  of the service against its schema.

On a device with its own sensors (on a serial port or I2C), this is the component that reads them; the rest of the
service stays the same.

## 3. The readings

**`packages/app/src/components/Readings.ts`**

```typescript
import {Component, DTO} from 'lakutata'
import {Configurable} from 'lakutata/decorator/di'
import {type Measures} from './Sensors.js'

/**
 * A reading: the measures of the sensors, and when they were taken
 */
export type Reading = { time: string } & Measures

/**
 * The recent readings, kept in memory, at most size of them: a new one replaces the oldest
 */
export class Readings extends Component {

    /**
     * How many readings are kept
     */
    @Configurable(DTO.Number().integer().min(1).required())
    protected readonly size: number

    protected readonly readings: Reading[] = []

    /**
     * The number of readings kept
     */
    public get count(): number {
        return this.readings.length
    }

    /**
     * Keep a reading
     * @param reading
     */
    public add(reading: Reading): void {
        this.readings.push(reading)
        if (this.readings.length > this.size) this.readings.shift()
    }

    /**
     * The latest readings, the newest first
     * @param limit
     */
    public latest(limit: number): Reading[] {
        return this.readings.slice(-limit).reverse()
    }
}
```

- The readings are kept in memory, at most `size` of them (an option, like `temperatureFile`): a new reading replaces
  the oldest one. They are lost when the service restarts; section 11 shows how to keep them.
- A component is a singleton: the scheduled action that adds the readings and the HTTP actions that read them share the
  same instance, although each run and each request gets its own controller.

## 4. The input

**`packages/app/src/dtos/ReadingsDTO.ts`**

```typescript
import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

/**
 * How many of the latest readings to return (the query string is text, which strict(false) converts)
 */
export class ReadingsDTO extends DTO {
    @Expect(DTO.Number().integer().min(1).max(1000).strict(false).default(10))
    public limit: number
}
```

`limit` is the number of readings to return: from 1 to 1000, 10 by default. The query string is text: `.strict(false)`
converts `'3'` to the number 3, and an invalid value is refused before the action runs
([DTOValidation](../DTOValidation.md)).

## 5. The controller

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
     * The CPU and the memory of the service itself
     */
    @Inject('cpu')
    protected readonly cpu: CpuMonitor

    @Inject('memory')
    protected readonly memory: MemoryMonitor

    /**
     * Reads the sensors at the start, then every SAMPLE_EVERY (10 seconds by default)
     */
    @Schedule({every: process.env.SAMPLE_EVERY ?? '10s', immediate: true})
    public async sample(): Promise<void> {
        const context: ScheduleContext = this.context as ScheduleContext
        this.readings.add({time: context.scheduledAt.toISOString(), ...await this.sensors.read()})
    }

    /**
     * GET /readings?limit=10: the latest readings, the newest first
     * @param input
     */
    @GET('/readings', ReadingsDTO)
    public async list(input: ReadingsDTO): Promise<Reading[]> {
        return this.readings.latest(input.limit)
    }

    /**
     * GET /status: the service itself, as measured by the monitors since it started
     */
    @GET('/status')
    public async status(): Promise<{ uptime: number, readings: number, cpu: number, memory: number }> {
        return {
            uptime: Math.round(process.uptime()),
            readings: this.readings.count,
            //The mean CPU usage, in percent of one core
            cpu: this.cpu.statistics.usageAvg,
            //The resident memory, in bytes
            memory: this.memory.statistics.physicalUsed
        }
    }
}
```

- A controller can hold the actions of several transports ([Controllers](../Controllers.md)): `sample()` is a
  scheduled action, `list()` and `status()` are HTTP actions. Each run of `sample()` is handled like a request, with a
  new controller.
- `@Schedule({every, immediate: true})` runs `sample()` once at the start, then once every interval
  ([Schedules](../Schedules.md)). `this.context` is the `ScheduleContext` of the run: its `scheduledAt`, the time the
  run was planned for, becomes the time of the reading.
- The interval is read from `SAMPLE_EVERY` when the class is defined, that is, when its module is loaded, so it comes
  from the environment the process starts with (the shell, or the environment file of the installed service). A value
  that is not a duration, such as `30` without a unit, stops the service at startup:
  `SyntaxError: Invalid duration "30": such as "500ms", "30s", "5m", "1h30m" or "1d"`.
- The monitors measure the service itself, not the machine ([Monitor](../Monitor.md)): `usageAvg` is the mean CPU usage
  of the process since its start, in percent of one core, and `physicalUsed` is its resident memory, in bytes. They show
  whether the service stays light on a small machine.

## 6. The options of the service

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
 * The options of the service
 * @param port the port of the HTTP server, the PORT environment variable or 8080 by default
 * @param kept the number of readings kept, the READINGS_KEPT environment variable or 360 by default (an hour, with a
 * reading every 10 seconds)
 */
export function config(port: number = Number(process.env.PORT ?? 8080), kept: number = Number(process.env.READINGS_KEPT ?? 360)): ApplicationOptions {
    return {
        id: 'telemetry',
        name: 'telemetry',
        mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
        components: {
            //The monitors of the service's own CPU and memory
            cpu: {class: CpuMonitor},
            memory: {class: MemoryMonitor},
            sensors: {class: Sensors, temperatureFile: process.env.TEMPERATURE_FILE ?? '/sys/class/thermal/thermal_zone0/temp'},
            readings: {class: Readings, size: kept},
            entrypoint: buildEntrypoints({
                controllers: [HealthController, ReadingController],
                //Runs the @Schedule actions
                schedule: scheduleEntrypoint(),
                http: expressHTTPEntrypoint({
                    port: port,
                    //The results and the errors are {errno, errMsg, data}, with the status 200
                    respond: jsonEnvelope({errorStatus: 200}),
                    body: {limit: '1mb'},
                    server: {keepAliveTimeout: 60000, headersTimeout: 65000},
                    middlewares: [authenticate],
                    before: (app): void => void app.use(compression())
                })
            })
        },
        //The monitors measure from the start
        bootstrap: ['cpu', 'memory', 'entrypoint']
    }
}
```

This is the `Config.ts` of the template, with:

- the monitors `cpu` and `memory`, listed in `bootstrap` so that they measure from the start;
- the `sensors` and `readings` components, with their options;
- `ReadingController` instead of the example controller, and the schedule adapter, `scheduleEntrypoint()`, without
  which the `@Schedule` actions never run ([Entrypoint](../Entrypoint.md));
- a limit of 1 MB on the request bodies instead of 100 MB: the API only reads query strings.

The service is configured through environment variables:

| Variable | Default | What it sets |
|---|---|---|
| `PORT` | `8080` | The port of the HTTP API |
| `SAMPLE_EVERY` | `10s` | The interval between the readings: a duration such as `500ms`, `30s` or `5m` |
| `READINGS_KEPT` | `360` | How many readings are kept |
| `TEMPERATURE_FILE` | `/sys/class/thermal/thermal_zone0/temp` | The temperature file |
| `API_TOKEN` | None | When it is set, the requests must carry `Authorization: Bearer <API_TOKEN>` (the middleware of the template) |
| `MODE` | `development` | `production` for the installed service; it wins over the `mode` option ([Application](../Application.md)) |

An invalid value stops the service at startup, and the log says why:

```bash
READINGS_KEPT=0 npm start
```

```
[2026-10-17T14:55:03.108Z] ERROR (telemetry): The service cannot start: The option "size" of "readings" (Readings) is invalid: "size" must be greater than or equal to 1
```

## 7. The installers

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

This is the `package.json` made by the `installer` feature, with a description and the options of the service added
([Installers](../Installers.md)):

- `bin` names the program, `telemetry`, which the packages put in the PATH (`/usr/bin/telemetry` on Linux);
- `description` describes the packages and the service;
- `service` registers the service with the system: systemd on Linux, launchd on macOS, a Windows service on Windows. The
  installation enables and starts it, an upgrade restarts it, and the removal stops and disables it;
- `service.env` is the environment of the service, written to its environment file (section 10);
- `restart: "always"` restarts the service whenever it ends; the default, `on-failure`, restarts it only when it fails;
- the service runs as `telemetry`, a system user that the installation creates, in its working directory,
  `/var/lib/telemetry`, where it can write its data;
- `linux.targets` lists the Linux packages: deb (Debian, Ubuntu, Raspberry Pi OS), rpm (Fedora, Red Hat) and a tar.gz
  archive, which holds only the application, without the service.

The packages take their maintainer from `lakutata.installer.maintainer`, or else from the `author` of the
`package.json`; without one, the tool warns.

## 8. Run it

```bash
SAMPLE_EVERY=2s npm run dev
```

In another terminal:

```bash
curl 'localhost:8080/readings?limit=3'
# {"errno":null,"errMsg":null,"data":[{"time":"2026-10-17T14:50:33.497Z","load":1.94,"memory":75.8,"temperature":null},{"time":"2026-10-17T14:50:31.497Z","load":1.94,"memory":75.8,"temperature":null},{"time":"2026-10-17T14:50:29.497Z","load":1.94,"memory":75.9,"temperature":null}]}

curl localhost:8080/status
# {"errno":null,"errMsg":null,"data":{"uptime":6,"readings":3,"cpu":0.29407,"memory":117686272}}

curl 'localhost:8080/readings?limit=abc'
# {"errno":"E_INVALID_VALUE","errMsg":"\"limit\" must be a number","data":null}
```

The first reading is taken at startup, then one every 2 seconds. The temperature is `null` here because the service ran
on a Mac; on a Linux machine with a thermal zone, it is the temperature of its CPU in degrees Celsius.

## 9. Test it

The test of the template is replaced by a test of the readings. It writes its own thermal zone, a file that reads
42.5 degrees, and starts the service with a reading every 200 milliseconds, keeping 3 readings:

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
 * A request to the service, with the token: its {errno, errMsg, data}
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
        //A thermal zone of 42.5 degrees
        directory = await mkdtemp(path.join(os.tmpdir(), 'telemetry-'))
        await writeFile(path.join(directory, 'temp'), '42500\n')
        process.env.TEMPERATURE_FILE = path.join(directory, 'temp')
        process.env.API_TOKEN = 'test-token'
        //A reading every 200 milliseconds. The interval is read when the controller is loaded, so the options are
        //imported only after SAMPLE_EVERY is set
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
        //A reading at the start, then one every 200 milliseconds: the latest 3 are kept
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

The options are imported only after `SAMPLE_EVERY` is set, because the interval is read when the module of the
controller is loaded. `node --test` runs each test file in its own process, so the variables that a file sets do not
reach the others.

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

## 10. Install it on the device

The installers hold an executable that embeds Node.js, built for the system and the architecture of the machine that
makes them ([Packaging](../Packaging.md)). The two scripts of the `installer` feature write the installers to
`dist/installer`:

- `npm run package:linux` makes the Linux packages in a Docker container (`Dockerfile.installer`), on macOS and Windows
  too, for the architecture of Docker: arm64 on a Mac with Apple silicon, which is also the architecture of a
  Raspberry Pi 4 or 5 running a 64-bit system. The file names hold the name of the package, its version and its
  architecture: `telemetry_0.0.1_arm64.deb`, `telemetry-0.0.1-1.aarch64.rpm` and `telemetry-0.0.1-linux-arm64.tar.gz`.
  For x64 machines, give Docker their platform:
  `docker buildx build --platform linux/amd64 --file Dockerfile.installer --output type=local,dest=dist/installer .`
- `npm run package:host` makes the installers for the machine it runs on: the same packages on Linux; on macOS, a `pkg`
  package (a launchd service) and a tar.gz archive; on Windows, the NSIS and MSI installers (a Windows service) and a
  zip archive.

On a device running Debian or Raspberry Pi OS:

```bash
sudo apt install ./telemetry_0.0.1_arm64.deb
systemctl status telemetry                    # enabled and started
journalctl -u telemetry -f                    # its log
curl 'localhost:8080/readings?limit=1'
```

The environment file of the service, `/etc/telemetry/telemetry.env`, holds `MODE=production` and the `service.env` of
the `package.json`:

```
# The environment of the service telemetry, read when it starts (systemctl restart telemetry)
MODE="production"
PORT="8080"
SAMPLE_EVERY="10s"
READINGS_KEPT="360"
```

To change the configuration of the service, edit the file, then restart the service:

```bash
sudoedit /etc/telemetry/telemetry.env         # SAMPLE_EVERY="30s", API_TOKEN="…"
sudo systemctl restart telemetry
```

An upgrade (`sudo apt install` of the next version) keeps your edits to the environment file and restarts the service.
`sudo apt remove telemetry` stops the service and removes the application, but keeps the environment file and the
working directory.

## 11. Next steps

- To keep the readings across restarts, store them in a SQLite database in the working directory of the service, with a
  relative path (once installed, `readings.sqlite` is `/var/lib/telemetry/readings.sqlite`), as in
  [A REST API with a database](RestAPI.md). Its driver, better-sqlite3, is a native addon, which the installers ship
  next to the executable ([Packaging](../Packaging.md), section 3).
- To send the readings to a server, publish them from `sample()` over [NATS](../NATS.md), or add them to a
  [queue](../Queue.md).
- On a Linux device, the service can also work with the system: call system services over [D-Bus](../DBus.md), or run
  containers with [containerd](../ContainerdIntegration.md) or [Docker](../DockerIntegration.md).

<!--
check:
  create: telemetry service installer
  remove: packages/app/src/controllers/ExampleController.ts packages/app/src/dtos/GreetDTO.ts
  run: npm test
-->
