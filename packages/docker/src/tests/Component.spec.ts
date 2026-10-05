import {after, before, beforeEach, describe, it} from 'node:test'
import assert from 'node:assert'
import http, {type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Application} from '@lakutata/core'
import {
    Docker,
    DockerContainer,
    DockerContainerNotFoundException,
    DockerImageBuildException,
    DockerImageNotFoundException,
    DockerImagePullException,
    DockerNetworkNotFoundException,
    DockerRequestException
} from '../exports/Docker.js'

/**
 * The inspection of an image by the fake daemon
 * @param id
 */
function imageInspection(id: string): Record<string, unknown> {
    return {Id: id, RepoTags: ['app:1'], Created: '2026-01-01T00:00:00Z', Architecture: 'arm64', Os: 'linux', Size: 1, Config: {Env: []}}
}

/**
 * The inspection of a container by the fake daemon: never exited, its image removed
 */
const CONTAINER: Record<string, unknown> = {
    Id: 'c'.repeat(64),
    Name: '/fake',
    Created: '2026-01-01T00:00:00Z',
    Image: 'sha256:removed',
    RestartCount: 0,
    Config: {Hostname: 'fake', Env: ['A=1'], Tty: false},
    State: {Status: 'running', Running: true, StartedAt: '2026-01-01T00:00:01Z', FinishedAt: '0001-01-01T00:00:00Z'},
    HostConfig: {RestartPolicy: {Name: 'on-failure', MaximumRetryCount: 3}},
    NetworkSettings: {Networks: {}, Ports: {}},
    Mounts: []
}

