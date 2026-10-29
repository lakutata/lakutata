import {describe, it} from 'node:test'
import assert from 'node:assert'
import os from 'node:os'
import {type InterfaceAddress, listInterfaces, type NetworkInterfaceInfo} from '../exports/Netif.js'
import {netmaskOf} from '../lib/Snapshot.js'

describe('The interfaces of the machine', (): void => {

    it('include the loopback, found by its address', (): void => {
        const loopback: NetworkInterfaceInfo | undefined = listInterfaces()
            .find((entry: NetworkInterfaceInfo): boolean => entry.addresses.some((address: InterfaceAddress): boolean => address.address === '127.0.0.1'))
        assert.ok(loopback, 'no interface has 127.0.0.1')
        assert.strictEqual(loopback.loopback, true)
        assert.strictEqual(loopback.up, true)
        assert.ok(loopback.index > 0)
        const address: InterfaceAddress = loopback.addresses.find((entry: InterfaceAddress): boolean => entry.address === '127.0.0.1')!
        assert.deepStrictEqual(address, {address: '127.0.0.1', family: 'IPv4', netmask: '255.0.0.0', cidr: '127.0.0.1/8'})
    })

    it('have the addresses os.networkInterfaces() gives', (): void => {
        const listed: Map<string, NetworkInterfaceInfo> = new Map(listInterfaces().map((entry: NetworkInterfaceInfo): [string, NetworkInterfaceInfo] => [entry.name, entry]))
        for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
            const entry: NetworkInterfaceInfo | undefined = listed.get(name)
            assert.ok(entry, `${name} not listed`)
            for (const address of addresses ?? []) {
                //The IPv6 addresses of Node.js have their scope removed too
                const found: InterfaceAddress | undefined = entry.addresses.find((own: InterfaceAddress): boolean => own.address === address.address)
                //Node.js lists the tentative addresses, which are not usable yet
                if (!found && address.family === 'IPv6') continue
                assert.ok(found, `${name}: ${address.address} not listed`)
                assert.strictEqual(found.family, address.family)
                assert.strictEqual(found.netmask, address.netmask)
                assert.strictEqual(found.cidr, address.cidr)
                if (address.family === 'IPv6') assert.strictEqual(found.scopeid, address.scopeid, `${name}: the scope of ${address.address}`)
            }
        }
    })

    it('give a link-local IPv6 address the index of its interface as its scope', (): void => {
        for (const entry of listInterfaces()) {
            for (const address of entry.addresses) {
                if (address.family === 'IPv6' && address.address.startsWith('fe80:')) assert.strictEqual(address.scopeid, entry.index, `${entry.name}: ${address.address}`)
            }
        }
    })

    it('have their state and hardware address of the right types', (): void => {
        for (const entry of listInterfaces()) {
            assert.strictEqual(typeof entry.name, 'string')
            assert.ok(Number.isInteger(entry.index))
            assert.strictEqual(typeof entry.up, 'boolean')
            assert.strictEqual(typeof entry.running, 'boolean')
            if (entry.mac !== undefined) assert.match(entry.mac, /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/)
        }
    })
})

describe('The netmasks', (): void => {

    it('are written as os.networkInterfaces() writes them', (): void => {
        assert.strictEqual(netmaskOf('IPv4', 24), '255.255.255.0')
        assert.strictEqual(netmaskOf('IPv4', 0), '0.0.0.0')
        assert.strictEqual(netmaskOf('IPv4', 32), '255.255.255.255')
        assert.strictEqual(netmaskOf('IPv4', 20), '255.255.240.0')
        assert.strictEqual(netmaskOf('IPv6', 64), 'ffff:ffff:ffff:ffff::')
        assert.strictEqual(netmaskOf('IPv6', 128), 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')
        assert.strictEqual(netmaskOf('IPv6', 0), '::')
        assert.strictEqual(netmaskOf('IPv6', 10), 'ffc0::')
        assert.strictEqual(netmaskOf('IPv6', 120), 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ff00')
    })
})
