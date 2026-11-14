# @lakutata/netif

English | [中文](README.zh-CN.md)

Listen on a network interface instead of an address. In Node.js, `listen(port, host)` listens on an address: a
management port's address changes (DHCP) or is not yet available when the machine starts, and listening on `0.0.0.0`
exposes the service on every interface. With this package, a server listens on "eth1", whatever its addresses: it is
listened on again when they change and when the interface is unplugged and plugged back in, and on Linux the system
refuses connections that come through another interface. Any Node.js server works (`http`, `https`, `http2`, `tls`,
Express, Fastify), and so do UDP sockets. The package also lists the machine's interfaces with their state and reports
when they change. It is a native addon for Linux, macOS and Windows, compiled when the package is installed. It belongs
to the [Lakutata](https://github.com/lakutata/lakutata) family but requires no Lakutata application: import it and use
it.

## Installation

```shell
npm install @lakutata/netif
```

- The addon is compiled during the installation (node-gyp), so the machine requires Python 3 and a C++17 compiler: the
  Xcode Command Line Tools on macOS, `build-essential` on Debian and Ubuntu, and the Visual Studio Build Tools ("Desktop
  development with C++") on Windows. Alpine Linux also requires the kernel headers:
  `apk add python3 make g++ linux-headers`. If compiling fails, the installation fails.
- The package manager has to run the package's install script. npm runs it, and may warn that the script is
  "not yet covered by allowScripts": `npm install-scripts approve @lakutata/netif` records that you allow it. Bun and
  pnpm run it only for the dependencies they are told to trust (`trustedDependencies` in the package.json for Bun,
  `pnpm approve-builds` for pnpm); without it, loading the package throws an error that explains how to build the addon.
- Node.js `>=18.10.0`. The addon uses Node-API, so Bun and Electron's main process load the addon that node-gyp built
  for Node.js, without a rebuild.
- `@lakutata/core` is a peer dependency, which package managers install with it: the package's types refer to the
  contract for listening on network interfaces that core defines. It is not loaded when the package runs.

## Usage

### Getting started

```typescript
import {createServer} from 'node:http'
import express from 'express'
import {type InterfaceListener, listenOn} from '@lakutata/netif'

const app = express()
app.get('/', (request, response) => response.send('the management interface'))

const listener: InterfaceListener = await listenOn('eth1', createServer(app), {port: 8080})
listener.on('error', error => console.error(error))
console.log(listener.enforced, listener.addresses)    //true [{address: '192.168.10.2', family: 'IPv4', port: 8080}, …]
```

The interface may not exist yet (a USB adapter not plugged in) or have no address yet (DHCP not done): `listenOn()`
returns immediately and the interface is listened on as soon as it can be. While it waits, the listener keeps the
process alive, as a listening server does.

Lakutata's adapters (Express, Fastify, the service adapters, gRPC, MCP) do this through their `interface` option:
`expressHTTPEntrypoint({port: 8080, interface: 'eth1'})`. The package implements `IInterfaceListening` from
`@lakutata/core`, the contract they listen through, and its `InterfaceListener` is an `IInterfaceListener`.

### Choosing the interface

An interface is specified by its name, its hardware address or its index:

```typescript
import {NetworkInterface} from '@lakutata/netif'

const byName: NetworkInterface = new NetworkInterface('eth1')
const byHardwareAddress: NetworkInterface = new NetworkInterface({mac: '52:54:00:12:34:56'})
const byIndex: NetworkInterface = new NetworkInterface({index: 3})
```

- **The name**: `'eth1'`, `'enp3s0'`, `'en0'`. On Windows it is the network connection's name (`'以太网 2'`,
  `'Ethernet 2'`), in the system's language.
- **The hardware address** stays the same whatever name the system gives the interface: use it to specify a management
  port. Several interfaces with the same address (a bridge and its ports) throw a `NetIfNotFoundException`: specify the
  name instead. macOS 27 reports `02:00:00:00:00:00` as each interface's hardware address to every process without a
  special entitlement, so there an interface has no `mac` and cannot be found by it.
- **The index** changes when the interface is unplugged and plugged again: an index that no interface has throws a
  `NetIfNotFoundException`, and the object does not follow the interface once it is unplugged.

`listenOn(selector, server, options)` is `new NetworkInterface(selector).listen(server, options)`; the interface is
followed until the listener is closed.

### Which connections are refused

When the interface is listened on, clients on its network reach the server at its addresses, and nothing is listened on
at the other interfaces' addresses. A client on another network can still send packets for one of the interface's
addresses through another interface (using its own route through the machine). `enforced` indicates whether the system
refuses those:

| | How the interface is listened on | `enforced` |
|---|---|---|
| Linux | Sockets bound to the interface (`SO_BINDTODEVICE`), one per family: whatever its addresses, an added address is served immediately | `true`: the kernel refuses connections that come through another interface |
| Windows | A socket on each of the interface's addresses, again when they change | `true` while every other interface of the family receives with the strong host model and does not forward (the default): Windows then drops packets for an address that come through another interface ([the strong host model](https://learn.microsoft.com/en-us/previous-versions/technet-magazine/cc137807(v=msdn.10))) |
| macOS | A socket on each of the interface's addresses, again when they change | `false`: macOS accepts packets for an address through any interface. `true` only when the system is configured to refuse them (`sudo sysctl -w net.inet.ip.check_interface=2`, and `net.inet6.ip6.check_interface=2` for IPv6) and does not forward (a virtual machine or a container sharing the network turns forwarding on) |

By default, the interface is listened on in the best way the system allows: it is never less than listening on its
addresses with `listen(port, host)`, and `enforced` indicates whether the guarantee holds (`reason` explains why not,
and how to obtain it). With `strict: true`, `listen()` throws a `NetIfNotEnforcedException` where the guarantee does not
hold, and the listener stops (an `error` event) while the guarantee is lost, until it returns:

```typescript
import {createServer} from 'node:http'
import {type InterfaceListener, NetworkInterface} from '@lakutata/netif'

const management: NetworkInterface = new NetworkInterface('eth1')
const listener: InterfaceListener = await management.listen(createServer(), {port: 443, strict: true})
listener.on('enforced', enforced => console.log(enforced ? 'guaranteed again' : 'no longer guaranteed'))
```

The guarantee is followed while the interface is listened on: on Windows, a change to an interface's settings is
notified; macOS sends no notifications for its settings, which are read again when an interface changes.

On Linux, a socket bound to eth1 serves every connection that comes through eth1, whichever of the machine's addresses
it was sent to; `addresses` lists eth1's addresses.

### The server and its listener

The listener accepts connections and passes them to the server (`server.emit('connection', socket)`), which handles
them as its own: requests, keep-alive, upgrades, TLS. The server itself does not listen, so:

- `server.address()` is `null` and `server.listening` is `false`: use `listener.port` and `listener.addresses`.
- `server.close()` does not stop the listener: use `listener.close()`. When called on a server that never listened,
  Node.js's `server.close()` passes `ERR_SERVER_NOT_RUNNING` to its callback (a promisified `close()` rejects);
  `fastify.close()` does not.
- A server listened on several times (two interfaces, two ports) receives each listener's connections.
  `listenOnAll(['eth1', 'eth2'], server, {port: 8080})` listens on several interfaces, one listener for each; when one
  of them cannot be listened on, the others are closed and the error is thrown. With several interfaces the port cannot
  be 0.

For Express, pass `createServer(app)`; for Fastify, pass its `fastify.server` once `await fastify.ready()` has returned:

```typescript
import Fastify from 'fastify'
import {type InterfaceListener, NetworkInterface} from '@lakutata/netif'

const fastify = Fastify()
fastify.get('/', async () => 'ok')
await fastify.ready()
const listener: InterfaceListener = await new NetworkInterface('eth1').listen(fastify.server, {port: 8080})
```

The options of `listen()`:

| Option | |
|---|---|
| `port` | The port. 0: one the system chooses (`listener.port`), kept when the interface is listened on again |
| `family` | `'IPv4'`, `'IPv6'` or `'both'` (the default). With `'both'`, a system without IPv6 is listened on in IPv4 |
| `strict` | `true`: refused where the system cannot refuse connections that come through another interface. `false` by default |
| `backlog` | The length of the queue for connections not yet accepted, 511 by default |

`listener.close()` stops listening and returns without waiting for established connections, which are left to the
server. `NetworkInterface.close()` also closes its listeners.

### When the interface changes

| What happens | Linux (bound to the interface) | Windows, macOS |
|---|---|---|
| The interface does not exist | The listener waits; the interface is listened on when it appears | Same |
| It exists, without an address | Listened on: an added address is served immediately | The listener waits for an address |
| An address is added or removed | Nothing to do | The address is listened on, or no longer. A new IPv6 address is listened on once it is usable (after its duplicate address detection, about a second) |
| The link goes down | The sockets stay; they serve again when it comes back | Same, while its addresses stay |
| It is unplugged and plugged back | Listened on again (its index changed): a `listening` event | Listened on at its addresses again |
| The port is taken | An `error` event, then another attempt 1 second later; the delay doubles up to 30 seconds | Same |

Established connections are left to the server whatever happens. The first listening attempt throws its errors (a port
already in use, a port below 1024 without the permission); later errors are the listener's `error` events: **handle the
listener's `error` event**, as for a `net.Server` (without a handler, the error is thrown and ends the process).

### The interfaces and their changes

`listInterfaces()` lists every interface on the machine, including those without an address, with its state: more than
`os.networkInterfaces()`, which lists only interfaces with an address and no state. A `NetworkInterface` follows one
interface: its current state and an event for each change.

```typescript
import {type InterfaceAddress, listInterfaces, NetworkInterface} from '@lakutata/netif'

for (const entry of listInterfaces()) {
    console.log(entry.name, entry.index, entry.mac, entry.running, entry.addresses.map(address => address.cidr))
}

const lan: NetworkInterface = new NetworkInterface('eth0')
lan.on('change', ({addresses, added, removed}) => console.log('now', addresses, 'added', added, 'removed', removed))
lan.on('up', () => console.log('cable plugged in'))
lan.on('down', () => console.log('cable unplugged'))
lan.on('added', () => console.log('interface plugged'))
lan.on('removed', () => console.log('interface unplugged'))
const address: InterfaceAddress = await lan.waitForAddress({family: 'IPv4', timeout: 60000})
```

- `present`, `name`, `index`, `mac`, `up` (enabled), `running` (its link is up), `loopback`, `addresses` and `info` (all
  of them) provide the current state; while the interface does not exist, `present` is `false` and `addresses` is empty.
- The addresses are the usable ones, written as `os.networkInterfaces()` writes them: `address`, `family`, `netmask`,
  `cidr`, and for IPv6 `scopeid` (the interface's index for a link-local address, which is written `fe80::…%<scopeid>`
  to be connected to). An IPv6 address undergoing duplicate address detection counts once it is usable.
- The events come from the system's notifications (netlink on Linux, kernel events on macOS, IP Helper notifications on
  Windows), not from polling, a few tens of milliseconds after the change. Every `NetworkInterface` in a thread shares
  one system watcher, which keeps no event loop alive.
