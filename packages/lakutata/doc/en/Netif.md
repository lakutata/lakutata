# Lakutata Netif

The `@lakutata/netif` package lets a Node.js server listen on a network interface instead of an address. A device with
several interfaces often serves its management pages on only one of them: that port's address comes from DHCP and
changes, or is not yet available when the device starts, and listening on `0.0.0.0` would expose the pages on every
interface. With the package, the server listens on "eth1", whatever its addresses, and continues listening when they
change and when the interface is unplugged and plugged back in. It is not part of `lakutata`, and it needs no
application. Its main features:

- **Any server**: `http`, `https`, `http2`, `tls`, Express and Fastify handle the interface's connections as their own;
  UDP sockets are also supported, for services that work on one interface (DHCP, mDNS, SSDP).
- **Lakutata's adapters** take an `interface` option, which serves an application's controllers on one interface
  (section 5).
- **The system refuses the other interfaces where it can**: on Linux the sockets are bound to the interface, and a
  connection that reaches its address through another interface is refused. On Windows and macOS the interface's
  addresses are listened on, and `enforced` indicates whether the system refuses those connections.
- **Interfaces and their changes**: every interface on the machine with its state, and events when its addresses, link
  or presence change, from the system's notifications.
- **A native addon**, compiled when the package is installed, for Linux, macOS and Windows; it also runs in Bun and in
  Electron's main process.

The `@lakutata/netif` README describes every function and its options; this guide describes what the package is for,
with an example of each use.

```bash
npm install @lakutata/netif
```

The addon is compiled when the package is installed, so the machine needs Python 3 and a C++17 compiler (on Alpine
Linux, the kernel headers too: `apk add python3 make g++ linux-headers`). The package manager has to run the package's
install script: npm runs it, and may warn that the script is "not yet covered by allowScripts"
(`npm install-scripts approve @lakutata/netif` records that you allow it); Bun and pnpm run it only for packages they
are told to trust (`trustedDependencies` in the package.json for Bun, `pnpm approve-builds` for pnpm). Its types refer
to those of `@lakutata/core`, a peer dependency that package managers install with it; it is not loaded when the package
runs.

## 1. Listening on an interface

`listenOn()` listens on an interface for a server. The interface is specified by its name, its hardware address
(`{mac: '52:54:00:12:34:56'}`, which stays the same whatever name the system gives it) or its index; on Windows the name
is the network connection's name (`'以太网 2'`, `'Ethernet 2'`).

```typescript
import {createServer} from 'node:http'
import express from 'express'
import {type InterfaceListener, listenOn} from '@lakutata/netif'

const app = express()
app.get('/', (request, response) => response.send(`served on ${request.socket.localAddress}`))

const listener: InterfaceListener = await listenOn('eth1', createServer(app), {port: 8080})
listener.on('error', error => console.error(error))
console.log(listener.port, listener.addresses)
```

- The listener accepts connections and passes them to the server, which handles them as its own. The server itself does
  not listen: its `address()` is `null`, and `server.close()` does not stop the listener; use `listener.port`,
  `listener.addresses` and `listener.close()`.
- The interface may not exist yet or may have no address yet: `listenOn()` returns immediately, and the interface is
  listened on as soon as it can be. When it is unplugged and plugged back in, or when its addresses change, it is
  listened on again automatically; established connections are left to the server.
- The first listening attempt throws its errors (the port already in use); errors when the interface is listened on
  again are `error` events, and that listening is retried a little later. Handle the listener's `error` event, as for a
  `net.Server`.
- `family` selects `'IPv4'`, `'IPv6'` or `'both'` (the default); `port: 0` lets the system choose a port, which is kept
  when the interface is listened on again.

## 2. Which connections are refused

A client on another network can send packets for the management port's address through another interface of the device,
using its own route through that interface. `enforced` indicates whether the system refuses such a connection:

| | `enforced` |
|---|---|
| Linux | `true`: the sockets are bound to the interface (`SO_BINDTODEVICE`); before Linux 5.7 this requires the `CAP_NET_RAW` capability, without which the addresses are listened on and `enforced` is `false` |
| Windows | `true` while every other interface receives with the strong host model and does not forward, which is the default |
| macOS | `false` unless the system is configured to refuse those packets (`net.inet.ip.check_interface` set to 2, and `net.inet6.ip6.check_interface` for IPv6) and does not forward |

