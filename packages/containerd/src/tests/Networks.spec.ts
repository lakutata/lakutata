import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {NetworkStore, parseIPv6Subnet, parseSubnet, type CNINetwork} from '../client/Networks.js'
import {resolvConf} from '../client/ContainerStore.js'

describe('The networks of CNI', (): void => {

    let directory: string
    let confDir: string
    let pluginDir: string
    let store: NetworkStore

    before(async (): Promise<void> => {
        directory = await mkdtemp(path.join(tmpdir(), 'lakutata-cni-'))
        confDir = path.join(directory, 'net.d')
        pluginDir = path.join(directory, 'bin')
        await mkdir(pluginDir)
        //The plugins of the tests: bridge answers the versions it supports
        for (const plugin of ['bridge', 'macvlan', 'portmap', 'tuning']) {
            await writeFile(path.join(pluginDir, plugin), '#!/bin/sh\necho \'{"cniVersion":"1.0.0","supportedVersions":["0.4.0","1.0.0"]}\'\n')
            await chmod(path.join(pluginDir, plugin), 0o755)
        }
        store = new NetworkStore(confDir, [path.join(directory, 'none'), pluginDir])
        //A network of the machine, not one of nerdctl
        await mkdir(confDir)
        await writeFile(path.join(confDir, '10-flannel.conflist'), JSON.stringify({name: 'flannel', cniVersion: '0.3.1', plugins: [{type: 'flannel', ipam: {type: 'host-local', subnet: '10.4.3.0/24'}}]}))
    })

    after(async (): Promise<void> => {
        await rm(directory, {recursive: true, force: true})
    })

    it('parses the subnets', (): void => {
        assert.deepStrictEqual(parseSubnet('10.4.1.7/24'), {network: 0x0a040100, broadcast: 0x0a0401ff, prefix: 24, cidr: '10.4.1.0/24'})
        assert.throws((): unknown => parseSubnet('10.4.1.0/31'))
        assert.throws((): unknown => parseSubnet('10.4.1.300/24'))
    })

    it('parses the subnets of IPv6', (): void => {
        assert.deepStrictEqual([parseIPv6Subnet('fd00:4:10::7/64').cidr, parseIPv6Subnet('fd00:4:10::/64').first], ['fd00:4:10::/64', 'fd00:4:10::1'])
        assert.strictEqual(parseIPv6Subnet('2001:db8::1:0:0:0/80').cidr, '2001:db8:0:0:1::/80')
        assert.throws((): unknown => parseIPv6Subnet('fd00::/127'))
        assert.throws((): unknown => parseIPv6Subnet('10.0.0.0/64'))
    })

    it('creates the networks of IPv4 and IPv6', async (): Promise<void> => {
        const dual: CNINetwork = await store.create({name: 'dual', subnet: '10.4.90.0/24', ipv6Subnet: 'fd00:4:90::/64'})
        assert.deepStrictEqual(dual.plugins[0].ipam.ranges, [[{gateway: '10.4.90.1', subnet: '10.4.90.0/24'}], [{subnet: 'fd00:4:90::/64', gateway: 'fd00:4:90::1'}]])
        assert.deepStrictEqual(dual.plugins[0].ipam.routes, [{dst: '0.0.0.0/0'}, {dst: '::/0'}])
        assert.deepStrictEqual(dual.subnets, ['10.4.90.0/24', 'fd00:4:90::/64'])
        await assert.rejects(store.create({name: 'dual2', subnet: '10.4.91.0/24', ipv6Subnet: 'fd00:4:90:0:1::/80'}), /overlaps/)
        await assert.rejects(store.create({name: 'dual3', subnet: '10.4.92.0/24', ipv6Subnet: 'fd00:4:92::/64', ipv6Gateway: 'fd00:4:93::1'}), /not in the subnet/)
        await store.render(path.join(directory, 'dual-container'), 'c2', [{network: dual, ip: '10.4.90.9', ipv6: 'fd00:4:90::9'}], [])
        assert.strictEqual(await readFile(path.join(directory, 'dual-container', 'network', '00', 'args'), 'utf8'), 'IgnoreUnknown=1;IP=10.4.90.9,fd00:4:90::9')
        await store.remove(dual)
    })

    it('creates the default network of nerdctl once it is asked', async (): Promise<void> => {
        const bridge: CNINetwork = (await store.get('bridge'))!
        assert.strictEqual(bridge.id, '17f29b073143d8cd97b5bbe492bdeffec1c5fee55cc1fe2112c8b9335f8b6121')
        assert.strictEqual(bridge.cniVersion, '1.0.0')
        assert.deepStrictEqual(bridge.subnets, ['10.4.0.0/24'])
        assert.deepStrictEqual(bridge.plugins.map((plugin: Record<string, any>): string => plugin.type), ['bridge', 'portmap', 'tuning'])
        assert.strictEqual(bridge.plugins[0].bridge, 'nerdctl0')
        assert.ok((await readFile(path.join(confDir, 'nerdctl-bridge.conflist'), 'utf8')).includes('"nerdctl/default-network": "true"'))
        await assert.rejects(store.remove(bridge), /default/)
    })

    it('creates and removes the networks, their subnets free', async (): Promise<void> => {
        const first: CNINetwork = await store.create({name: 'apps'})
        //10.4.0.0/24 is the default one, 10.4.3.0/24 the one of flannel
        assert.deepStrictEqual(first.subnets, ['10.4.1.0/24'])
        assert.deepStrictEqual(first.gateways, ['10.4.1.1'])
        assert.strictEqual(first.plugins[0].bridge, `br-${first.id.slice(0, 12)}`)
        assert.deepStrictEqual((await store.create({name: 'more'})).subnets, ['10.4.2.0/24'])
        assert.deepStrictEqual((await store.create({name: 'after', labels: {team: 'a'}})).subnets, ['10.4.4.0/24'])
        const fixed: CNINetwork = await store.create({name: 'fixed', subnet: '192.168.50.0/24', gateway: '192.168.50.254', ipRange: '192.168.50.128/25', internal: true, mtu: 1400})
        assert.deepStrictEqual(fixed.plugins[0].ipam.ranges, [[{gateway: '192.168.50.254', subnet: '192.168.50.0/24', rangeStart: '192.168.50.129', rangeEnd: '192.168.50.254'}]])
        assert.strictEqual(fixed.plugins[0].ipMasq, false)
        assert.strictEqual(fixed.plugins[0].mtu, 1400)
        await assert.rejects(store.create({name: 'apps'}), /exists/)
        await assert.rejects(store.create({name: 'overlap', subnet: '192.168.50.0/25'}), /overlaps/)
        await assert.rejects(store.create({name: 'gateway', subnet: '192.168.60.0/24', gateway: '192.168.61.1'}), /not in the subnet/)
        await assert.rejects(store.create({name: 'vlan', driver: 'macvlan'}), /parent/)
        await assert.rejects(store.create({name: 'ip', driver: 'ipvlan', parent: 'eth0'}), /not installed/)
        assert.strictEqual((await store.create({name: 'lan', driver: 'macvlan', parent: 'eth0'})).plugins[0].master, 'eth0')
        assert.deepStrictEqual((await store.list()).map((network: CNINetwork): string => network.name), ['flannel', 'after', 'apps', 'bridge', 'fixed', 'lan', 'more'])
        assert.strictEqual((await store.get(first.id.slice(0, 8)))!.name, 'apps')
        await assert.rejects(store.remove((await store.get('flannel'))!), /not one of nerdctl/)
        await store.remove(first)
        assert.strictEqual(await store.get('apps'), undefined)
    })

    it('writes the configurations of the networks of a container for its hooks', async (): Promise<void> => {
        const state: string = path.join(directory, 'container')
        await store.render(state, 'c1', [{network: (await store.get('bridge'))!, ip: '10.4.0.20'}, {network: (await store.get('more'))!}], [{hostPort: 8080, containerPort: 80, protocol: 'tcp'}])
        const first: string = path.join(state, 'network', '00')
        assert.strictEqual(await readFile(path.join(first, 'ifname'), 'utf8'), 'eth0')
        assert.strictEqual(await readFile(path.join(first, 'args'), 'utf8'), 'IgnoreUnknown=1;IP=10.4.0.20')
        assert.strictEqual(await readFile(path.join(first, 'count'), 'utf8'), '3')
        const portmap = JSON.parse(await readFile(path.join(first, '2.conf'), 'utf8') + '}')
        assert.deepStrictEqual(portmap, {type: 'portmap', name: 'bridge', cniVersion: '1.0.0', runtimeConfig: {portMappings: [{hostPort: 8080, containerPort: 80, protocol: 'tcp', hostIP: ''}]}})
        //The ports on the first network only
        assert.strictEqual(JSON.parse(await readFile(path.join(state, 'network', '01', '2.conf'), 'utf8') + '}').runtimeConfig, undefined)
        assert.strictEqual(await readFile(path.join(state, 'network', '01', 'ifname'), 'utf8'), 'eth1')
        assert.match(await readFile(path.join(state, 'network', 'env'), 'utf8'), /CNI_CONTAINERID='c1'/)
        //The result of the hook: the interface of the container, its address
        await writeFile(path.join(first, 'result.json'), JSON.stringify({
            cniVersion: '1.0.0',
            interfaces: [{name: 'nerdctl0', mac: 'aa:aa:aa:aa:aa:aa'}, {name: 'veth1', mac: 'bb:bb:bb:bb:bb:bb'}, {name: 'eth0', mac: 'cc:cc:cc:cc:cc:cc', sandbox: '/proc/1/ns/net'}],
            ips: [{interface: 2, address: '10.4.0.20/24', gateway: '10.4.0.1'}]
        }))
        assert.deepStrictEqual(await store.interfaces(state), [
            {network: 'bridge', interface: 'eth0', mac: 'cc:cc:cc:cc:cc:cc', ip: '10.4.0.20', prefixLength: 24, gateway: '10.4.0.1'},
            {network: 'more', interface: 'eth1'}
        ])
    })

    it('gives the containers on their own networks name servers they reach', (): void => {
        assert.strictEqual(resolvConf('nameserver 127.0.0.53\noptions edns0\n', true), 'options edns0\nnameserver 8.8.8.8\nnameserver 8.8.4.4\n')
        assert.strictEqual(resolvConf('nameserver 127.0.0.53\nnameserver 192.168.1.1\n', true), 'nameserver 192.168.1.1\n')
        assert.strictEqual(resolvConf('nameserver 127.0.0.53\n', false), 'nameserver 127.0.0.53\n')
    })
})
