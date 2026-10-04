import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {spawnSync} from 'node:child_process'
import {createReadStream, createWriteStream, existsSync} from 'node:fs'
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises'
import {pipeline} from 'node:stream/promises'
import {extract as tarExtract, type Header} from 'tar-stream'
import type {Readable} from 'node:stream'
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
    ContainerdContainerTTY,
    ContainerdVolumeInUseException,
    ContainerdImage,
    ContainerdImageBuildException,
    ContainerdImageNotFoundException,
    ContainerdNetworkConflictException,
    ContainerdNetworkNotFoundException,
    ContainerdPlatformException,
    type ContainerdNetworkInfo,
    type ContainerCreateOptions,
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
 * The addresses of the BuildKit daemons the builds are tested with (CONTAINERD_TEST_BUILDKIT, separated by commas: a
 * local one, unix:///run/buildkit/buildkitd.sock, a remote one, tcp://host:1234)
 */
const BUILDKITS: string[] = (process.env.CONTAINERD_TEST_BUILDKIT ?? '').split(',').map((address: string): string => address.trim()).filter(Boolean)

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
                    },
                    //The components of the BuildKit daemons tested, and of one which is not there
                    ...Object.fromEntries([...BUILDKITS, `unix://${path.join(directory, 'none.sock')}`].map((address: string, index: number): [string, object] => [`builder${index}`, {
                        class: Containerd,
                        socketPath: SOCKET,
                        namespace: NAMESPACE,
                        dataRoot: path.join(directory, 'data'),
                        buildkitAddress: address
                    }]))
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

    it('filters the system calls of the containers by seccomp', async (): Promise<void> => {
        const created: ContainerdContainer[] = []
        const run = async (options: Partial<ContainerCreateOptions>): Promise<ContainerdContainer> => {
            const container: ContainerdContainer = await containerd.createContainer({image: ALPINE, cmd: ['sleep', '600'], network: 'none', ...options})
            created.push(container)
            await container.start()
            return container
        }
        const seccomp = async (container: ContainerdContainer): Promise<string> => (await container.exec({cmd: 'grep ^Seccomp: /proc/self/status'})).stdout.split(/\s+/)[1]
        try {
            //The default profile: unshare refused (EPERM)
            const confined: ContainerdContainer = await run({})
            assert.strictEqual(await seccomp(confined), '2')
            const refused = await confined.exec({cmd: 'unshare -u true'})
            assert.notStrictEqual(refused.exitCode, 0)
            assert.match(refused.stderr, /not permitted/i)
            assert.strictEqual((await confined.exec({cmd: 'echo allowed'})).stdout, 'allowed\n')
            //CAP_SYS_ADMIN: its system calls allowed by the profile
            const admin: ContainerdContainer = await run({capabilities: ['SYS_ADMIN']})
            assert.strictEqual(await seccomp(admin), '2')
            assert.strictEqual((await admin.exec({cmd: 'unshare -u true'})).exitCode, 0)
            //Unconfined, privileged: no filter
            assert.strictEqual(await seccomp(await run({seccompProfile: 'unconfined'})), '0')
            assert.strictEqual(await seccomp(await run({privileged: true})), '0')
            //A profile of a file: mkdir refused
            const profile: string = path.join(directory, 'seccomp.json')
            await writeFile(profile, JSON.stringify({defaultAction: 'SCMP_ACT_ALLOW', syscalls: [{names: ['mkdir', 'mkdirat'], action: 'SCMP_ACT_ERRNO'}]}))
            const custom: ContainerdContainer = await run({seccompProfile: profile})
            assert.notStrictEqual((await custom.exec({cmd: 'mkdir /tmp/refused'})).exitCode, 0)
            assert.strictEqual((await custom.exec({cmd: 'unshare -u true'})).exitCode, 1)
            await assert.rejects(containerd.createContainer({image: ALPINE, seccompProfile: path.join(directory, 'none.json')}), /seccomp/)
        } finally {
            for (const container of created) await container.remove({force: true})
        }
    })

    it('gives the devices of the host to the containers, the ones plugged after their starts by their rules', async (): Promise<void> => {
        //The devices of the tests: the one of FUSE (10:229, not allowed by runc by default, unlike TUN), created where
        //the tests want it
        const devices: string = path.join(directory, 'devices')
        const hot: string = path.join(directory, 'hot')
        await mkdir(devices, {recursive: true})
        await mkdir(hot, {recursive: true})
        assert.strictEqual(spawnSync('mknod', [path.join(devices, 'fuse'), 'c', '10', '229']).status, 0)
        const open: string = 'test -c /dev/extra/fuse && exec 3<>/dev/extra/fuse && echo opened'
        const created: ContainerdContainer[] = []
        const run = async (options: Partial<ContainerCreateOptions>): Promise<ContainerdContainer> => {
            const container: ContainerdContainer = await containerd.createContainer({image: ALPINE, cmd: ['sleep', '600'], network: 'none', ...options})
            created.push(container)
            await container.start()
            return container
        }
        try {
            //A device given: its node in the /dev of the container, allowed by its cgroup
            const given: ContainerdContainer = await run({devices: [{hostPath: path.join(devices, 'fuse'), containerPath: '/dev/extra/fuse'}]})
            assert.match((await given.exec({cmd: 'ls -l /dev/extra/fuse'})).stdout, /^c.* 10,\s*229 /)
            assert.strictEqual((await given.exec({cmd: open})).stdout, 'opened\n')
            //Plugged after the start in a directory bound: opened with the rule of its major number, refused without it
            const ruled: ContainerdContainer = await run({binds: [{hostPath: hot, containerPath: '/dev/extra'}], deviceCgroupRules: ['c 10:* rwm']})
            const unruled: ContainerdContainer = await run({binds: [{hostPath: hot, containerPath: '/dev/extra'}]})
            assert.notStrictEqual((await ruled.exec({cmd: open})).exitCode, 0)
            assert.strictEqual(spawnSync('mknod', [path.join(hot, 'fuse'), 'c', '10', '229']).status, 0)
            assert.strictEqual((await ruled.exec({cmd: open})).stdout, 'opened\n')
            const refused = await unruled.exec({cmd: open})
            assert.notStrictEqual(refused.exitCode, 0)
            assert.match(refused.stderr, /not permitted/i)
        } finally {
            for (const container of created) await container.remove({force: true})
        }
    })

    it('gives the resources the containers use, updates them while they run', async (): Promise<void> => {
        const container: ContainerdContainer = await containerd.createContainer({image: ALPINE, name: 'lakutata-test-busy', cmd: ['sh', '-c', 'while true; do :; done'], network: 'none', memoryLimit: 64 * 1024 * 1024})
        try {
            await container.start()
            const stats = await container.stats(500)
            assert.ok(stats.cpu.percent > 50, `${stats.cpu.percent}%`)
            assert.ok(stats.cpu.usage > 0 && stats.memory.usage > 0)
            assert.strictEqual(stats.memory.limit, 64 * 1024 * 1024)
            assert.ok(stats.pids.current >= 1)
            await assert.rejects((await containerd.createContainer({image: ALPINE, cmd: ['true']})).stats(), ContainerdContainerStateException)
            //Updated while it runs: its cgroup, its specification, its restart policy
            const pid: number = container.state.pid
            await container.update({memoryLimit: 32 * 1024 * 1024, pidsLimit: 20, restartPolicy: 'always'})
            assert.strictEqual(container.state.pid, pid)
            assert.strictEqual((await container.exec({cmd: 'cat /sys/fs/cgroup/memory.max'})).stdout.trim(), String(32 * 1024 * 1024))
            assert.strictEqual((await container.exec({cmd: 'cat /sys/fs/cgroup/pids.max'})).stdout.trim(), '20')
            assert.strictEqual(container.restartPolicy, 'always')
            assert.strictEqual(container.labels['containerd.io/restart.status'], 'running')
            await container.update({restartPolicy: 'no'})
            assert.strictEqual(container.labels['containerd.io/restart.policy'], undefined)
            //Its other settings: created again with them, its name kept, started again
            const old: string = container.id
            await container.update({env: {MODE: 'updated'}})
            assert.notStrictEqual(container.id, old)
            assert.strictEqual(container.name, 'lakutata-test-busy')
            assert.strictEqual(container.state.status, 'running')
            //The resources updated before kept
            assert.strictEqual((await container.exec({cmd: 'echo $MODE; cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/pids.max'})).stdout, `updated\n${32 * 1024 * 1024}\n20\n`)
            await assert.rejects(containerd.getContainer(old), ContainerdContainerNotFoundException)
            //A setting which fails: the old container kept with its name
            const current: string = container.id
            await assert.rejects(container.update({image: 'lakutata-test/none:1'}))
            assert.strictEqual((await containerd.getContainer('lakutata-test-busy')).id, current)
        } finally {
            for (const item of await containerd.listContainers()) if (item.name.startsWith('lakutata-test-busy') || item.state.status === 'created') await item.remove({force: true})
        }
    })

    it('opens terminals in the containers', async (): Promise<void> => {
        const container: ContainerdContainer = await containerd.createContainer({image: ALPINE, cmd: ['sleep', '600'], network: 'none'})
        try {
            await container.start()
            const tty: ContainerdContainerTTY = await container.createTTY({consoleSize: {cols: 100, rows: 30}})
            let output: string = ''
            tty.onData((chunk: Buffer): unknown => output += chunk.toString())
            const until = async (pattern: RegExp): Promise<void> => {
                for (let attempt = 0; attempt < 50 && !pattern.test(output); attempt++) await sleep(100)
                assert.match(output, pattern)
            }
            tty.write('stty size; tty\n')
            await until(/30 100/)
            await until(/\/dev\/pts\/\d+/)
            await tty.resize({cols: 120, rows: 40})
            tty.write('stty size\n')
            await until(/40 120/)
            tty.write('exit 5\n')
            assert.strictEqual(await tty.wait(), 5)
            //Closed while its process runs: killed
            const other: ContainerdContainerTTY = await container.createTTY({cmd: ['sleep', '600']})
            await other.close()
            assert.strictEqual(await other.wait(), 137)
        } finally {
            await container.remove({force: true})
        }
    })

    it('commits the containers, exports their directories', async (): Promise<void> => {
        const volume: string = path.join(directory, 'export-volume')
        await mkdir(volume, {recursive: true})
        await writeFile(path.join(volume, 'mounted.txt'), 'mounted')
        const container: ContainerdContainer = await containerd.createContainer({image: ALPINE, cmd: ['sh', '-c', 'mkdir -p /data/sub && echo committed > /data/sub/file && ln -s /data/sub /data/link && rm /etc/motd && sleep 600'], network: 'none', binds: [{hostPath: volume, containerPath: '/mnt/volume'}]})
        const entries = async (archive: string): Promise<Record<string, string>> => {
            const found: Record<string, string> = {}
            const extract = tarExtract()
            extract.on('entry', (header: Header, entry: unknown, next: () => void): void => {
                const stream: Readable = entry as Readable
                let content: string = ''
                stream.on('data', (chunk: Buffer): unknown => content += chunk)
                stream.on('end', (): void => {
                    found[header.name] = header.type === 'symlink' ? `-> ${header.linkname}` : header.type === 'directory' ? '/' : content
                    next()
                })
            })
            await pipeline(createReadStream(archive), extract)
            return found
        }
        try {
            await container.start()
            await sleep(500)
            //Running: its file system with its mounts, its links resolved in it
            await container.exportDirectory({path: '/data', destination: path.join(directory, 'data.tar')})
            assert.deepStrictEqual(await entries(path.join(directory, 'data.tar')), {'data': '/', 'data/link': '-> /data/sub', 'data/sub': '/', 'data/sub/file': 'committed\n'})
            await container.exportDirectory({path: '/data/link', destination: createWriteStream(path.join(directory, 'link.tar'))})
            assert.deepStrictEqual(Object.keys(await entries(path.join(directory, 'link.tar'))), ['sub', 'sub/file'])
            await container.exportDirectory({path: '/mnt/volume', destination: path.join(directory, 'volume.tar')})
            assert.strictEqual((await entries(path.join(directory, 'volume.tar')))['volume/mounted.txt'], 'mounted')
            //Committed: its changes as a layer, the changes of its configuration
            const image: ContainerdImage = await container.commit({repoTag: 'lakutata-test/committed:1', changes: {cmd: ['cat', '/data/sub/file'], env: {COMMITTED: 'yes'}}, comment: 'test'})
            assert.strictEqual(image.name, 'docker.io/lakutata-test/committed:1')
            assert.deepStrictEqual(image.config.cmd, ['cat', '/data/sub/file'])
            assert.strictEqual(image.config.env.COMMITTED, 'yes')
            assert.strictEqual(container.state.status, 'running')
            const run: ContainerdContainer = await containerd.createContainer({image: image.name, network: 'none'})
            await run.start()
            assert.strictEqual(await run.wait(), 0)
            let logs: string = ''
            for await (const chunk of await run.logs({follow: false})) logs += chunk
            assert.strictEqual(logs, 'committed\n')
            //The file deleted in the container: deleted in the image (its whiteout)
            assert.notStrictEqual((await (async (): Promise<number> => {
                const check: ContainerdContainer = await containerd.createContainer({image: image.name, cmd: ['test', '-e', '/etc/motd'], network: 'none'})
                await check.start()
                const code: number = await check.wait()
                await check.remove()
                return code
            })()), 0)
            await run.remove()
            //Stopped: its snapshot read from its layers (the deleted file not there)
            await container.stop({timeout: 1})
            await container.exportDirectory({path: '/etc', destination: path.join(directory, 'etc.tar')})
            const etc: Record<string, string> = await entries(path.join(directory, 'etc.tar'))
            assert.ok(etc['etc/hostname'] !== undefined && etc['etc/motd'] === undefined, Object.keys(etc).join())
            await assert.rejects(container.exportDirectory({path: '/missing', destination: path.join(directory, 'missing.tar')}))
        } finally {
            await container.remove({force: true})
        }
    })

    it('keeps the named volumes of the containers', async (): Promise<void> => {
        const volume = await containerd.createVolume({name: 'lakutata-test-data', labels: {app: 'test'}})
        assert.strictEqual(volume.labels.app, 'test')
        const writer: ContainerdContainer = await containerd.createContainer({image: ALPINE, cmd: ['sh', '-c', 'echo kept > /data/file'], network: 'none', volumes: [{volumeName: 'lakutata-test-data', containerPath: '/data'}, {volumeName: 'lakutata-test-auto', containerPath: '/auto'}]})
        try {
            assert.deepStrictEqual(writer.volumes, ['lakutata-test-data', 'lakutata-test-auto'])
            await writer.start()
            assert.strictEqual(await writer.wait(), 0)
            await writer.remove()
            const reader: ContainerdContainer = await containerd.createContainer({image: ALPINE, cmd: ['cat', '/data/file'], network: 'none', volumes: [{volumeName: 'lakutata-test-data', containerPath: '/data', readonly: true}]})
            await reader.start()
            assert.strictEqual(await reader.wait(), 0)
            let logs: string = ''
            for await (const chunk of await reader.logs({follow: false})) logs += chunk
            assert.strictEqual(logs, 'kept\n')
            assert.ok((await containerd.listVolumes()).some((item): boolean => item.name === 'lakutata-test-auto'))
            await assert.rejects(containerd.removeVolume('lakutata-test-data'), ContainerdVolumeInUseException)
            await reader.remove()
            await containerd.removeVolume('lakutata-test-data')
            assert.strictEqual((await containerd.prune({containers: false, images: false, volumes: true})).volumes.includes('lakutata-test-auto'), true)
            assert.ok(!(await containerd.listVolumes()).some((item): boolean => item.name.startsWith('lakutata-test')))
        } finally {
            for (const item of await containerd.listContainers()) if (item.volumes.length) await item.remove({force: true})
        }
    })

    it('connects the containers to the networks of IPv6', async (): Promise<void> => {
        const network = await containerd.createNetwork({name: 'lakutata-test-v6', subnet: '10.4.201.0/24', ipv6Subnet: 'fd00:4:201::/64'})
        assert.strictEqual(network.enableIPv6, true)
        const server: ContainerdContainer = await containerd.createContainer({image: ALPINE, cmd: ['sh', '-c', 'while true; do printf "HTTP/1.0 200 OK\\r\\n\\r\\nv6\\n" | nc -l -p 80 >/dev/null; done'], networks: [{networkName: 'lakutata-test-v6', ipv6: 'fd00:4:201::50'}]})
        const client: ContainerdContainer = await containerd.createContainer({image: ALPINE, cmd: ['sleep', '600'], networks: [{networkName: 'lakutata-test-v6'}]})
        try {
            await server.start()
            await client.start()
            assert.strictEqual(server.networks[0].ipv6, 'fd00:4:201::50')
            assert.match(server.networks[0].ip, /^10\.4\.201\./)
            assert.match(client.networks[0].ipv6, /^fd00:4:201::/)
            assert.strictEqual((await client.exec({cmd: 'wget -qO- -T 5 http://[fd00:4:201::50]/'})).stdout.trim(), 'v6')
        } finally {
            await server.remove({force: true})
            await client.remove({force: true})
            await containerd.removeNetwork('lakutata-test-v6')
        }
    })

    it('prunes the resources no container uses', async (): Promise<void> => {
        const stopped: ContainerdContainer = await containerd.createContainer({image: ALPINE, cmd: ['true'], network: 'none'})
        const kept: ContainerdContainer = await containerd.createContainer({image: ALPINE, cmd: ['sleep', '600'], network: 'none'})
        await kept.start()
        const image: ContainerdImage = await containerd.getImage(ALPINE)
        const dangling: string = `docker.io/lakutata-test/dangling@${image.digest}`
        await image.tag(dangling)
        await image.tag('lakutata-test/tagged:1')
        await containerd.createNetwork({name: 'lakutata-test-unused'})
        try {
            const result = await containerd.prune({networks: true})
            assert.ok(result.containers.includes(stopped.id))
            assert.ok(!result.containers.includes(kept.id))
            assert.ok(result.images.includes(dangling))
            assert.ok(!result.images.includes('docker.io/lakutata-test/tagged:1') && !result.images.includes(image.name))
            assert.ok(result.networks.includes('lakutata-test-unused'))
            assert.strictEqual(kept.state.status, 'running')
            //All the images no container uses
            assert.ok((await containerd.prune({containers: false, allImages: true})).images.includes('docker.io/lakutata-test/tagged:1'))
            assert.ok((await containerd.getImage(ALPINE)).name)
        } finally {
            await kept.remove({force: true})
        }
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

    for (const [index, address] of BUILDKITS.entries()) {
        it(`builds an image with the BuildKit of ${address}`, async (): Promise<void> => {
            const builder: Containerd = await app.getObject<Containerd>(`builder${index}`)
            const context: string = path.join(directory, 'context')
            await rm(context, {recursive: true, force: true})
            await mkdir(path.join(context, 'docker'), {recursive: true})
            await writeFile(path.join(context, 'docker', 'App.Dockerfile'), `FROM ${ALPINE}\nARG GREETING\nCOPY . /app/\nRUN echo "$GREETING" > /app/greeting && ls /app > /app/files\nCMD ["sh", "-c", "cat /app/greeting /app/files /app/linked"]\n`)
            await writeFile(path.join(context, 'data.txt'), 'data\n')
            await writeFile(path.join(context, 'secret.txt'), 'secret\n')
            await writeFile(path.join(context, '.dockerignore'), 'secret.txt\ndocker\n')
            await symlink('data.txt', path.join(context, 'linked'))
            const lines: string[] = []
            const tag: string = `lakutata-test/built:${address.startsWith('tcp') ? 'remote' : 'local'}`
            assert.match((await builder.buildkitVersion()).version, /^v\d/)
            assert.ok((await builder.buildkitPlatforms()).length > 0)
            const image: ContainerdImage = await builder.buildImage({
                workdir: context,
                dockerfile: 'docker/App.Dockerfile',
                repoTag: tag,
                buildargs: {GREETING: 'hello'},
                labels: {built: 'yes'},
                outputCallback: (line: string): unknown => lines.push(line)
            })
            assert.strictEqual(image.name, `docker.io/${tag}`)
            assert.strictEqual(image.platform, FormatPlatform(HostPlatform()))
            assert.strictEqual(image.config.labels.built, 'yes')
            assert.ok(lines.some((line: string): boolean => line.includes('RUN echo')), lines.join('\n'))
            const container: ContainerdContainer = await containerd.createContainer({image: tag})
            try {
                await container.start()
                assert.strictEqual(await container.wait(), 0)
                let output: string = ''
                for await (const chunk of await container.logs({follow: false})) output += chunk
                //The .dockerignore of the context: no secret.txt, no docker directory
                assert.strictEqual(output, 'hello\ndata.txt\nfiles\ngreeting\nlinked\ndata\n')
            } finally {
                await container.remove({force: true})
            }
            //An image of several platforms: its index, its RUN run by the emulators of the machine of BuildKit
            await writeFile(path.join(context, 'Dockerfile'), `FROM ${ALPINE}\nRUN uname -m > /arch\nCMD ["cat", "/arch"]\n`)
            const multiple: ContainerdImage = await builder.buildImage({workdir: context, repoTag: 'lakutata-test/multiple:1', platform: ['linux/amd64', 'linux/arm64']})
            assert.deepStrictEqual([...multiple.platforms].sort(), ['linux/amd64', 'linux/arm64/v8'])
            //A build which fails: its error, its output
            await writeFile(path.join(context, 'Dockerfile'), `FROM ${ALPINE}\nRUN echo failing && exit 3\n`)
            await assert.rejects(builder.buildImage({workdir: context, repoTag: 'lakutata-test/failed:1'}), (error: unknown): boolean => error instanceof ContainerdImageBuildException && /exit code: 3/.test((error as Error).message))
        })
    }

    it('fails the builds when BuildKit is not there', async (): Promise<void> => {
        const builder: Containerd = await app.getObject<Containerd>(`builder${BUILDKITS.length}`)
        await assert.rejects(builder.buildkitVersion(), ContainerdImageBuildException)
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