By default, the interface is listened on in the best way the system allows, and never less than `listen(port, host)` on
its addresses; `reason` explains why there is no guarantee and how to obtain it. Where the management port is a security
boundary, `strict: true` refuses to listen without the guarantee, and stops listening while the guarantee is lost:

```typescript
import {createServer} from 'node:http'
import {type InterfaceListener, NetIfNotEnforcedException, NetworkInterface} from '@lakutata/netif'

const management: NetworkInterface = new NetworkInterface({mac: '52:54:00:12:34:56'})
try {
    const listener: InterfaceListener = await management.listen(createServer(), {port: 443, strict: true})
    listener.on('error', error => console.error(error))
    listener.on('enforced', enforced => console.log(enforced ? 'guaranteed again' : 'stopped: no longer guaranteed'))
} catch (error) {
    if (error instanceof NetIfNotEnforcedException) console.error(error.message)
    throw error
}
```

## 3. Following an interface

A `NetworkInterface` provides an interface's current state (`present`, `running`, `addresses`…) and an event for each
change. The events come from the system's notifications, not from polling.

```typescript
import {type InterfaceAddress, listInterfaces, NetworkInterface} from '@lakutata/netif'

console.log(listInterfaces().map(entry => `${entry.name}: ${entry.running ? 'connected' : 'not connected'}`))

const wan: NetworkInterface = new NetworkInterface('eth0')
wan.on('change', ({added, removed}) => {
    for (const address of added) console.log(`new address ${address.cidr}`)
    for (const address of removed) console.log(`address gone ${address.cidr}`)
})
wan.on('down', () => console.log('the cable of eth0 is unplugged'))
wan.on('up', () => console.log('the cable of eth0 is plugged in'))
const address: InterfaceAddress = await wan.waitForAddress({family: 'IPv4', timeout: 60000})
console.log(`reachable at ${address.address}`)
```

- `listInterfaces()` also lists interfaces without an address, with their state; `os.networkInterfaces()` lists only
  those with an address.
- An IPv6 address counts once it is usable: about a second after it is added, when its duplicate address detection has
  finished.
- `close()` stops following the interface (and closes its listeners).

## 4. UDP on an interface

`createUDPSocket()` returns a UDP socket on the interface, with the methods and events of a `dgram` socket. A device
that responds to discovery broadcasts only on its management network:

```typescript
import {type InterfaceUDPSocket, NetworkInterface} from '@lakutata/netif'

const management: NetworkInterface = new NetworkInterface('eth1')
const socket: InterfaceUDPSocket = await management.createUDPSocket({port: 30303, family: 'IPv4'})
socket.setBroadcast(true)
socket.on('message', (message, remote) => {
    const answer: string = `device at ${management.addresses[0]?.address}`
    if (message.toString() === 'who is there') socket.send(answer, remote.port, remote.address)
})
socket.on('error', error => console.error(error))
```

On Linux the socket receives what comes through the interface, including its broadcasts and the multicast traffic of
groups joined with `addMembership()`, and nothing from the other interfaces. On Windows and macOS a socket is bound to
each of the interface's addresses; on macOS such sockets receive neither broadcasts nor multicast.

## 5. In an application

Lakutata adapters that listen on a port take an `interface` option: `expressHTTPEntrypoint()`,
`fastifyHTTPEntrypoint()`, `httpServiceEntrypoint()`, `socketIOServiceEntrypoint()`, `jsonRPCServiceEntrypoint()`,
`grpcServiceEntrypoint()` from `@lakutata/grpc` and `httpMCPEntrypoint()` from `@lakutata/mcp`. The controllers' actions
are then served on that interface, whatever its addresses:

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {GET} from 'lakutata/decorator/ctrl'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'

class ManagementController extends Controller {
    @GET('/status')
    public async status(): Promise<{ ok: boolean }> {
        return {ok: true}
    }
}

