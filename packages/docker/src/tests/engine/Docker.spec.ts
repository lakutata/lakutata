import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {randomBytes} from 'node:crypto'
import {createWriteStream} from 'node:fs'
import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises'
import {arch, tmpdir} from 'node:os'
import path from 'node:path'
import {Application} from '@lakutata/core'
import {DockerClient} from '../../client/DockerClient.js'
import {
    Docker,
    DockerContainer,
    DockerContainerNotFoundException,
    DockerContainerTTY,
    DockerImage,
    DockerImageBuildException,
    DockerImageNotFoundException,
    DockerNetworkNotFoundException,
    DockerRequestException,
    NetworkInfo
} from '../../exports/Docker.js'

/**
 * The tests run with the Docker of the machine (DOCKER_TEST=1): they pull alpine and create their images, containers and
 * networks, named lakutata-test-*, removed after them. DOCKER_TEST_API_VERSION requests another API version than the
 * negotiated one
 */
const ENABLED: boolean = !!process.env.DOCKER_TEST

/**
 * The platform of the machine, as Docker names it
 */
const PLATFORM: string = `linux/${arch() === 'x64' ? 'amd64' : arch()}`

const BASE: { repo: string, tag: string } = {repo: 'alpine', tag: '3.20'}

describe('The Docker component with the Docker of the machine', {skip: !ENABLED && 'DOCKER_TEST=1 runs them with the Docker of the machine'}, (): void => {

    let app: Application
    let docker: Docker
    let context: string

    before(async (): Promise<void> => {
        app = await new Promise<Application>((resolve: (app: Application) => void, reject: (error: Error) => void): void => {
            Application.run({id: 'docker.test.app', name: 'docker-test', components: {docker: {class: Docker, version: process.env.DOCKER_TEST_API_VERSION || undefined}}, bootstrap: ['docker']})
                .onLaunched((launched: Application): void => resolve(launched))
                .onFatalException((error: Error): void => reject(error))
        })
        docker = await app.getObject<Docker>('docker')
        context = await mkdtemp(path.join(tmpdir(), 'lakutata-docker-'))
        await writeFile(path.join(context, 'Dockerfile'), `FROM ${BASE.repo}:${BASE.tag}\nRUN echo hello > /hello.txt\nCMD ["sh", "-c", "echo started; sleep 60"]\n`)
    })

    after(async (): Promise<void> => {
        await rm(context, {recursive: true, force: true})
        await app?.dispose()
    })

    it('pulls an image', async (): Promise<void> => {
        const statuses: string[] = []
        const image: DockerImage = await docker.pullImage({...BASE, platform: PLATFORM, outputCallback: (output: Record<string, any>): unknown => statuses.push(output.status)})
        assert.ok(image.id.startsWith('sha256:'))
        assert.ok(statuses.length > 0)
        assert.ok((await docker.getImage(`${BASE.repo}:${BASE.tag}`)).repoTags.includes(`${BASE.repo}:${BASE.tag}`))
        assert.ok((await docker.listImages()).length > 0)
    })

    it('builds an image, runs, stops and removes its container', async (): Promise<void> => {
        const image: DockerImage = await docker.buildImage({workdir: context, files: ['Dockerfile'], repoTag: 'lakutata-test-build:1', platform: PLATFORM})
        try {
            assert.ok(image.repoTags.includes('lakutata-test-build:1'))
            const container: DockerContainer = await docker.createContainer(image.id, PLATFORM, {name: 'lakutata-test-container'})
            try {
                await container.start()
                assert.ok((await docker.listContainers()).some((listed: DockerContainer): boolean => listed.id === container.id))
                assert.ok((await container.stats()).memory_stats)
                await container.stop()
            } finally {
                await container.remove({force: true})
            }
        } finally {
            await image.remove({force: true})
        }
    })

    it('gives the progress of a build as readable lines, with the output of its steps', async (): Promise<void> => {
        const directory: string = path.join(context, 'progress')
        await mkdir(directory)
        await writeFile(path.join(directory, 'Dockerfile'), `FROM ${BASE.repo}:${BASE.tag}\nRUN echo building-step-output && echo hello > /hello.txt\n`)
        const lines: string[] = []
        const image: DockerImage = await docker.buildImage({workdir: directory, files: ['Dockerfile'], repoTag: 'lakutata-test-progress:1', nocache: true, platform: PLATFORM, outputCallback: (output: Record<string, any>): unknown => output.stream && lines.push(output.stream)})
        await image.remove({force: true})
        const text: string = lines.join('\n')
        assert.match(text, /^#\d+ \[2\/2\] RUN echo building-step-output && echo hello > \/hello\.txt$/m, text)
        assert.match(text, /^#\d+ building-step-output$/m, text)
        assert.match(text, /^#\d+ DONE \d+\.\ds$/m, text)
        assert.doesNotMatch(text, /Gsha256|\uFFFD|[\u0000-\u0008]/)
    })

    it('fails a build with the error of its step', async (): Promise<void> => {
        const directory: string = path.join(context, 'failure')
        await mkdir(directory)
        await writeFile(path.join(directory, 'Dockerfile'), `FROM ${BASE.repo}:${BASE.tag}\nRUN exit 3\n`)
        await assert.rejects(docker.buildImage({workdir: directory, files: ['Dockerfile'], platform: PLATFORM}), (error: Error): boolean => error instanceof DockerImageBuildException && /exit code: 3/.test(error.message))
    })

    it('packs the context: once each file, without the ones of .dockerignore, with the links', async (): Promise<void> => {
        const directory: string = path.join(context, 'files')
        await mkdir(path.join(directory, 'src', 'lib'), {recursive: true})
        await writeFile(path.join(directory, 'src', 'lib', 'a.txt'), 'a')
        await writeFile(path.join(directory, 'src', 'secret.key'), 'secret')
        await symlink('lib/a.txt', path.join(directory, 'src', 'link.txt'))
        await writeFile(path.join(directory, '.dockerignore'), '**/*.key\nDockerfile\n')
        await writeFile(path.join(directory, 'Dockerfile'), `FROM ${BASE.repo}:${BASE.tag}\nCOPY src /src\nRUN test -f /src/lib/a.txt && test ! -e /src/secret.key && test -L /src/link.txt && echo checked\n`)
        //The directories and their files, as a glob lists them
        const lines: string[] = []
        const image: DockerImage = await docker.buildImage({workdir: directory, files: ['Dockerfile', 'src', 'src/lib', 'src/lib/a.txt', 'src/secret.key', 'src/link.txt'], platform: PLATFORM, nocache: true, outputCallback: (output: Record<string, any>): unknown => output.stream && lines.push(output.stream)})
        await image.remove({force: true})
        assert.match(lines.join('\n'), /^#\d+ checked$/m)
    })

    it('uploads a large context to BuildKit (the kept alive connections corrupted it)', async (): Promise<void> => {
        const directory: string = path.join(context, 'large')
        await mkdir(directory)
        const file = createWriteStream(path.join(directory, 'large.bin'))
        for (let index: number = 0; index < 300; index++) if (!file.write(randomBytes(1024 * 1024))) await new Promise<void>((resolve: () => void): unknown => file.once('drain', resolve))
        await new Promise<void>((resolve: () => void): unknown => file.end(resolve))
        await writeFile(path.join(directory, 'Dockerfile'), `FROM ${BASE.repo}:${BASE.tag}\nCOPY large.bin /large.bin\nRUN test $(stat -c %s /large.bin) -eq 314572800\n`)
        const image: DockerImage = await docker.buildImage({workdir: directory, files: ['Dockerfile', 'large.bin'], platform: PLATFORM, nocache: true})
        await image.remove({force: true})
    })

    it('gives the logs, the executions and the TTYs of a container as their output', async (): Promise<void> => {
        const image: DockerImage = await docker.buildImage({workdir: context, files: ['Dockerfile'], repoTag: 'lakutata-test-output:1', platform: PLATFORM})
        //The platform is the one of the image
        const container: DockerContainer = await docker.createContainer(image.id, {name: 'lakutata-test-output'})
        try {
            await container.start()
            await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 1000))
            const logs: Buffer[] = []
            //Without follow (followed by default, until the container stops)
            for await (const chunk of await container.logs({follow: false})) logs.push(Buffer.from(chunk))
            assert.strictEqual(Buffer.concat(logs).toString(), 'started\n')
            assert.deepStrictEqual(await container.exec({cmd: ['cat', '/hello.txt']}), {exitCode: 0, stdout: 'hello\n', stderr: ''})
            //A command line, run by /bin/sh -c; stdout and stderr apart; its exit code
            assert.deepStrictEqual(await container.exec({cmd: 'echo out; echo err >&2; exit 3'}), {exitCode: 3, stdout: 'out\n', stderr: 'err\n'})
            //An array is run as it is
            assert.deepStrictEqual(await container.exec({cmd: ['echo', '$HOME; exit 3']}), {exitCode: 0, stdout: '$HOME; exit 3\n', stderr: ''})
            assert.ok([126, 127].includes((await container.exec({cmd: ['lakutata-missing-program']})).exitCode))
            //The default command: /bin/sh (alpine has no bash); no log component in the application
            const tty: DockerContainerTTY = await container.createTTY()
            let output: string = ''
            tty.onData((chunk: Buffer): unknown => output += chunk.toString())
            tty.write('echo tty-$((40+2))\n')
            for (let wait: number = 0; wait < 50 && !output.includes('tty-42'); wait++) await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 100))
            assert.match(output, /tty-42/)
            assert.doesNotMatch(output, /[\u0000\u0001\u0002]/)
            await tty.resize({rows: 40, cols: 120})
            tty.write('exit\n')
        } finally {
            await container.remove({force: true})
            await image.remove({force: true})
        }
    })

    it('exports an image, and imports it', async (): Promise<void> => {
        const image: DockerImage = await docker.buildImage({workdir: context, files: ['Dockerfile'], repoTag: 'lakutata-test-export:1', platform: PLATFORM})
        //Exported by its tag, the archive has it (by its id, as docker save does, it has none)
        const archive: string = path.join(context, 'image.tar')
        await image.export({destination: archive, repoTag: 'lakutata-test-export:1'})
        const byId: string = path.join(context, 'image-id.tar')
        await image.export({destination: byId})
        await image.remove({force: true})
        const untagged: DockerImage = await docker.importImage({source: byId})
        assert.strictEqual(untagged.id, image.id)
        const imported: DockerImage = await docker.importImage({source: archive})
        try {
            assert.ok(imported.repoTags.includes('lakutata-test-export:1'), imported.repoTags.join(', '))
            await imported.tag({repo: 'lakutata-test-export', tag: '2'})
            assert.ok(imported.repoTags.includes('lakutata-test-export:2'))
        } finally {
            await imported.remove({force: true})
        }
    })

    it('creates and removes a network', async (): Promise<void> => {
        const network: NetworkInfo = await docker.createNetwork({name: 'lakutata-test-network'})
        try {
            assert.ok((await docker.listNetworks()).some(({id}): boolean => id === network.id))
            assert.strictEqual((await docker.getNetwork(network.id)).name, 'lakutata-test-network')
            //By its name or a short ID, as the daemon finds it
            assert.strictEqual((await docker.getNetwork('lakutata-test-network')).id, network.id)
            assert.strictEqual((await docker.getNetwork(network.id.substring(0, 12))).id, network.id)
            assert.ok((await docker.listNetworks()).some(({driver}): boolean => driver === 'host' || driver === 'null'))
        } finally {
            await docker.removeNetwork('lakutata-test-network')
        }
        assert.ok(!(await docker.listNetworks()).some(({id}): boolean => id === network.id))
        await assert.rejects(docker.getNetwork(network.id), DockerNetworkNotFoundException)
        await assert.rejects(docker.removeNetwork('lakutata-test-network'), DockerNetworkNotFoundException)
    })

    it('finds the images as the daemon names them', async (): Promise<void> => {
        const image: DockerImage = await docker.getImage(`${BASE.repo}:${BASE.tag}`)
        assert.strictEqual((await docker.getImage(`docker.io/library/${BASE.repo}:${BASE.tag}`)).id, image.id)
        assert.strictEqual((await docker.getImage(image.id.substring(7, 19))).id, image.id)
        //Pulled by its full name, found as the daemon names it
        assert.strictEqual((await docker.pullImage({repo: `docker.io/library/${BASE.repo}`, tag: BASE.tag, platform: PLATFORM})).id, image.id)
        await assert.rejects(docker.getImage('lakutata-test-missing:1'), DockerImageNotFoundException)
    })

    it('rejects an import of a missing file with its error', async (): Promise<void> => {
        await assert.rejects(docker.importImage({source: path.join(context, 'missing.tar')}), /ENOENT/)
    })

    it('starts, stops and kills a container with the signal given; the missing containers rejected as such', async (): Promise<void> => {
        const container: DockerContainer = await docker.createContainer(`${BASE.repo}:${BASE.tag}`, {
            name: 'lakutata-test-signals',
            //Exits 42 on SIGHUP
            cmd: ['sh', '-c', 'trap "exit 42" HUP; while true; do sleep 0.1; done'],
            restartPolicy: 'on-failure:3'
        })
        try {
            assert.strictEqual(container.state.startedAt, null)
            assert.strictEqual(container.state.finishedAt, null)
            assert.strictEqual(container.restartPolicy, 'on-failure:3')
            await container.start()
            //Started already: done
            await container.start()
            assert.ok(container.state.running)
            await container.update({restartPolicy: 'no'})
            await container.kill({signal: 'SIGHUP'})
            for (let wait: number = 0; wait < 50 && container.state.running; wait++) {
                await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 100))
                container.state = (await docker.getContainer(container.id)).state
            }
            assert.strictEqual(container.state.exitCode, 42)
            assert.ok(container.state.finishedAt)
            //Stopped already: done
            await container.stop()
            await assert.rejects(container.kill(), (error: Error): boolean => error instanceof DockerRequestException && error.statusCode === 409)
            await assert.rejects(docker.createContainer(`${BASE.repo}:${BASE.tag}`, {name: 'lakutata-test-signals'}), (error: Error): boolean => error instanceof DockerRequestException && error.statusCode === 409)
        } finally {
            await container.remove({force: true})
        }
        await assert.rejects(container.start(), DockerContainerNotFoundException)
        await assert.rejects(docker.getContainer('lakutata-test-signals'), DockerContainerNotFoundException)
    })

    it('reads a container whose image was removed', async (): Promise<void> => {
        const image: DockerImage = await docker.buildImage({workdir: context, files: ['Dockerfile'], repoTag: 'lakutata-test-removed:1', platform: PLATFORM})
        const container: DockerContainer = await docker.createContainer(image.id, {name: 'lakutata-test-removed'})
        try {
            await image.remove({force: true})
            assert.strictEqual((await docker.getContainer(container.id)).image, undefined)
            assert.ok((await docker.listContainers()).some((listed: DockerContainer): boolean => listed.id === container.id && !listed.image))
            //Recreated from its removed image: refused, kept
            await assert.rejects(container.update({env: {MODE: 'test'}}), DockerImageNotFoundException)
            assert.strictEqual((await docker.getContainer('lakutata-test-removed')).id, container.id)
        } finally {
            await container.remove({force: true})
        }
    })

    it('updates a container: its resources live, the other settings by recreating it from its whole configuration', async (): Promise<void> => {
        //Its image has an anonymous volume
        const directory: string = path.join(context, 'volumes')
        await mkdir(directory)
        await writeFile(path.join(directory, 'Dockerfile'), `FROM ${BASE.repo}:${BASE.tag}\nVOLUME /anonymous\n`)
        const image: DockerImage = await docker.buildImage({workdir: directory, files: ['Dockerfile'], repoTag: 'lakutata-test-update:1', platform: PLATFORM})
        const network: NetworkInfo = await docker.createNetwork({name: 'lakutata-test-update'})
        const client: DockerClient = new DockerClient({version: process.env.DOCKER_TEST_API_VERSION || undefined})
        let container: DockerContainer | undefined
        let anonymousVolume: string | undefined
        try {
            container = await docker.createContainer(image.id, {
                name: 'lakutata-test-update',
                cmd: ['sh', '-c', 'echo -n kept >> /anonymous/file; echo -n named > /named/file; sleep 3600'],
                //A named volume (a source which is not a path)
                binds: [{hostPath: 'lakutata-test-update-named', containerPath: '/named', rw: true}],
                ports: [{port: 8080, type: 'tcp', hostPorts: [18080]}],
                networks: [{networkName: 'lakutata-test-update'}]
            })
            await container.start()
            const firstId: string = container.id
            anonymousVolume = (await client.inspectContainer(firstId)).Mounts.find(({Destination}): boolean => Destination === '/anonymous').Name
            //Live: the same container
            await container.update({memoryLimit: 64 * 1024 * 1024, cpuSet: [0], restartPolicy: 'on-failure:2'})
            assert.strictEqual(container.id, firstId)
            assert.strictEqual(container.memoryLimit, 64 * 1024 * 1024)
            assert.deepStrictEqual(container.cpuSet, [0])
            assert.strictEqual(container.restartPolicy, 'on-failure:2')
            assert.ok(container.state.running)
            //Renamed live
            await container.update({name: 'lakutata-test-update-renamed'})
            assert.strictEqual(container.id, firstId)
            assert.strictEqual(container.name, 'lakutata-test-update-renamed')
            await container.update({name: 'lakutata-test-update'})
            //Recreated: a new container, the same configuration
            await container.update({env: {MODE: 'updated'}})
            assert.notStrictEqual(container.id, firstId)
            assert.strictEqual(container.name, 'lakutata-test-update')
            assert.strictEqual(container.env.MODE, 'updated')
            assert.ok(container.env.PATH)
            assert.ok(container.state.running)
            assert.strictEqual(container.memoryLimit, 64 * 1024 * 1024)
            assert.strictEqual(container.restartPolicy, 'on-failure:2')
            await assert.rejects(docker.getContainer(firstId), DockerContainerNotFoundException)
            const inspectInfo: Record<string, any> = await client.inspectContainer(container.id)
            //The command and the volumes kept, with their files
            assert.deepStrictEqual(inspectInfo.Config.Cmd, ['sh', '-c', 'echo -n kept >> /anonymous/file; echo -n named > /named/file; sleep 3600'])
            assert.strictEqual(inspectInfo.Mounts.find(({Destination}): boolean => Destination === '/anonymous').Name, anonymousVolume)
            assert.strictEqual((await container.exec({cmd: 'cat /anonymous/file /named/file'})).stdout, 'keptkeptnamed')
            //The port bound once, the address assigned by Docker not made static
            assert.deepStrictEqual(inspectInfo.HostConfig.PortBindings['8080/tcp'], [{HostIp: '', HostPort: '18080'}])
            assert.ok(!inspectInfo.NetworkSettings.Networks['lakutata-test-update'].IPAMConfig?.IPv4Address)
            assert.deepStrictEqual(container.ports.filter(({port}): boolean => port === 8080).map(({hostPorts}): number[] => hostPorts), [[18080]])
            //The daemon's defaults (an empty cgroup, cgroup parent, PID mode) do not fail a recreation
            await container.update({hostname: 'updated', memoryLimit: 0})
            assert.strictEqual(container.hostname, 'updated')
            assert.strictEqual(container.memoryLimit, 0)
            //A creation refused: the container kept as it was
            const keptId: string = container.id
            await assert.rejects(container.update({networks: [{networkName: 'lakutata-test-missing-network'}]}), DockerNetworkNotFoundException)
            assert.strictEqual(container.id, keptId)
            const kept: DockerContainer = await docker.getContainer('lakutata-test-update')
            assert.strictEqual(kept.id, keptId)
            assert.ok(kept.state.running)
            assert.ok(!(await docker.listContainers()).some((listed: DockerContainer): boolean => listed.name.startsWith('lakutata-test-update-update-')))
        } finally {
            await container?.remove({force: true}).catch((): void => undefined)
            for (const volume of ['lakutata-test-update-named', anonymousVolume]) {
                if (volume) await client.connection.request({method: 'DELETE', path: `/volumes/${volume}`, statusCodes: {204: true, 404: true}})
            }
            client.close()
            await docker.removeNetwork(network.id)
            await image.remove({force: true})
        }
    })
})
