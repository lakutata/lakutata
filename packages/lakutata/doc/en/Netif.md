# Lakutata Netif

The package `@lakutata/netif` lets a server of Node.js listen on a network interface instead of an address. A device
with several interfaces often serves its management pages on one of them only: the address of that port comes from DHCP
and changes, or is not there yet when the device starts, and listening on `0.0.0.0` would expose the pages on every
interface. With the package the server listens on "eth1", whatever its addresses, and keeps listening through their
changes and through the interface unplugged and plugged back. It is not part of `lakutata`, and it needs no
application. What it is like:

- **Any server**: `http`, `https`, `http2`, `tls`, Express and Fastify take the connections of the interface as their
  own; UDP sockets too, for the services that work on one interface (DHCP, mDNS, SSDP).
- **The entrypoints of lakutata** take an `interface` option, which serves the controllers of an application on one
  interface (section 5).
- **The system refuses the other interfaces where it can**: on Linux the sockets are bound to the interface, and a
  connection that reaches its address through another interface is refused. On Windows and macOS the addresses of the
  interface are listened on, and `enforced` tells whether the system refuses those connections.
- **The interfaces and their changes**: every interface of the machine with its state, and events when its addresses,
  its link or its presence change, from the notifications of the system.
- **A native addon**, compiled when the package is installed, for Linux, macOS and Windows; it also runs in Bun and in
  the main process of Electron.

The README of `@lakutata/netif` describes every function and its options; this guide goes through what the package is
for, with an example of each use.

```bash
npm install @lakutata/netif
```

The addon is compiled when the package is installed, so the machine needs Python 3 and a C++17 compiler (on Alpine Linux
the headers of the kernel too: `apk add python3 make g++ linux-headers`). The package manager has to run the install
script of the package: npm runs it, and may warn that the script is "not yet covered by allowScripts" (`npm
install-scripts approve @lakutata/netif` records that you allow it); Bun and pnpm run it only for the packages they are
told to trust (`trustedDependencies` in the package.json for Bun, `pnpm approve-builds` for pnpm).

## 1. Listening on an interface

`listenOn()` listens on an interface for a server. The interface is given by its name, its hardware address
(`{mac: '52:54:00:12:34:56'}`, the same whatever the system names it) or its index; on Windows the name is the one of
the network connection (`'以太网 2'`, `'Ethernet 2'`).

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

- The listener accepts the connections and gives them to the server, which handles them as its own. The server itself
  does not listen: its `address()` is `null`, and `server.close()` does not stop the listener; use `listener.port`,
  `listener.addresses` and `listener.close()`.
- The interface may not exist yet or have no address yet: `listenOn()` returns at once, and the interface is listened
  on when it can be. When it is unplugged and plugged back, or when its addresses change, it is listened on again by
  itself; the connections established are left to the server.
- The first listening throws its errors (the port taken); the later ones are `error` events, retried a little later.
  Handle the `error` event of the listener, as for a `net.Server`.
- `family` chooses `'IPv4'`, `'IPv6'` or `'both'` (by default); `port: 0` lets the system choose a port, kept when the
  interface is listened on again.

## 2. Which connections are refused

A client of another network can send packets for the address of the management port through another interface of the
device, with a route of its own through it. Whether the system refuses such a connection is what `enforced` tells:

| | `enforced` |
|---|---|
| Linux | `true`: the sockets are bound to the interface (`SO_BINDTODEVICE`); before Linux 5.7 this needs the capability `CAP_NET_RAW`, without which the addresses are listened on and `enforced` is `false` |
| Windows | `true` while every other interface receives with the strong host model and does not forward, which is the default |
| macOS | `false` unless the system is set to refuse those packets (`net.inet.ip.check_interface` set to 2, and `net.inet6.ip6.check_interface` for IPv6) and does not forward |

By default the interface is listened on in the best way the system allows, never less than `listen(port, host)` on its
addresses; `reason` tells why there is no guarantee and how to get it. Where the management port is a boundary of
security, `strict: true` refuses to listen without the guarantee, and stops the listening while it is lost:

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

A `NetworkInterface` gives the state of an interface now (`present`, `running`, `addresses`…) and an event at each
change. The events come from the notifications of the system, not from polling.

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

