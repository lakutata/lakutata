# @lakutata/netif

English | [中文](README.zh-CN.md)

Listen on a network interface instead of an address. `listen(port, host)` of Node.js listens on an address: the address
of a management port changes (DHCP) or is not there yet when the machine starts, and listening on `0.0.0.0` exposes the
service on every interface. With this package a server listens on "eth1", whatever its addresses: it is listened on
again when they change and when the interface is unplugged and plugged back, and on Linux the system refuses the
connections that come through another interface. Any server of Node.js works (`http`, `https`, `http2`, `tls`, Express,
Fastify), and UDP sockets too. The package also lists the interfaces of the machine with their state and tells when they
change. It is a native addon for Linux, macOS and Windows, compiled when the package is installed. It belongs to the
[lakutata](https://github.com/lakutata/lakutata) family but needs no lakutata application: import it and use it.

## Installation

```shell
npm install @lakutata/netif
```

- The addon is compiled during the installation (node-gyp), so the machine needs Python 3 and a C++17 compiler: the
  Command Line Tools of Xcode on macOS, `build-essential` on Debian and Ubuntu, the Build Tools of Visual Studio
  ("Desktop development with C++") on Windows. Alpine Linux also needs the headers of the kernel:
  `apk add python3 make g++ linux-headers`. If compiling fails, the installation fails.
- The package manager has to run the install script of the package. npm runs it, and may warn that the script is
  "not yet covered by allowScripts": `npm install-scripts approve @lakutata/netif` records that you allow it. Bun and
  pnpm run it only for the dependencies they are told to trust (`trustedDependencies` in the package.json for Bun,
  `pnpm approve-builds` for pnpm); without it, loading the package throws an error telling how to build the addon.
- Node.js `^22.13.0 || >=24.11.0`. The addon uses Node-API, so Bun and the main process of Electron load the addon
  node-gyp built for Node.js, without a rebuild.

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
returns at once and the interface is listened on as soon as it can be. While it waits, the listener keeps the process
alive, as a listening server does.

### Choosing the interface

An interface is given by its name, its hardware address or its index:

```typescript
import {NetworkInterface} from '@lakutata/netif'

const byName: NetworkInterface = new NetworkInterface('eth1')
const byHardwareAddress: NetworkInterface = new NetworkInterface({mac: '52:54:00:12:34:56'})
const byIndex: NetworkInterface = new NetworkInterface({index: 3})
```

- **The name**: `'eth1'`, `'enp3s0'`, `'en0'`. On Windows it is the name of the network connection (`'以太网 2'`,
  `'Ethernet 2'`), in the language of the system.
- **The hardware address** stays the same whatever the system names the interface: the one to give a management port
  by. Several interfaces with the same address (a bridge and its ports) throw a `NetIfNotFoundException`: give the name
  then.
  macOS 27 gives every process without a special entitlement `02:00:00:00:00:00` as the hardware address of each
  interface, so there an interface has no `mac` and cannot be found by it.
- **The index** changes when the interface is unplugged and plugged again: an index no interface has throws a
  `NetIfNotFoundException`, and the object does not follow the interface once it is unplugged.

`listenOn(selector, server, options)` is `new NetworkInterface(selector).listen(server, options)`, the interface
followed until the listener is closed.

### Which connections are refused

When the interface is listened on, the clients of its network reach the server at its addresses, and nothing is listened
on at the addresses of the other interfaces. A client of another network can still send packets for an address of the
interface through another interface (with a route of its own through the machine). Whether the system refuses those is
what `enforced` tells:

| | How the interface is listened on | `enforced` |
|---|---|---|
| Linux | Sockets bound to the interface (`SO_BINDTODEVICE`), one by family: whatever its addresses, an address added is served at once | `true`: the kernel refuses the connections that come through another interface |
| Windows | A socket on each address of the interface, again when they change | `true` while every other interface of the family receives with the strong host model and does not forward (the default): Windows then drops the packets of an address that come through another interface ([the strong host model](https://learn.microsoft.com/en-us/previous-versions/technet-magazine/cc137807(v=msdn.10))) |
| macOS | A socket on each address of the interface, again when they change | `false`: macOS accepts the packets of an address through any interface. `true` only when the system is set to refuse them (`sudo sysctl -w net.inet.ip.check_interface=2`, and `net.inet6.ip6.check_interface=2` for IPv6) and does not forward (a virtual machine or a container sharing the network turns forwarding on) |

By default the interface is listened on in the best way the system allows: it is never less than listening on its
addresses with `listen(port, host)`, and `enforced` tells whether the guarantee is there (`reason` tells why not, and
how to get it). With `strict: true`, `listen()` throws a `NetIfNotEnforcedException` where the guarantee is not there,
and the listener stops (an `error` event) while it is lost, until it is back:

```typescript
import {createServer} from 'node:http'
import {type InterfaceListener, NetworkInterface} from '@lakutata/netif'

const management: NetworkInterface = new NetworkInterface('eth1')
const listener: InterfaceListener = await management.listen(createServer(), {port: 443, strict: true})
listener.on('enforced', enforced => console.log(enforced ? 'guaranteed again' : 'no longer guaranteed'))
```

The guarantee is followed while the interface is listened on: on Windows a change of the settings of an interface is
notified; macOS sends no notification of its settings, which are read again when an interface changes.

On Linux, a socket bound to eth1 serves every connection that comes through eth1, whatever address of the machine it was
sent to; `addresses` lists the ones of eth1.

### The server and its listener

The listener accepts the connections and gives them to the server (`server.emit('connection', socket)`), which handles
them as its own: requests, keep-alive, upgrades, TLS. The server itself does not listen, so:

- `server.address()` is `null` and `server.listening` is `false`: use `listener.port` and `listener.addresses`.
- `server.close()` does not stop the listener: use `listener.close()`. Called on a server that never listened,
  `server.close()` of Node.js gives its callback `ERR_SERVER_NOT_RUNNING` (a promisified `close()` rejects);
  `fastify.close()` does not.
- A server listened on several times (two interfaces, two ports) gets the connections of each listener.

For Express, give `createServer(app)`; for Fastify, its `fastify.server` once `await fastify.ready()` has returned:

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
| `family` | `'IPv4'`, `'IPv6'` or `'both'` (by default). With `'both'`, a system without IPv6 is listened on in IPv4 |
| `strict` | `true`: refused where the system cannot refuse the connections coming through another interface. `false` by default |
| `backlog` | The length of the queue of the connections not accepted yet, 511 by default |

`listener.close()` stops listening and returns without waiting for the connections established, which are left to the
server. `NetworkInterface.close()` closes its listeners too.

### When the interface changes

| What happens | Linux (bound to the interface) | Windows, macOS |
|---|---|---|
| The interface does not exist | The listener waits; the interface is listened on when it appears | Same |
| It exists, without an address | Listened on: an address added is served at once | The listener waits for an address |
| An address is added or removed | Nothing to do | The address is listened on, or no longer. A new IPv6 address is listened on once it is usable (after its duplicate address detection, about a second) |
| The link goes down | The sockets stay; they serve again when it comes back | Same, while its addresses stay |
| It is unplugged and plugged back | Listened on again (its index changed): a `listening` event | Listened on at its addresses again |
| The port is taken | An `error` event, then another try 1 second later, the delay doubling up to 30 seconds | Same |

The connections established are left to the server whatever happens. The first listening throws its errors (a port
taken, a port below 1024 without the permission); the later ones are `error` events of the listener: **handle the
`error` event of the listener**, as for a `net.Server` (without a handler, the error is thrown and ends the process).

### The interfaces and their changes

`listInterfaces()` lists every interface of the machine, the ones without an address too, with its state: more than
`os.networkInterfaces()`, which lists only the interfaces with an address and no state. A `NetworkInterface` follows one
interface: its state now and an event at each change.

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
  of them) give the state now; while the interface does not exist, `present` is `false` and `addresses` is empty.
- The addresses are the usable ones, written as `os.networkInterfaces()` writes them: `address`, `family`, `netmask`,
  `cidr`, and for IPv6 `scopeid` (the index of the interface for a link-local address, which is written
  `fe80::…%<scopeid>` to be connected to). An IPv6 address in its duplicate address detection counts once it is usable.
- The events come from the notifications of the system (netlink on Linux, the kernel events on macOS, the notifications
  of IP Helper on Windows), not from polling, a few tens of milliseconds after the change. Every `NetworkInterface` of a
  thread shares one watcher of the system, which keeps no event loop alive.
- `waitForAddress()` gives an address the interface has, or the first one it gets; with a `timeout`, a
  `NetIfTimeoutException` when none comes.
- `close()` stops following the interface.

### UDP

`createUDPSocket()` gives a UDP socket of the interface, with the methods and the events of a `dgram` socket:

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

- On Linux its sockets (one by family) are bound to the interface: they receive what comes through it, its broadcasts
  and the multicast of the groups joined there included, whatever its addresses, and send through it. DHCP, mDNS or
  SSDP on one interface work this way.
- On Windows and macOS a socket is bound to each address of the interface; `send()` sends from the one in the network of
  the destination. On macOS a socket bound to an address receives no broadcast and no multicast: `addMembership()`
  throws a `NetIfNotSupportedException` there; on Windows the group is joined on each address. `setBroadcast(true)`
  lets the socket send broadcasts everywhere.
- The broadcasts and the groups are applied again when the socket is bound again (an address changed, the interface
  plugged back). The datagrams that arrive meanwhile are lost.
- A link-local IPv6 destination needs its scope, as for `dgram`: `fe80::1%eth1`.
- `port`, `family` and `strict` are the ones of `listen()`; `enforced`, `reason`, `port`, `addresses`, `listening` and
  the events `listening`, `error`, `enforced` and `close` too.

### A socket bound to the interface

On Linux, `bindSocket()` gives a socket bound to the interface, for the code that needs the server itself to listen (its
`address()` and `close()` as usual). The socket is not made again when the interface is plugged back: that is what
`listen()` does.

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

- **Linux**: binding a socket to an interface needs no privilege since Linux 5.7. Before it, the process needs the
  capability `CAP_NET_RAW` (`setcap cap_net_raw+ep` on its executable, `AmbientCapabilities=CAP_NET_RAW` in its systemd
  unit); without it the interface is listened on at its addresses, `enforced` is `false`, and `strict` throws.
- **Windows**: the weak host model is set by interface
  (`netsh interface ipv4 set interface "<name>" weakhostreceive=enabled`), and some software sets it (load balancers).
  `reason` names the interface whose setting takes the guarantee away, and the command that gives it back.
- **macOS**: see the table above; the listening is the one of `listen(port, host)` by default.
- **Bun** listens and gives the connections as Node.js does, with three differences. Its `https` server answers a
  connection given to it without TLS, so `listen()` refuses it in Bun (`NetIfNotSupportedException`):
  `http2.createSecureServer({key, cert, allowHTTP1: true})` and `tls.createServer()` take the connections there. Its
  servers do not close the idle keep-alive connections given to them (`keepAliveTimeout`). Its `http` server cannot take
  the descriptor of `bindSocket()`: give it to a `net.Server` or a `dgram` socket.
- **Electron**: in the main process.
- **Worker threads**: the package works in each thread, and a thread ends without waiting for it.

### Packaging

The bundles, the executables and the installers made by `lakutata package` carry the compiled addon
(`build/Release/netif.node`): build them on each target platform, after installing the package there.

## API

| Export | What it is |
|---|---|
| `listInterfaces()`, `NetworkInterfaceInfo`, `InterfaceAddress` | The interfaces of the machine and their state; an interface (`name`, `index`, `mac`, `up`, `running`, `loopback`, `addresses`); an address (`address`, `family`, `netmask`, `cidr`, `scopeid`) |
| `NetworkInterface`, `InterfaceSelector`, `NetworkInterfaceEvents`, `AddressChange`, `WaitForAddressOptions` | An interface followed (`list`, `selector`, `present`, `name`, `index`, `mac`, `up`, `running`, `loopback`, `addresses`, `info`, `closed`, `waitForAddress`, `listen`, `createUDPSocket`, `bindSocket`, `close`); how it is given (a name, `{mac}`, `{index}`); its events (`change`, `up`, `down`, `added`, `removed`); a change of its addresses (`addresses`, `added`, `removed`); the options of `waitForAddress()` (`family`, `timeout`) |
| `listenOn()`, `InterfaceListener`, `ListenOptions`, `InterfaceListenerEvents`, `ListeningAddress` | A server listening on an interface: the listener (`server`, `networkInterface`, `enforced`, `reason`, `port`, `listening`, `addresses`, `closed`, `close`), its options (`port`, `family`, `strict`, `backlog`), its events (`listening`, `error`, `enforced`, `close`), an address it is reached at (`address`, `family`, `port`, `scopeid`) |
| `InterfaceUDPSocket`, `UDPSocketOptions`, `InterfaceUDPSocketEvents` | A UDP socket of an interface (`send`, `setBroadcast`, `addMembership`, `dropMembership`, `enforced`, `reason`, `port`, `listening`, `addresses`, `closed`, `close`), its options (`port`, `family`, `strict`), its events (`message`, `listening`, `error`, `enforced`, `close`) |
| `BoundSocket`, `BindSocketOptions` | A socket bound to an interface (`fd`, `port`, `family`, `type`) and the options of `bindSocket()` (`port`, `family`, `type`, `backlog`) |

The typings document every declaration, with examples.

## Errors

| Error | When |
|---|---|
| `NetIfNotFoundException` | An index no interface has, a hardware address several interfaces have; `bindSocket()` while the interface does not exist |
| `NetIfNotEnforcedException` | With `strict`, the system cannot refuse what comes through another interface (also when the guarantee is lost: an `error` event); `bindSocket()` without the permission to bind (`CAP_NET_RAW` before Linux 5.7). Its message tells why and what to do |
| `NetIfNotSupportedException` | `bindSocket()` outside Linux, `addMembership()` where the addresses are bound on macOS (and on Linux without the permission), an `https` server in Bun |
| `NetIfTimeoutException` | `waitForAddress()` past its `timeout` |
| `NetIfException` | The base of all of them; a refusal of the system has its code as `errno` (`'EADDRINUSE'`, `'EACCES'`…), and `'E_NETIF'` is an error of the package itself (a `NetworkInterface` closed while `waitForAddress()` waits) |

A selector, a port or a family that is not one throws a `TypeError`.

## See also

- [socket(7)](https://man7.org/linux/man-pages/man7/socket.7.html): `SO_BINDTODEVICE` on Linux.
- [The strong and weak host models of Windows](https://learn.microsoft.com/en-us/previous-versions/technet-magazine/cc137807(v=msdn.10)).