- `waitForAddress()` returns an address that the interface has, or the first one it obtains; with a `timeout`, a
  `NetIfTimeoutException` when none arrives.
- `close()` stops following the interface.

### UDP

`createUDPSocket()` returns a UDP socket on the interface, with the methods and events of a `dgram` socket:

```typescript
import {type InterfaceUDPSocket, NetworkInterface} from '@lakutata/netif'

const lan: NetworkInterface = new NetworkInterface('eth1')
const socket: InterfaceUDPSocket = await lan.createUDPSocket({port: 5353})
socket.addMembership('224.0.0.251')
socket.on('message', (message, remote) => {
    socket.send(message, remote.port, remote.address)
})
socket.on('error', error => console.error(error))
```

- On Linux its sockets (one per family) are bound to the interface: they receive what comes through it, including its
  broadcasts and the multicast traffic of the groups joined there, whatever its addresses, and send through it. DHCP,
  mDNS or SSDP on one interface work this way.
- On Windows and macOS a socket is bound to each of the interface's addresses; `send()` sends from the one in the
  destination's network. On macOS a socket bound to an address receives neither broadcasts nor multicast:
  `addMembership()` throws a `NetIfNotSupportedException` there; on Windows the group is joined on each address.
  `setBroadcast(true)` lets the socket send broadcasts everywhere.
