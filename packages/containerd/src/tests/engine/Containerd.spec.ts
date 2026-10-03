import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
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
    ContainerdPlatformException,
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
