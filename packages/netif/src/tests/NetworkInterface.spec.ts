import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawnSync} from 'node:child_process'
import {Worker} from 'node:worker_threads'
import {
    type InterfaceAddress,
    listInterfaces,
    NetIfException,
    NetIfNotFoundException,
    NetIfTimeoutException,
    NetworkInterface,
    type NetworkInterfaceInfo
} from '../exports/Netif.js'
import {changesOf} from '../lib/NetworkInterface.js'

//A URL: import() takes no path of Windows
const EXPORTS: string = new URL('../exports/Netif.js', import.meta.url).href

/**
 * The loopback interface, found by its address
 */
function loopback(): NetworkInterfaceInfo {
    return listInterfaces().find((entry: NetworkInterfaceInfo): boolean => entry.addresses.some((address: InterfaceAddress): boolean => address.address === '127.0.0.1'))!
}

/**
 * A name no interface has
 */
function absentName(): string {
    const names: Set<string> = new Set(listInterfaces().map((entry: NetworkInterfaceInfo): string => entry.name))
    let name: string = 'netif-test0'
    while (names.has(name)) name += '0'
    return name
}

describe('A NetworkInterface', (): void => {

    it('follows an interface by its name and by its index', (): void => {
        const entry: NetworkInterfaceInfo = loopback()
        for (const selector of [entry.name, {index: entry.index}]) {
            const followed: NetworkInterface = new NetworkInterface(selector)
            try {
                assert.strictEqual(followed.present, true)
                assert.strictEqual(followed.name, entry.name)
                assert.strictEqual(followed.index, entry.index)
                assert.strictEqual(followed.loopback, true)
                assert.strictEqual(followed.up, true)
                assert.ok(followed.addresses.some((address: InterfaceAddress): boolean => address.address === '127.0.0.1'))
                assert.strictEqual(followed.info!.name, entry.name)
            } finally {
                followed.close()
            }
            assert.strictEqual(followed.closed, true)
        }
    })

    it('can be an interface that does not exist yet', (): void => {
        const followed: NetworkInterface = new NetworkInterface(absentName())
        try {
            assert.strictEqual(followed.present, false)
            assert.strictEqual(followed.name, undefined)
            assert.strictEqual(followed.index, undefined)
            assert.strictEqual(followed.running, false)
            assert.deepStrictEqual(followed.addresses, [])
            assert.strictEqual(followed.info, undefined)
        } finally {
            followed.close()
        }
    })

    it('throws for an index no interface has', (): void => {
        const highest: number = Math.max(...listInterfaces().map((entry: NetworkInterfaceInfo): number => entry.index))
        assert.throws((): NetworkInterface => new NetworkInterface({index: highest + 1000}), NetIfNotFoundException)
    })

    it('rejects the selectors that are not ones', (): void => {
        assert.throws((): NetworkInterface => new NetworkInterface(''), TypeError)
        assert.throws((): NetworkInterface => new NetworkInterface({mac: '52:54:00:12:34'}), TypeError)
        assert.throws((): NetworkInterface => new NetworkInterface({index: 0}), TypeError)
        assert.throws((): NetworkInterface => new NetworkInterface({} as {index: number}), TypeError)
    })

    it('normalizes a hardware address', (): void => {
        const followed: NetworkInterface = new NetworkInterface({mac: '52-54-00-AB-CD-EF'})
        try {
            assert.deepStrictEqual(followed.selector, {mac: '52:54:00:ab:cd:ef'})
        } finally {
            followed.close()
        }
    })

    it('gives an address it has at once, waits for one it has not', async (): Promise<void> => {
        const present: NetworkInterface = new NetworkInterface(loopback().name)
        const absent: NetworkInterface = new NetworkInterface(absentName())
        try {
            assert.strictEqual((await present.waitForAddress({family: 'IPv4'})).address, '127.0.0.1')
            await assert.rejects(absent.waitForAddress({timeout: 50}), NetIfTimeoutException)
            const waiting: Promise<InterfaceAddress> = absent.waitForAddress()
            absent.close()
            await assert.rejects(waiting, NetIfException)
            await assert.rejects(absent.waitForAddress(), NetIfException)
        } finally {
            present.close()
            absent.close()
        }
    })

    it('does not keep the process alive', (): void => {
        const code: string = `import(${JSON.stringify(EXPORTS)}).then(({NetworkInterface}) => { globalThis.followed = new NetworkInterface('lo'); globalThis.other = new NetworkInterface('netif-test0') })`
        const run = spawnSync(process.execPath, ['-e', code], {timeout: 20000, encoding: 'utf8'})
        assert.strictEqual(run.signal, null, 'the process was still running')
        assert.strictEqual(run.status, 0, run.stderr)
    })

    it('is followed in a worker thread, which can be terminated meanwhile', async (): Promise<void> => {
        for (let round: number = 0; round < 5; round++) {
            const worker: Worker = new Worker(`import(${JSON.stringify(EXPORTS)}).then(({NetworkInterface}) => { globalThis.followed = new NetworkInterface('lo'); require('node:worker_threads').parentPort.postMessage('following') })`, {eval: true})
            await new Promise((resolve: (value: unknown) => void, reject: (error: Error) => void): void => {
                worker.once('message', resolve)
                worker.once('error', reject)
            })
            await worker.terminate()
        }
        const followed: NetworkInterface = new NetworkInterface(loopback().name)
        assert.strictEqual(followed.present, true)
        followed.close()
    })
})

describe('The changes of an interface', (): void => {

    const base: NetworkInterfaceInfo = {
        name: 'eth1',
        index: 3,
        up: true,
        running: false,
        loopback: false,
        addresses: [{address: '192.168.10.2', family: 'IPv4', netmask: '255.255.255.0', cidr: '192.168.10.2/24'}]
    }

    it('are the interface appearing and disappearing', (): void => {
        assert.deepStrictEqual(changesOf(undefined, base), {appeared: true, disappeared: false, up: false, down: false, added: base.addresses, removed: []})
        assert.deepStrictEqual(changesOf(base, undefined), {appeared: false, disappeared: true, up: false, down: false, added: [], removed: base.addresses})
    })

    it('are its link coming up and going down', (): void => {
        const running: NetworkInterfaceInfo = {...base, running: true}
        assert.strictEqual(changesOf(base, running).up, true)
        assert.strictEqual(changesOf(running, base).down, true)
        assert.strictEqual(changesOf(undefined, running).up, true)
    })

    it('are its addresses added and removed, by address and scope', (): void => {
        const linkLocal: InterfaceAddress = {address: 'fe80::1', family: 'IPv6', netmask: 'ffff:ffff:ffff:ffff::', cidr: 'fe80::1/64', scopeid: 3}
        const renumbered: NetworkInterfaceInfo = {...base, index: 4, addresses: [base.addresses[0], {...linkLocal, scopeid: 4}]}
        const before: NetworkInterfaceInfo = {...base, addresses: [base.addresses[0], linkLocal]}
        const changes = changesOf(before, renumbered)
        assert.deepStrictEqual(changes.added, [{...linkLocal, scopeid: 4}])
        assert.deepStrictEqual(changes.removed, [linkLocal])
        assert.deepStrictEqual(changesOf(before, before), {appeared: false, disappeared: false, up: false, down: false, added: [], removed: []})
    })
})