- Broadcasts and groups are applied again when the socket is bound again (an address changed, the interface plugged back
  in). Datagrams that arrive meanwhile are lost.
- A link-local IPv6 destination requires its scope, as for `dgram`: `fe80::1%eth1`.
- `port`, `family` and `strict` are those of `listen()`; so are `enforced`, `reason`, `port`, `addresses`, `listening`
  and the events `listening`, `error`, `enforced` and `close`.

### A socket bound to the interface

On Linux, `bindSocket()` returns a socket bound to the interface, for code that requires the server itself to listen
(its `address()` and `close()` as usual). The socket is not recreated when the interface is plugged back in: `listen()`
does that.

```typescript
import {createServer} from 'node:http'
import {type BoundSocket, NetworkInterface} from '@lakutata/netif'

const management: NetworkInterface = new NetworkInterface('eth1')
const bound: BoundSocket = management.bindSocket({port: 8080, family: 'IPv4', type: 'tcp'})
createServer((request, response) => response.end('ok')).listen({fd: bound.fd})
```

A TCP socket is returned listening, for `server.listen({fd})` of a `net.Server`; a UDP socket bound, for
`socket.bind({fd})` of a `dgram` socket. Whatever takes the descriptor owns it; close one you do not use with
`fs.closeSync(fd)`. macOS and Windows have no such socket: `bindSocket()` throws a `NetIfNotSupportedException` there.

### Systems and runtimes