Application.run(() => ({
    id: 'device.app',
    name: 'Device',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [ManagementController],
            http: expressHTTPEntrypoint({port: 8080, interface: 'eth1'})
        })
    },
    bootstrap: ['entrypoint']
}))
```

- `family`, `strict` and `onError` are used with `interface`. Without `onError`, errors from listening again are written
  to the application's log. The adapter's `listening` callback receives the listeners. [HTTP](HTTP.md), section 2,
  describes these options.
- The application launches even when the interface does not exist yet, and its actions become reachable once the
  interface appears.
- The adapters listen through `IInterfaceListening`, a `@lakutata/core` contract that this package implements and that
  they load by default. Another implementation is specified in their `interfaceListening` option; the package's
  `InterfaceListener` is an `IInterfaceListener`.

A server that is not part of an entrypoint belongs in a component: it listens in `startup()` and stops in `destroy()`.
The interface and the port are the component's options.

```typescript
import {createServer} from 'node:http'
import express from 'express'
import {Application, Component, DTO, type ILogger} from 'lakutata'
import {Configurable, Inject} from 'lakutata/decorator/di'
import {type InterfaceListener, listenOn} from '@lakutata/netif'

class ManagementPages extends Component {
    @Inject('log')
    protected readonly log: ILogger

    @Configurable(DTO.String().required())
    protected readonly interfaceName: string

    @Configurable(DTO.Number().port().default(8080))
    protected readonly port: number

    protected listener: InterfaceListener

    protected async startup(): Promise<void> {
        const app = express()
        app.get('/', (request, response) => response.send('management'))
        this.listener = await listenOn(this.interfaceName, createServer(app), {port: this.port})
        this.listener.on('error', (error: Error): void => this.log.error(error.message))
        this.listener.on('listening', (): void => this.log.info('listening on %o', this.listener.addresses))
        this.log.info('enforced: %s', this.listener.enforced)
    }

    protected async destroy(): Promise<void> {
        await this.listener?.close()
    }
}

Application.run(() => ({
    id: 'device.app',
    name: 'Device',
    components: {
        management: {class: ManagementPages, interfaceName: 'eth1', port: 8080}
    },
    bootstrap: ['management']
}))
```

## 6. Systems, runtimes and packaging

- **Linux** binds the sockets to the interface: the system refuses the other interfaces, an added address is served
  immediately, and UDP receives the interface's broadcasts and multicast. Before Linux 5.7, grant the process
  `CAP_NET_RAW` (`setcap cap_net_raw+ep`, or `AmbientCapabilities=CAP_NET_RAW` in its systemd unit).
- **Windows** listens on the interface's addresses; its strong host model refuses the other interfaces unless an
  interface is set to the weak host model (`netsh interface ipv4 set interface "<name>" weakhostreceive=enabled`, which
  some load balancers do) or forwards. `reason` names that interface.
- **macOS** listens on the interface's addresses, without the guarantee unless the system is configured for it. macOS 27
  hides hardware addresses from processes (it reports `02:00:00:00:00:00`): specify an interface by its name there.
- **Bun**: its `https` server responds without TLS to connections passed to it, so `listen()` refuses it in Bun (as well
  as a Fastify instance created with `https`); use `http2.createSecureServer({key, cert, allowHTTP1: true})` or
  `tls.createServer()` there. Its servers do not close idle keep-alive connections passed to them; the adapters close
  them themselves. A connection passed to a server cannot be upgraded to a WebSocket, so the
  adapters refuse WebSocket on an interface in Bun.
- **Electron**: in the main process.
- Bundles, executables and installers made by `lakutata package` include the compiled addon
  (`build/Release/netif.node`): build them on each target platform, after installing the package there (see
  [Packaging](Packaging.md) and [Native Addons](NativeAddons.md)).

## 7. Exceptions

| Exception | When |
|---|---|
| `NetIfNotFoundException` | An index that no interface has, a hardware address that several interfaces share |
| `NetIfNotEnforcedException` | `strict` where the system cannot refuse the other interfaces, or a lost guarantee (an `error` event) |
| `NetIfNotSupportedException` | What the system or the runtime cannot do: `bindSocket()` outside Linux, multicast on a socket bound to an address on macOS, an `https` server in Bun |
| `NetIfTimeoutException` | `waitForAddress()` past its `timeout` |
| `NetIfException` | The base class of all of them; a system refusal has its code in `errno` (`'EADDRINUSE'`, `'EACCES'`…) |
