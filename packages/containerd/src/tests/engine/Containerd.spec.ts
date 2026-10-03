import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {spawnSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
import {Application} from '@lakutata/core'
import {
    Containerd,
    ContainerdContainer,
    ContainerdContainerNameConflictException,
    ContainerdContainerNotFoundException,
    ContainerdContainerStateException,
    ContainerdImage,
    ContainerdImageNotFoundException,
    ContainerdNetworkConflictException,
    ContainerdNetworkNotFoundException,
    ContainerdPlatformException,
    type ContainerdNetworkInfo,
    type ContainerdEvent,
    type ContainerdProgress
} from '../../exports/Containerd.js'
import {FormatPlatform, HostPlatform} from '../../client/Platforms.js'

/**
 * The tests run with the containerd of the machine (CONTAINERD_TEST=1, as root): in the namespace lakutata-test, they
 * pull alpine and the registry of the distribution project, create their containers, all removed after them
 */
const ENABLED: boolean = !!process.env.CONTAINERD_TEST

const SOCKET: string = process.env.CONTAINERD_TEST_SOCKET || '/run/containerd/containerd.sock'

const NAMESPACE: string = 'lakutata-test'

const ALPINE: string = 'alpine:3.20'

/**
 * The port of the registry run by the tests
 */
const REGISTRY_PORT: number = 5055

describe('The containerd component with the containerd of the machine', {skip: !ENABLED && 'CONTAINERD_TEST=1 runs them with the containerd of the machine'}, (): void => {

    let app: Application
    let containerd: Containerd
    let directory: string

    before(async (): Promise<void> => {
        directory = await mkdtemp(path.join(tmpdir(), 'lakutata-containerd-'))
        app = await new Promise<Application>((resolve: (app: Application) => void, reject: (error: Error) => void): void => {
            Application.run({
                id: 'containerd.test.app',
                name: 'containerd-test',
                components: {
                    containerd: {
                        class: Containerd,
                        socketPath: SOCKET,
                        namespace: NAMESPACE,
                        dataRoot: path.join(directory, 'data'),
                        insecureRegistries: [`localhost:${REGISTRY_PORT}`]
                    }
                },
                bootstrap: ['containerd']
            })
                .onLaunched((launched: Application): void => resolve(launched))
                .onFatalException((error: Error): void => reject(error))
        })
        containerd = await app.getObject<Containerd>('containerd')
    })

    after(async (): Promise<void> => {
        if (containerd) {
            for (const container of await containerd.listContainers()) await container.remove({force: true})
            for (const image of await containerd.listImages()) await image.remove()
            for (const network of await containerd.listNetworks()) if (network.name.startsWith('lakutata-test')) await containerd.removeNetwork(network.name)
        }
        await app?.dispose()
        await rm(directory, {recursive: true, force: true})
    })

    it('connects to containerd and detects the platforms of the machine', async (): Promise<void> => {
        assert.match((await containerd.version()).version, /^\d|^v\d/)
        assert.strictEqual(containerd.supportedPlatforms()[0], FormatPlatform(HostPlatform()))
    })

    it('pulls an image, names it again, exports and imports it', async (): Promise<void> => {
        const progress: ContainerdProgress[] = []
        const image: ContainerdImage = await containerd.pullImage({image: ALPINE, progressCallback: (item: ContainerdProgress): unknown => progress.push(item)})
        assert.strictEqual(image.name, 'docker.io/library/alpine:3.20')
        assert.strictEqual(image.platform, FormatPlatform(HostPlatform()))
        assert.deepStrictEqual(image.platforms, [image.platform])
        assert.deepStrictEqual(image.config.cmd, ['/bin/sh'])
        assert.ok(image.config.env.PATH)
        assert.ok(image.size > 1024 * 1024)
        assert.ok(progress.length > 0 && progress.every((item: ContainerdProgress): boolean => item.current <= item.total))
        assert.strictEqual((await containerd.getImage(ALPINE)).digest, image.digest)
        const tagged: ContainerdImage = await image.tag('lakutata-test/alpine:copy')
        assert.strictEqual(tagged.name, 'docker.io/lakutata-test/alpine:copy')
        const archive: string = path.join(directory, 'alpine.tar')
        await tagged.export({destination: archive})
        await tagged.remove()
        await assert.rejects(containerd.getImage('lakutata-test/alpine:copy'), ContainerdImageNotFoundException)
        const imported: ContainerdImage[] = await containerd.importImage({source: archive})
        assert.deepStrictEqual(imported.map((item: ContainerdImage): string => item.name), ['docker.io/lakutata-test/alpine:copy'])
        assert.strictEqual(imported[0].digest, image.digest)
        assert.ok((await containerd.listImages()).some((item: ContainerdImage): boolean => item.name === image.name))
    })

    it('pulls the image of another platform', async (): Promise<void> => {
        const other: string = HostPlatform().architecture === 'amd64' ? 'linux/arm64' : 'linux/amd64'
        const image: ContainerdImage = await containerd.pullImage({image: ALPINE, platform: other, unpack: containerd.supportedPlatforms().includes(other)})
        assert.ok(image.platforms.includes(other))
        assert.ok(image.platforms.includes(FormatPlatform(HostPlatform())))
        await assert.rejects(containerd.pullImage({image: ALPINE, platform: 'linux/mips'}), ContainerdPlatformException)
        if (!containerd.supportedPlatforms().includes(other)) return
        //Run by the emulator of binfmt_misc
        const container: ContainerdContainer = await containerd.createContainer({image: ALPINE, platform: other, cmd: ['uname', '-m']})
        try {
            assert.strictEqual(container.platform, other)
            await container.start()
            assert.strictEqual(await container.wait(), 0)
            let output: string = ''
            for await (const chunk of await container.logs({follow: false})) output += chunk
            assert.strictEqual(output.trim(), other === 'linux/amd64' ? 'x86_64' : 'aarch64')
        } finally {
            await container.remove({force: true})
        }
    })

    it('creates, starts, executes in, stops and removes a container', async (): Promise<void> => {
        const volume: string = path.join(directory, 'volume')
        const events: ContainerdEvent[] = []
        const abort: AbortController = new AbortController()
        const watching: Promise<void> = (async (): Promise<void> => {
            for await (const event of containerd.events(abort.signal)) events.push(event)
        })()
        const container: ContainerdContainer = await containerd.createContainer({
            image: ALPINE,
            name: 'lakutata-test-web',
            cmd: ['sh', '-c', 'trap "echo stopping; exit 3" TERM; echo started; echo $GREETING > /volume/greeting; while true; do sleep 0.1; done'],
            env: {GREETING: 'hello'},
            labels: {app: 'web'},
            binds: [{hostPath: volume, containerPath: '/volume'}],
            tmpfs: [{containerPath: '/scratch', size: 1024 * 1024}],
            network: 'none',
            memoryLimit: 64 * 1024 * 1024,
            pidsLimit: 64
        })
        try {
            assert.strictEqual(container.name, 'lakutata-test-web')
            assert.strictEqual(container.state.status, 'created')
            assert.strictEqual(container.labels.app, 'web')
            assert.strictEqual(container.labels['nerdctl/name'], 'lakutata-test-web')
            await assert.rejects(containerd.createContainer({image: ALPINE, name: 'lakutata-test-web'}), ContainerdContainerNameConflictException)
            await assert.rejects(container.exec({cmd: 'true'}), ContainerdContainerStateException)
            await container.start()
            assert.strictEqual(container.state.status, 'running')
            assert.ok(container.state.pid > 0)
            await sleep(500)
            assert.strictEqual((await readFile(path.join(volume, 'greeting'), 'utf8')).trim(), 'hello')
            assert.deepStrictEqual(await container.exec({cmd: 'echo out; echo err >&2; exit 4'}), {exitCode: 4, stdout: 'out\n', stderr: 'err\n'})
            assert.deepStrictEqual(await container.exec({cmd: ['cat'], stdin: 'input'}), {exitCode: 0, stdout: 'input', stderr: ''})
            assert.strictEqual((await container.exec({cmd: ['id', '-u'], user: 'nobody'})).stdout.trim(), '65534')
            assert.strictEqual((await container.exec({cmd: 'cat /sys/fs/cgroup/memory.max 2>/dev/null || cat /sys/fs/cgroup/memory/memory.limit_in_bytes'})).stdout.trim(), String(64 * 1024 * 1024))
            assert.strictEqual((await container.exec({cmd: 'cat /sys/fs/cgroup/pids.max 2>/dev/null || cat /sys/fs/cgroup/pids/pids.max'})).stdout.trim(), '64')
            //A network namespace of its own: its loopback, not the interfaces of the host (the kernel adds its tunnels)
            const interfaces: string[] = (await container.exec({cmd: 'ls /sys/class/net'})).stdout.split(/\s+/)
            assert.ok(interfaces.includes('lo') && !interfaces.includes('eth0'), interfaces.join())
            assert.ok((await container.processes()).includes(container.state.pid))
            assert.strictEqual((await containerd.getContainer(container.id.slice(0, 12))).id, container.id)
            assert.deepStrictEqual((await containerd.listContainers({app: 'web'})).map((item: ContainerdContainer): string => item.id), [container.id])
            await container.pause()
            assert.strictEqual(container.state.status, 'paused')
            await container.unpause()
            await container.stop({timeout: 5})
            assert.strictEqual(container.state.status, 'exited')
            assert.strictEqual(container.state.exitCode, 3)
            let logs: string = ''
            for await (const chunk of await container.logs({follow: false})) logs += chunk
            assert.strictEqual(logs, 'started\nstopping\n')
            logs = ''
            for await (const chunk of await container.logs({tail: 1})) logs += chunk
            assert.strictEqual(logs, 'stopping\n')
            await container.restart({timeout: 1})
            assert.strictEqual(container.state.status, 'running')
            await assert.rejects(container.remove(), ContainerdContainerStateException)
        } finally {
            await container.remove({force: true})
            await sleep(200)
            abort.abort()
            await watching
        }
        await assert.rejects(containerd.getContainer('lakutata-test-web'), ContainerdContainerNotFoundException)
        const topics: string[] = events.filter((event: ContainerdEvent): boolean => event.event.containerId === container.id || event.event.id === container.id).map((event: ContainerdEvent): string => event.topic)
        for (const topic of ['/containers/create', '/tasks/start', '/tasks/exit', '/tasks/delete', '/containers/delete']) assert.ok(topics.includes(topic), topic)
    })

    it('restarts the containers by their restart policies', async (): Promise<void> => {
        const container: ContainerdContainer = await containerd.createContainer({image: ALPINE, cmd: ['sh', '-c', 'echo run; sleep 0.5; exit 1'], restartPolicy: 'always'})
        try {
            await container.start()
            assert.strictEqual(container.restartPolicy, 'always')
            //The restart monitor of containerd checks every 10 seconds
            let runs: number = 0
            for (let attempt = 0; attempt < 30 && runs < 2; attempt++) {
                await sleep(1000)
                runs = 0
                for await (const chunk of await container.logs({follow: false})) runs += String(chunk).split('\n').filter((line: string): boolean => line === 'run').length
            }
            assert.ok(runs >= 2, `${runs} runs`)
            await container.stop({timeout: 1})
            await sleep(11000)
            await container.syncContainerInfo()
            assert.strictEqual(container.state.status, 'exited')
        } finally {
            await container.remove({force: true})
        }
    })

    it('pushes an image to a registry and pulls it back', async (): Promise<void> => {
        const registry: ContainerdContainer = await containerd.createContainer({
            image: (await containerd.pullImage({image: 'registry:2'})).name,
            name: 'lakutata-test-registry',
            env: {REGISTRY_HTTP_ADDR: `127.0.0.1:${REGISTRY_PORT}`},
            tmpfs: [{containerPath: '/var/lib/registry'}]
        })
        try {
            await registry.start()
            for (let attempt = 0; attempt < 50; attempt++) {
                if (await fetch(`http://localhost:${REGISTRY_PORT}/v2/`).then((response: Response): boolean => response.ok, (): boolean => false)) break
                await sleep(200)
            }
            const reference: string = `localhost:${REGISTRY_PORT}/lakutata-test/alpine:pushed`
            const image: ContainerdImage = await containerd.getImage(ALPINE)
            await image.push({reference: reference, platform: FormatPlatform(HostPlatform())})
            const tags = await (await fetch(`http://localhost:${REGISTRY_PORT}/v2/lakutata-test/alpine/tags/list`)).json() as { tags: string[] }
            assert.deepStrictEqual(tags.tags, ['pushed'])
            const pulled: ContainerdImage = await containerd.pullImage({image: reference})
            assert.strictEqual(pulled.name, reference)
            assert.strictEqual(pulled.config.cmd.join(), image.config.cmd.join())
            const container: ContainerdContainer = await containerd.createContainer({image: reference, cmd: ['true']})
            await container.start()
            assert.strictEqual(await container.wait(), 0)
            await container.remove()
        } finally {
            await registry.remove({force: true})
        }
    })

    it('connects the containers to the networks of CNI and publishes their ports', async (): Promise<void> => {
        const server: string[] = ['sh', '-c', 'while true; do printf "HTTP/1.0 200 OK\\r\\n\\r\\n$(hostname)\\n" | nc -l -p 80 >/dev/null; done']
        const web: ContainerdContainer = await containerd.createContainer({image: ALPINE, name: 'lakutata-test-web', networks: [{networkName: 'bridge'}], ports: [{port: 80, hostPorts: [18080, 18081]}], cmd: server})
        try {
            assert.deepStrictEqual(web.networkNames, ['bridge'])
            assert.deepStrictEqual(web.ports, [{host: '0.0.0.0', port: 80, type: 'tcp', hostPorts: [18080, 18081]}])
            assert.deepStrictEqual(web.networks.map((network): string => network.ip), [''])
            await web.start()
            const [network] = web.networks
            assert.strictEqual(network.networkName, 'bridge')
            assert.strictEqual(network.interface, 'eth0')
            assert.match(network.ip, /^10\.4\.0\.\d+$/)
            assert.strictEqual(network.gateway, '10.4.0.1')
            assert.match(network.mac, /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/)
            assert.strictEqual(web.hostname, web.id.slice(0, 12))
            assert.strictEqual((await containerd.getNetwork('bridge')).reserved, true)
            let answer: string = ''
            for (let attempt = 0; attempt < 20 && !answer; attempt++) {
                answer = await fetch('http://127.0.0.1:18081/').then((response: Response): Promise<string> => response.text(), async (): Promise<string> => {
                    await sleep(200)
                    return ''
                })
            }
            assert.strictEqual(answer.trim(), web.hostname)
            //Its own network: its address in its /etc/hosts
            assert.match((await web.exec({cmd: 'cat /etc/hosts'})).stdout, new RegExp(`${network.ip.replace(/\./g, '\\.')}\t${web.hostname}`))
            //A network created: the containers of the network reach each other, the ones of the other network do not
            const created: ContainerdNetworkInfo = await containerd.createNetwork({name: 'lakutata-test-net', subnet: '10.4.200.0/24', labels: {test: 'yes'}})
            assert.deepStrictEqual([created.driver, created.subnets, created.gateways, created.labels, created.reserved], ['bridge', ['10.4.200.0/24'], ['10.4.200.1'], {test: 'yes'}, false])
            await assert.rejects(containerd.createNetwork({name: 'lakutata-test-net'}), ContainerdNetworkConflictException)
            await assert.rejects(containerd.createContainer({image: ALPINE, networks: [{networkName: 'lakutata-test-none'}]}), ContainerdNetworkNotFoundException)
            const backend: ContainerdContainer = await containerd.createContainer({image: ALPINE, name: 'lakutata-test-backend', networks: [{networkName: 'lakutata-test-net', ip: '10.4.200.50'}], cmd: server})
            const client: ContainerdContainer = await containerd.createContainer({image: ALPINE, name: 'lakutata-test-client', networks: [{networkName: 'lakutata-test-net'}, {networkName: 'bridge'}], cmd: ['sleep', '600']})
            try {
                await backend.start()
                await client.start()
                assert.strictEqual(backend.networks[0].ip, '10.4.200.50')
                assert.deepStrictEqual(client.networks.map((item): string => `${item.networkName}:${item.interface}`), ['lakutata-test-net:eth0', 'bridge:eth1'])
                assert.strictEqual((await client.exec({cmd: 'wget -qO- -T 5 http://10.4.200.50/'})).stdout.trim(), backend.hostname)
                assert.strictEqual((await client.exec({cmd: `wget -qO- -T 5 http://${network.ip}/`})).stdout.trim(), web.hostname)
                assert.notStrictEqual((await web.exec({cmd: 'wget -qO- -T 2 http://10.4.200.50/'})).exitCode, 0)
                await assert.rejects(containerd.removeNetwork('lakutata-test-net'), ContainerdNetworkConflictException)
            } finally {
                await backend.remove({force: true})
                await client.remove({force: true})
            }
            const bridge: string = `br-${created.id.slice(0, 12)}`
            assert.ok(existsSync(`/sys/class/net/${bridge}`))
            await containerd.removeNetwork('lakutata-test-net')
            await assert.rejects(containerd.getNetwork('lakutata-test-net'), ContainerdNetworkNotFoundException)
            //Its bridge and the rules of its firewall removed (with the ip command of the system)
            if (spawnSync('ip', ['-V']).error === undefined) assert.ok(!existsSync(`/sys/class/net/${bridge}`))
            assert.ok(!spawnSync('iptables', ['-S'], {encoding: 'utf8'}).stdout.includes(bridge))
            //Stopped: its address released, given again at its start
            await web.stop({timeout: 1})
            assert.strictEqual(web.networks[0].ip, '')
            await web.start()
            assert.match(web.networks[0].ip, /^10\.4\.0\.\d+$/)
        } finally {
            await web.remove({force: true})
        }
    })

    it('writes the state of the containers where its data root is', async (): Promise<void> => {
        const container: ContainerdContainer = await containerd.createContainer({image: ALPINE, cmd: ['true'], hostname: 'box', extraHosts: {'db.local': '10.0.0.2'}, dns: ['10.0.0.53']})
        try {
            const state: string = container.labels['nerdctl/state-dir']
            assert.ok(state.startsWith(path.join(directory, 'data')))
            assert.match(await readFile(path.join(state, 'hosts'), 'utf8'), /10\.0\.0\.2\tdb\.local/)
            assert.strictEqual(await readFile(path.join(state, 'resolv.conf'), 'utf8'), 'nameserver 10.0.0.53\n')
            assert.strictEqual(await readFile(path.join(state, 'hostname'), 'utf8'), 'box\n')
        } finally {
            await container.remove()
        }
        await assert.rejects(readFile(path.join(container.labels['nerdctl/state-dir'], 'hosts')))
    })
})
