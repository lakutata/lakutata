# @lakutata/netif

Listen on a network interface instead of an address. This package is being written: it lists the interfaces of the
machine, follows one of them, listens on it for a server and binds UDP sockets to it.

## Installation

```bash
npm install @lakutata/netif
```

The package is a native addon, compiled when it is installed: it needs a C++ compiler and Python (the tools of
node-gyp), and on Alpine Linux the headers of the kernel (`apk add python3 make g++ linux-headers`).

## Usage

```typescript
import {createServer} from 'node:http'
import {listInterfaces, NetworkInterface} from '@lakutata/netif'

for (const entry of listInterfaces()) {
    console.log(entry.name, entry.index, entry.running, entry.addresses.map(address => address.cidr))
}

const management: NetworkInterface = new NetworkInterface('eth1')
management.on('change', ({added, removed}) => console.log('added', added, 'removed', removed))
const server = createServer((request, response) => response.end('ok'))
const listener = await management.listen(server, {port: 8080})
```

## API

- `listInterfaces()`: the network interfaces of the machine, the ones without an address too, with their name,
  index, hardware address, state and usable addresses.
- `new NetworkInterface(selector)`: an interface followed by its name, `{mac}` or `{index}`: its state and addresses,
  the events `change`, `up`, `down`, `added` and `removed`, `waitForAddress()`, `listen()`, `createUDPSocket()` and
  `bindSocket()`.
- `listenOn(selector, server, options)`: `listen()` on an interface followed until the listener is closed.