- `listInterfaces()` lists the interfaces without an address too, with their state; `os.networkInterfaces()` lists
  only the ones with an address.
- An IPv6 address counts once it is usable: about a second after it is added, when its duplicate address detection is
  over.
- `close()` stops following the interface (and closes its listeners).

## 4. UDP on an interface

`createUDPSocket()` gives a UDP socket of the interface, with the methods and the events of a `dgram` socket. A device
that answers the discovery broadcasts of its management network only:

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

On Linux the socket receives what comes through the interface, its broadcasts and the multicast of the groups joined
with `addMembership()` included, and nothing of the other interfaces. On Windows and macOS a socket is bound to each
address of the interface; on macOS such sockets receive no broadcast and no multicast.

## 5. In an application

The entrypoints of lakutata that listen on a port take an `interface` option: `expressHTTPEntrypoint()`,
`fastifyHTTPEntrypoint()`, `httpServiceEntrypoint()`, `socketIOServiceEntrypoint()`, `jsonRPCServiceEntrypoint()`,
`grpcServiceEntrypoint()` of `@lakutata/grpc` and `httpMCPEntrypoint()` of `@lakutata/mcp`. The actions of the
controllers are then served on that interface, whatever its addresses:

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

- `family`, `strict` and `onError` go with `interface`. Without `onError`, the errors of listening again are written to
  the log of the application. The `listening` callback of the adapter gets the listeners. [HTTP](HTTP.md), section 2,
  describes these options.
- The application starts while the interface does not exist yet, and its actions can be reached once it appears.
- The declarations of the adapters refer to the types of `@lakutata/netif`: TypeScript compiles an application that does
  not install the package only with `skipLibCheck`, which the projects created by lakutata set.

A server that is not an entrypoint belongs to a component: it listens in `startup()` and stops in `destroy()`. The
interface and the port are the options of the component.

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

- **Linux** binds the sockets to the interface: the system refuses the other interfaces, an address added is served at
  once, and UDP gets the broadcasts and the multicast of the interface. Before Linux 5.7 give the process `CAP_NET_RAW`
  (`setcap cap_net_raw+ep`, or `AmbientCapabilities=CAP_NET_RAW` in its systemd unit).
- **Windows** listens on the addresses of the interface; its strong host model refuses the other interfaces unless an
  interface is set to the weak host model (`netsh interface ipv4 set interface "<name>" weakhostreceive=enabled`, which
  some load balancers do) or forwards. `reason` names that interface.
- **macOS** listens on the addresses of the interface, without the guarantee unless the system is set to it. macOS 27
  hides the hardware addresses from the processes (it gives `02:00:00:00:00:00`): give an interface by its name there.
- **Bun**: its `https` server answers the connections given to it without TLS, so `listen()` refuses it in Bun (a
  Fastify instance created with `https` too); use `http2.createSecureServer({key, cert, allowHTTP1: true})` or
  `tls.createServer()` there. Its servers do not close the idle keep-alive connections given to them, which the
  entrypoints close themselves. A connection given to a server cannot be upgraded to a WebSocket (seen with Bun 1.4), so
  the entrypoints refuse WebSocket on an interface in Bun.
- **Electron**: in the main process.
- The bundles, the executables and the installers made by `lakutata package` carry the compiled addon
  (`build/Release/netif.node`): build them on each target platform, after installing the package there (see
  [Packaging](Packaging.md) and [NativeAddons](NativeAddons.md)).

## 7. Exceptions

| Exception | When |
|---|---|
| `NetIfNotFoundException` | An index no interface has, a hardware address several interfaces have |
| `NetIfNotEnforcedException` | `strict` where the system cannot refuse the other interfaces, or the guarantee lost (an `error` event) |
| `NetIfNotSupportedException` | What the system or the runtime cannot do: `bindSocket()` outside Linux, multicast on a socket bound to an address on macOS, an `https` server in Bun |
| `NetIfTimeoutException` | `waitForAddress()` past its `timeout` |
| `NetIfException` | The base of all of them; a refusal of the system has its code as `errno` (`'EADDRINUSE'`, `'EACCES'`…) |