- **Linux**: binding a socket to an interface requires no privilege since Linux 5.7. Before that version, the process
  requires the `CAP_NET_RAW` capability (`setcap cap_net_raw+ep` on its executable, `AmbientCapabilities=CAP_NET_RAW` in
  its systemd unit); without it the interface is listened on at its addresses, `enforced` is `false`, and `strict`
  throws.
- **Windows**: the weak host model is set per interface
  (`netsh interface ipv4 set interface "<name>" weakhostreceive=enabled`), and some software sets it (load balancers).
  `reason` names the interface whose setting takes the guarantee away, and the command that restores it.
- **macOS**: see the table above; by default, listening works as with `listen(port, host)`.
- **Bun** listens and passes the connections as Node.js does, with three differences. Its `https` server responds
  without TLS to a connection passed to it, so `listen()` refuses it in Bun (`NetIfNotSupportedException`):
  `http2.createSecureServer({key, cert, allowHTTP1: true})` and `tls.createServer()` take the connections there. Its
  servers do not close idle keep-alive connections passed to them (`keepAliveTimeout`). Its `http` server cannot take
  the descriptor of `bindSocket()`: pass it to a `net.Server` or a `dgram` socket.
- **Electron**: in the main process.
- **Worker threads**: the package works in each thread, and a thread ends without waiting for it.

### Packaging

Bundles, executables and installers made by `lakutata package` include the compiled addon
(`build/Release/netif.node`): build them on each target platform, after installing the package there.

## API

| Export | What it is |
|---|---|
| `listInterfaces()`, `NetworkInterfaceInfo`, `InterfaceAddress` | The machine's interfaces and their state; an interface (`name`, `index`, `mac`, `up`, `running`, `loopback`, `addresses`); an address (`address`, `family`, `netmask`, `cidr`, `scopeid`) |
| `NetworkInterface`, `InterfaceSelector`, `NetworkInterfaceEvents`, `AddressChange`, `WaitForAddressOptions` | A followed interface (`list`, `selector`, `present`, `name`, `index`, `mac`, `up`, `running`, `loopback`, `addresses`, `info`, `closed`, `waitForAddress`, `listen`, `createUDPSocket`, `bindSocket`, `close`); how it is specified (a name, `{mac}`, `{index}`); its events (`change`, `up`, `down`, `added`, `removed`); a change to its addresses (`addresses`, `added`, `removed`); the options of `waitForAddress()` (`family`, `timeout`) |
| `listenOn()`, `listenOnAll()`, `InterfaceListener`, `ListenOptions`, `InterfaceListenerEvents`, `ListeningAddress` | A server listening on an interface, or on several: the listener (`server`, `networkInterface`, `enforced`, `reason`, `port`, `listening`, `addresses`, `closed`, `close`), its options (`port`, `family`, `strict`, `backlog`), its events (`listening`, `error`, `enforced`, `close`), an address it is reached at (`address`, `family`, `port`, `scopeid`) |
| `InterfaceUDPSocket`, `UDPSocketOptions`, `InterfaceUDPSocketEvents` | A UDP socket on an interface (`send`, `setBroadcast`, `addMembership`, `dropMembership`, `enforced`, `reason`, `port`, `listening`, `addresses`, `closed`, `close`), its options (`port`, `family`, `strict`), its events (`message`, `listening`, `error`, `enforced`, `close`) |
| `BoundSocket`, `BindSocketOptions` | A socket bound to an interface (`fd`, `port`, `family`, `type`) and the options of `bindSocket()` (`port`, `family`, `type`, `backlog`) |

The typings document every declaration, with examples.

## Errors

| Error | When |
|---|---|
| `NetIfNotFoundException` | An index that no interface has, a hardware address that several interfaces share; `bindSocket()` while the interface does not exist |
| `NetIfNotEnforcedException` | With `strict`, the system cannot refuse what comes through another interface (also when the guarantee is lost: an `error` event); `bindSocket()` without the permission to bind (`CAP_NET_RAW` before Linux 5.7). Its message explains why and what to do |
| `NetIfNotSupportedException` | `bindSocket()` outside Linux, `addMembership()` where the addresses are bound on macOS (and on Linux without the permission), an `https` server in Bun |
| `NetIfTimeoutException` | `waitForAddress()` past its `timeout` |
| `NetIfException` | The base of all of them; a system refusal has its code as `errno` (`'EADDRINUSE'`, `'EACCES'`…), and `'E_NETIF'` is an error from the package itself (a `NetworkInterface` closed while `waitForAddress()` waits) |

A selector, a port or a family that is not one throws a `TypeError`.

## See also

- [socket(7)](https://man7.org/linux/man-pages/man7/socket.7.html): `SO_BINDTODEVICE` on Linux.
- [The strong and weak host models of
  Windows](https://learn.microsoft.com/en-us/previous-versions/technet-magazine/cc137807(v=msdn.10)).