describe('The Docker component with a fake daemon', (): void => {

    let server: Server
    let socketPath: string
    let app: Application
    let docker: Docker
    let requests: { method: string, path: string, query: URLSearchParams, headers: IncomingMessage['headers'], body: string }[] = []
    //The responses never sent: a pull or a build in progress
    const pending: ServerResponse[] = []

    before(async (): Promise<void> => {
        socketPath = path.join(await mkdtemp(path.join(tmpdir(), 'lakutata-fake-docker-')), 'docker.sock')
        server = http.createServer((request: IncomingMessage, response: ServerResponse): void => {
            const chunks: Buffer[] = []
            request.on('data', (chunk: Buffer): unknown => chunks.push(chunk))
            request.on('end', (): void => {
                const url: URL = new URL(request.url!, 'http://docker')
                const pathname: string = decodeURIComponent(url.pathname.replace(/^\/v[\d.]+/, ''))
                requests.push({method: request.method!, path: pathname, query: url.searchParams, headers: request.headers, body: Buffer.concat(chunks).toString()})
                const json = (status: number, body: unknown): unknown => response.writeHead(status, {'Content-Type': 'application/json'}).end(JSON.stringify(body))
                if (pathname === '/_ping') return void response.end('OK')
                if (pathname === '/version') return void json(200, {ApiVersion: '1.56', MinAPIVersion: '1.24'})
                if (pathname === '/images/create' && url.searchParams.get('fromImage') === 'hanging') return void pending.push(response.writeHead(200))
                if (pathname === '/build' && url.searchParams.get('t') === 'hanging:1') return void pending.push(response.writeHead(200))
                if (pathname === '/build') return void response.end(JSON.stringify({error: 'The build failed'}))
                if (/^\/images\/.*missing.*\/json$/.test(pathname) || pathname === '/images/sha256:removed/json') return void json(404, {message: `No such image: ${pathname.split('/')[2]}`})
                let match: RegExpExecArray | null
                if ((match = /^\/images\/(.+)\/json$/.exec(pathname))) return void json(200, imageInspection(match[1].startsWith('sha256:') ? match[1] : 'sha256:app'))
                if (/^\/images\/.+\/push$/.test(pathname)) return void response.end(JSON.stringify({status: 'Pushed'}))
                if (/^\/images\/.+\/tag$/.test(pathname)) return void response.writeHead(201).end()
                if (pathname === '/containers/missing/json') return void json(404, {message: 'No such container: missing'})
                if (pathname === `/containers/${CONTAINER.Id}/json` || pathname === '/containers/fake/json') return void json(200, CONTAINER)
                if (/^\/containers\/.+\/(start|stop)$/.test(pathname)) return void response.writeHead(304).end()
                if (pathname === '/containers/create') return void json(409, {message: 'Conflict. The container name "/fake" is already in use'})
                if (pathname === '/networks/missing') return void json(404, {message: 'network missing not found'})
                if (pathname.startsWith('/networks/')) return void json(200, {Id: 'n'.repeat(64), Name: 'host', Driver: 'host', Internal: false, EnableIPv6: false, IPAM: {Config: []}, Created: '2026-01-01T00:00:00Z'})
                if (pathname === '/auth' && JSON.parse(Buffer.concat(chunks).toString()).password === 'wrong') return void json(401, {message: 'unauthorized: incorrect username or password'})
                json(200, {})
            })
        })
        await new Promise((resolve: (value: unknown) => void): unknown => server.listen(socketPath, (): void => resolve(undefined)))
        app = await new Promise<Application>((resolve: (app: Application) => void, reject: (error: Error) => void): void => {
            Application.run({id: 'docker.fake.app', name: 'docker-fake', components: {docker: {class: Docker, socketPath: socketPath}}, bootstrap: ['docker']})
                .onLaunched((launched: Application): void => resolve(launched))
                .onFatalException((error: Error): void => reject(error))
        })
        docker = await app.getObject<Docker>('docker')
    })

    after(async (): Promise<void> => {
        await app?.dispose()
        pending.forEach((response: ServerResponse): unknown => response.end())
        server.closeAllConnections()
        await new Promise((resolve: (value: unknown) => void): unknown => server.close(resolve))
        await rm(path.dirname(socketPath), {recursive: true, force: true})
    })

    beforeEach((): void => {
        requests = []
    })

    it('prunes the volumes only when asked', async (): Promise<void> => {
        await docker.prune()
        assert.deepStrictEqual(requests.map(({path}): string => path), ['/containers/prune', '/images/prune'])
        requests = []
        await docker.prune({volumes: true})
        assert.ok(requests.some(({path}): boolean => path === '/volumes/prune'))
    })

    it('sends the tokens of the credentials with the login, the push and the build', async (): Promise<void> => {
        const auth = {serverAddress: 'registry.example.com', username: 'ci', identityToken: 'identity', registryToken: 'registry', email: 'ci@example.com'}
        await docker.loginRepository(auth)
        assert.deepStrictEqual(JSON.parse(requests[0].body), {username: 'ci', serveraddress: 'registry.example.com', email: 'ci@example.com', identitytoken: 'identity', registrytoken: 'registry'})
        const image = await docker.getImage('app:1')
        requests = []
        await image.push({repo: 'registry.example.com/app', tag: '1', auth: auth})
        const push = requests.find(({path}): boolean => path.endsWith('/push'))!
        assert.strictEqual(JSON.parse(Buffer.from(push.headers['x-registry-auth'] as string, 'base64url').toString()).identitytoken, 'identity')
        const context: string = await mkdtemp(path.join(tmpdir(), 'lakutata-fake-context-'))
        try {
            await writeFile(path.join(context, 'Dockerfile'), 'FROM scratch\n')
            requests = []
            await assert.rejects(docker.buildImage({workdir: context, files: [], repoTag: 'app:2', auth: auth}), DockerImageBuildException)
            const build = requests.find(({path}): boolean => path === '/build')!
            assert.strictEqual(JSON.parse(Buffer.from(build.headers['x-registry-config'] as string, 'base64').toString())['registry.example.com'].registrytoken, 'registry')
        } finally {
            await rm(context, {recursive: true, force: true})
        }
    })

    it('builds quietly with quiet, and its deprecated spelling quite', async (): Promise<void> => {
        const context: string = await mkdtemp(path.join(tmpdir(), 'lakutata-fake-context-'))
        try {
            await writeFile(path.join(context, 'Dockerfile'), 'FROM scratch\n')
            for (const options of [{quiet: true}, {quite: true}]) {
                requests = []
                await assert.rejects(docker.buildImage({workdir: context, files: [], ...options}), /The build failed/)
                assert.strictEqual(requests.find(({path}): boolean => path === '/build')!.query.get('q'), 'true')
            }
        } finally {
            await rm(context, {recursive: true, force: true})
        }
    })

    it('rejects with the exception of what is missing, else with the status of the daemon', async (): Promise<void> => {
        await assert.rejects(docker.getContainer('missing'), (error: Error): boolean => error instanceof DockerContainerNotFoundException && error.message === 'No such container: missing')
        await assert.rejects(docker.getImage('missing:1'), DockerImageNotFoundException)
        await assert.rejects(docker.getNetwork('missing'), DockerNetworkNotFoundException)
        await assert.rejects(docker.createContainer('app:1', {name: 'fake'}), (error: Error): boolean => error instanceof DockerRequestException && error.statusCode === 409 && /already in use/.test(error.message))
        await assert.rejects(docker.loginRepository({serverAddress: 'registry.example.com', username: 'ci', password: 'wrong'}), (error: Error): boolean => error instanceof DockerRequestException && error.statusCode === 401)
        assert.strictEqual(await docker.checkRepositoryAuth({serverAddress: 'registry.example.com', username: 'ci', password: 'wrong'}), false)
    })

    it('reads a container without its removed image, its dates never reached as null, its retries in its policy', async (): Promise<void> => {
        const container: DockerContainer = await docker.getContainer('fake')
        assert.strictEqual(container.image, undefined)
        assert.strictEqual(container.state.finishedAt, null)
        assert.ok(container.state.startedAt)
        assert.strictEqual(container.restartPolicy, 'on-failure:3')
        //Started when running, stopped when stopped: done (HTTP 304)
        await container.start()
        await container.stop()
    })

    it('gets a network by its name, as the daemon reports it', async (): Promise<void> => {
        const network = await docker.getNetwork('host')
        assert.strictEqual(network.driver, 'host')
        assert.ok(requests.some(({path}): boolean => path === '/networks/host'))
    })

    it('rejects the pulls and the builds in progress when it is destroyed', async (): Promise<void> => {
        const context: string = await mkdtemp(path.join(tmpdir(), 'lakutata-fake-context-'))
        await writeFile(path.join(context, 'Dockerfile'), 'FROM scratch\n')
        const pull: Promise<unknown> = docker.pullImage({repo: 'hanging'})
        const build: Promise<unknown> = docker.buildImage({workdir: context, files: [], repoTag: 'hanging:1'})
        //Both sent
        for (let wait: number = 0; wait < 100 && requests.filter(({path}): boolean => path === '/images/create' || path === '/build').length < 2; wait++) await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 10))
        await app.dispose()
        try {
            await assert.rejects(pull, (error: Error): boolean => error instanceof DockerImagePullException && /aborted/.test(error.message))
            await assert.rejects(build, (error: Error): boolean => error instanceof DockerImageBuildException && /aborted/.test(error.message))
        } finally {
            await rm(context, {recursive: true, force: true})
        }
    })
})
