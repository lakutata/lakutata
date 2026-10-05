import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises'
import http, {type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import type {Socket} from 'node:net'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {PassThrough, Readable} from 'node:stream'
import {gunzipSync} from 'node:zlib'
import {extract} from 'tar-stream'
import {DockerStreamDecoder, DockerStreamType, followProgress, readMultiplexed} from '../client/DockerStreams.js'
import {BuildKitProgress, decodeBuildKitStatus} from '../client/BuildKitProgress.js'
import {DockerIgnore} from '../client/DockerIgnore.js'
import {packBuildContext} from '../client/BuildContext.js'
import {defaultConnectionOptions, DockerConnection} from '../client/DockerConnection.js'
import {DockerRequestError} from '../client/DockerRequestError.js'
import {parseBaseImages} from '../docker/lib/ParseBaseImages.js'

/**
 * A frame of a multiplexed output
 * @param type
 * @param content
 */
function encodeFrame(type: DockerStreamType, content: string): Buffer {
    const header: Buffer = Buffer.alloc(8)
    header.writeUInt8(type, 0)
    header.writeUInt32BE(Buffer.byteLength(content), 4)
    return Buffer.concat([header, Buffer.from(content)])
}

/**
 * A protobuf encoder of the messages of the tests: a varint, and the fields
 */
function varint(value: number): Buffer {
    const bytes: number[] = []
    let rest: bigint = BigInt(value)
    do {
        let byte: number = Number(rest & 0x7fn)
        rest >>= 7n
        if (rest) byte |= 0x80
        bytes.push(byte)
    } while (rest)
    return Buffer.from(bytes)
}

function readField(number: number, value: number | string | Buffer): Buffer {
    if (typeof value === 'number') return Buffer.concat([varint(number << 3), varint(value)])
    const bytes: Buffer = Buffer.isBuffer(value) ? value : Buffer.from(value)
    return Buffer.concat([varint((number << 3) | 2), varint(bytes.length), bytes])
}

function timestamp(milliseconds: number): Buffer {
    return Buffer.concat([readField(1, Math.floor(milliseconds / 1000)), readField(2, (milliseconds % 1000) * 1e6)])
}

/**
 * The aux of a status of BuildKit
 * @param fields
 */
function aux(...fields: Buffer[]): string {
    return Buffer.concat(fields).toString('base64')
}

describe('The client of the Docker Engine API', (): void => {

    it('decodes the multiplexed outputs, whatever their chunks', async (): Promise<void> => {
        const stream: Buffer = Buffer.concat([encodeFrame(DockerStreamType.STDOUT, 'out 1\n'), encodeFrame(DockerStreamType.STDERR, 'err\n'), encodeFrame(DockerStreamType.STDOUT, 'out 2\n')])
        //Cut in chunks of 3 bytes: the headers and the contents are split
        const chunks: Buffer[] = []
        for (let offset: number = 0; offset < stream.length; offset += 3) chunks.push(stream.subarray(offset, offset + 3))
        const read = await readMultiplexed(Readable.from(chunks))
        assert.deepStrictEqual(read, {output: 'out 1\nerr\nout 2\n', stdout: 'out 1\nout 2\n', stderr: 'err\n'})
        assert.deepStrictEqual(await readMultiplexed(stream), read)
        //Piped, the contents only
        const decoded: Buffer[] = []
        for await (const chunk of Readable.from(chunks).pipe(new DockerStreamDecoder())) decoded.push(chunk)
        assert.strictEqual(Buffer.concat(decoded).toString(), 'out 1\nerr\nout 2\n')
    })

    it('follows the JSON lines of the progresses, whatever their chunks', async (): Promise<void> => {
        const seen: unknown[] = []
        const objects = await followProgress(Readable.from(['{"status":"a"}\n{"sta', 'tus":"b"}\r\nnot json\n\n{"error":"c"}']), (object: unknown): unknown => seen.push(object))
        assert.deepStrictEqual(objects, [{status: 'a'}, {status: 'b'}, {error: 'c'}])
        assert.deepStrictEqual(seen, objects)
    })

    it('decodes the progress of the builds of BuildKit, as docker build --progress=plain shows it', (): void => {
        //A status of Docker 29: the export of an image, done
        const real = decodeBuildKitStatus('CnkKR3NoYTI1NjpmMWM5ZDIzNTNhOWRlZjgwOTI2OGRmMjhhMjU4YzExNTA2ODcxMWE0ZmFiYzM1MjNkOGJhZDIxOTgyMDc3MjFjGhJleHBvcnRpbmcgdG8gaW1hZ2UqDAiHqvTVBhCkiIjYAzIMCIiq9NUGEJbpiKcB')
        assert.strictEqual(real.vertexes.length, 1)
        assert.strictEqual(real.vertexes[0].digest, 'sha256:f1c9d2353a9def809268df28a258c115068711a4fabc3523d8bad2198207721c')
        assert.strictEqual(real.vertexes[0].name, 'exporting to image')
        assert.ok(real.vertexes[0].started! > 1.7e12 && real.vertexes[0].completed! >= real.vertexes[0].started!)
        const progress: BuildKitProgress = new BuildKitProgress()
        const from: Buffer = Buffer.concat([readField(1, 'sha256:from'), readField(3, '[1/3] FROM alpine'), readField(4, 1)])
        const run: (fields: Buffer[]) => Buffer = (fields: Buffer[]): Buffer => Buffer.concat([readField(1, 'sha256:run'), readField(3, '[2/3] RUN echo a > /b'), ...fields])
        const lines: string[] = [
            ...progress.lines(decodeBuildKitStatus(aux(readField(1, from), readField(1, run([readField(5, timestamp(1000))]))))),
            //An output line cut between two statuses, then the step done
            ...progress.lines(decodeBuildKitStatus(aux(readField(3, Buffer.concat([readField(1, 'sha256:run'), readField(3, 1), readField(4, 'line one\nline t')]))))),
            ...progress.lines(decodeBuildKitStatus(aux(readField(3, Buffer.concat([readField(1, 'sha256:run'), readField(3, 1), readField(4, 'wo\nlast')]))))),
            ...progress.lines(decodeBuildKitStatus(aux(readField(1, run([readField(5, timestamp(1000)), readField(6, timestamp(3500))]))))),
            //A step failed, and a warning
            ...progress.lines(decodeBuildKitStatus(aux(
                readField(1, Buffer.concat([readField(1, 'sha256:fail'), readField(3, '[3/3] RUN exit 3'), readField(5, timestamp(4000)), readField(6, timestamp(4200)), readField(7, 'exit code: 3')])),
                readField(4, Buffer.concat([readField(1, 'sha256:fail'), readField(2, 1), readField(3, 'JSONArgsRecommended')]))
            )))
        ]
        assert.deepStrictEqual(lines, [
            '#1 [1/3] FROM alpine',
            '#1 CACHED',
            '#2 [2/3] RUN echo a > /b',
            '#2 line one',
            '#2 line two',
            '#2 last',
            '#2 DONE 2.5s',
            '#3 [3/3] RUN exit 3',
            '#3 ERROR: exit code: 3',
            '#3 WARN: JSONArgsRecommended'
        ])
    })

    it('excludes the files of .dockerignore as Docker does', (): void => {
        const ignore: DockerIgnore = new DockerIgnore('# a comment\n*.key\n/build\n**/*.log\nnode_modules\ndocs/*\n!docs/README.md\n*.md\n!README.md\n')
        const cases: Record<string, boolean> = {
            'a.key': true, 'src/a.key': false,
            'build': true, 'build/app.js': true, 'src/build/app.js': false,
            'a.log': true, 'src/deep/a.log': true,
            'node_modules/x/index.js': true, 'packages/app/node_modules/x/index.js': false,
            //"*.md" matches the files of the root only
            'docs/guide.txt': true, 'docs/README.md': false, 'CHANGELOG.md': true, 'README.md': false,
            'src/index.ts': false, 'Dockerfile': false
        }
        for (const [file, ignored] of Object.entries(cases)) assert.strictEqual(ignore.ignores(file), ignored, file)
        //The last rule matching decides
        assert.strictEqual(new DockerIgnore('*\n!src\n').ignores('src/index.ts'), false)
        assert.strictEqual(new DockerIgnore('*\n!src\n').ignores('package.json'), true)
    })

    it('finds the base images of a Dockerfile', (): void => {
        const dockerfile: string = [
            'ARG NODE=22',
            'ARG REGISTRY',
            'FROM --platform=$BUILDPLATFORM node:${NODE}-alpine AS build',
            'RUN npm ci',
            'FROM build AS test',
            'FROM ${REGISTRY}/private:1 AS private',
            'FROM scratch',
            'FROM \\',
            '  registry.example.com:5000/team/app:1.0',
            'COPY --from=build /app /app'
        ].join('\n')
        assert.deepStrictEqual(parseBaseImages(dockerfile), ['node:22-alpine', 'registry.example.com:5000/team/app:1.0'])
        assert.deepStrictEqual(parseBaseImages(dockerfile, {NODE: '20', REGISTRY: 'ghcr.io/me'}), ['node:20-alpine', 'ghcr.io/me/private:1', 'registry.example.com:5000/team/app:1.0'])
    })

    describe('The context of the builds', (): void => {

        let directory: string

        before(async (): Promise<void> => {
            directory = await mkdtemp(path.join(tmpdir(), 'lakutata-context-'))
            await mkdir(path.join(directory, 'src', 'lib'), {recursive: true})
            await writeFile(path.join(directory, 'Dockerfile'), 'FROM alpine\n')
            await writeFile(path.join(directory, 'src', 'lib', 'a.txt'), 'a')
            await writeFile(path.join(directory, 'src', 'secret.key'), 'secret')
            await symlink('lib/a.txt', path.join(directory, 'src', 'link.txt'))
            await writeFile(path.join(directory, '.dockerignore'), '**/*.key\nDockerfile\n')
        })

        after(async (): Promise<void> => rm(directory, {recursive: true, force: true}))

        /**
         * The entries of a packed context
         * @param stream
         */
        async function readEntries(stream: NodeJS.ReadableStream): Promise<string[]> {
            const archive: Buffer = Buffer.concat(await Readable.from(stream).toArray())
            const entries: string[] = []
            const extractor = extract()
            extractor.on('entry', (header, content, next): void => {
                entries.push(`${header.type} ${header.name}${header.linkname ? ` -> ${header.linkname}` : ''}`)
                content.on('end', next).resume()
            })
            await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
                extractor.once('finish', resolve).once('error', reject)
                extractor.end(gunzipSync(archive))
            })
            return entries
        }

        it('packs each file once, the directories with their files, without the excluded ones', async (): Promise<void> => {
            const entries: string[] = await readEntries(packBuildContext({directory: directory, entries: ['Dockerfile', 'src', 'src/lib', './src/lib/a.txt', 'src/secret.key', 'src/link.txt'], always: ['Dockerfile']}))
            assert.deepStrictEqual(entries, [
                'file Dockerfile',
                'directory src',
                'directory src/lib',
                'file src/lib/a.txt',
                'symlink src/link.txt -> lib/a.txt'
            ])
            //Excluded by .dockerignore, without always
            assert.ok(!(await readEntries(packBuildContext({directory: directory, entries: ['Dockerfile']}))).includes('file Dockerfile'))
        })

        it('fails the context when a file cannot be packed, instead of ending it', async (): Promise<void> => {
            await assert.rejects(readEntries(packBuildContext({directory: directory, entries: ['src', 'missing.txt']})), /ENOENT/)
        })
    })

    describe('The connection', (): void => {

        let server: Server
        let socketPath: string
        let requests: IncomingMessage[] = []
        const bodies: Map<IncomingMessage, string> = new Map()
        let version: Record<string, string> = {ApiVersion: '1.60', MinAPIVersion: '1.40'}

        before(async (): Promise<void> => {
            //A named pipe on Windows (as Docker Desktop: //./pipe/docker_engine), a socket elsewhere
            socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\lakutata-docker-${process.pid}-${Date.now()}` : path.join(await mkdtemp(path.join(tmpdir(), 'lakutata-socket-')), 'docker.sock')
            server = http.createServer((request: IncomingMessage, response: ServerResponse): void => {
                requests.push(request)
                const chunks: Buffer[] = []
                request.on('data', (chunk: Buffer): unknown => chunks.push(chunk))
                request.on('end', (): void => {
                    bodies.set(request, Buffer.concat(chunks).toString())
                    const url: URL = new URL(request.url!, 'http://docker')
                    response.setHeader('Content-Type', 'application/json')
                    if (url.pathname === '/version') return void response.end(JSON.stringify(version))
                    if (url.pathname.endsWith('/containers/missing/json')) return void response.writeHead(404).end(JSON.stringify({message: 'No such container: missing'}))
                    response.end(JSON.stringify({path: url.pathname}))
                })
            })
            server.on('upgrade', (request: IncomingMessage, socket: Socket): void => {
                requests.push(request)
                socket.write('HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n')
                socket.write(encodeFrame(DockerStreamType.STDOUT, 'hijacked\n'))
                socket.end()
            })
            await new Promise((resolve: (value: unknown) => void): unknown => server.listen(socketPath, (): void => resolve(undefined)))
        })

        after(async (): Promise<void> => {
            await new Promise((resolve: (value: unknown) => void): unknown => server.close(resolve))
            //The directory of the socket (a named pipe has none)
            if (process.platform !== 'win32') await rm(path.dirname(socketPath), {recursive: true, force: true})
        })

        it('negotiates the API version: the newest one supported by the daemon and the client', async (): Promise<void> => {
            for (const [daemon, expected] of [[{ApiVersion: '1.60', MinAPIVersion: '1.40'}, '1.56'], [{ApiVersion: '1.43', MinAPIVersion: '1.24'}, '1.43'], [{ApiVersion: '1.70', MinAPIVersion: '1.60'}, '1.60']] as [Record<string, string>, string][]) {
                version = daemon
                const connection: DockerConnection = new DockerConnection({socketPath: socketPath})
                assert.strictEqual(await connection.negotiate(), expected)
                requests = []
                await connection.request({method: 'GET', path: '/info', statusCodes: {200: true}})
                assert.strictEqual(requests[0].url, `/v${expected}/info`)
                connection.close()
            }
            //Given, it is not negotiated
            const given: DockerConnection = new DockerConnection({socketPath: socketPath, version: 'v1.41'})
            assert.strictEqual(await given.negotiate(), '1.41')
            given.close()
        })

        it('sends the query parameters, the credentials and the bodies', async (): Promise<void> => {
            const connection: DockerConnection = new DockerConnection({socketPath: socketPath, version: '1.56'})
            requests = []
            await connection.request({
                method: 'POST',
                path: '/build',
                query: {t: ['a:1', 'b:2'], buildargs: {NODE: '22'}, nocache: true, q: false, platform: undefined},
                auth: {username: 'me', password: 'secret'},
                registryConfig: {'registry.example.com': {username: 'me'}},
                body: {Image: 'alpine'},
                statusCodes: {200: true}
            })
            const url: URL = new URL(requests[0].url!, 'http://docker')
            assert.deepStrictEqual(url.searchParams.getAll('t'), ['a:1', 'b:2'])
            assert.strictEqual(url.searchParams.get('buildargs'), '{"NODE":"22"}')
            assert.strictEqual(url.searchParams.get('nocache'), 'true')
            assert.strictEqual(url.searchParams.get('q'), 'false')
            assert.ok(!url.searchParams.has('platform'))
            assert.deepStrictEqual(JSON.parse(Buffer.from(requests[0].headers['x-registry-auth'] as string, 'base64url').toString()), {username: 'me', password: 'secret'})
            assert.deepStrictEqual(JSON.parse(Buffer.from(requests[0].headers['x-registry-config'] as string, 'base64').toString()), {'registry.example.com': {username: 'me'}})
            assert.strictEqual(bodies.get(requests[0]), '{"Image":"alpine"}')
            assert.strictEqual(requests[0].headers['content-type'], 'application/json')
            connection.close()
        })

        it('closes the connections of the requests streaming their body, keeps the others alive', async (): Promise<void> => {
            const connection: DockerConnection = new DockerConnection({socketPath: socketPath, version: '1.56'})
            requests = []
            await connection.request({method: 'GET', path: '/images/json', statusCodes: {200: true}})
            const context: PassThrough = new PassThrough()
            context.end(Buffer.alloc(1024 * 1024))
            await Readable.from(await connection.stream({method: 'POST', path: '/build', body: context, statusCodes: {200: true}})).toArray()
            assert.strictEqual(requests[0].headers.connection, 'keep-alive')
            assert.strictEqual(requests[1].headers.connection, 'close')
            assert.strictEqual(requests[1].headers['content-type'], 'application/x-tar')
            assert.strictEqual(bodies.get(requests[1])!.length, 1024 * 1024)
            connection.close()
        })

        it('fails with the status and the message of the daemon', async (): Promise<void> => {
            const connection: DockerConnection = new DockerConnection({socketPath: socketPath, version: '1.56'})
            await assert.rejects(connection.request({method: 'GET', path: '/containers/missing/json', statusCodes: {200: true, 404: 'no such container'}}), (error: Error): boolean => {
                return error instanceof DockerRequestError && error.statusCode === 404 && error.message === '(HTTP code 404) no such container - No such container: missing '
            })
            connection.close()
        })

        it('hijacks the connections of the attached executions', async (): Promise<void> => {
            const connection: DockerConnection = new DockerConnection({socketPath: socketPath, version: '1.56'})
            requests = []
            const stream = await connection.hijack({method: 'POST', path: '/exec/x/start', body: {Detach: false, Tty: false}, statusCodes: {200: true}})
            assert.strictEqual((await readMultiplexed(stream)).output, 'hijacked\n')
            assert.strictEqual(requests[0].headers.upgrade, 'tcp')
            connection.close()
        })

        it('applies the options given to the Docker of the environment', async (): Promise<void> => {
            const saved: string | undefined = process.env.DOCKER_HOST
            try {
                process.env.DOCKER_HOST = `${process.platform === 'win32' ? 'npipe' : 'unix'}://${socketPath}`
                //The options not given (undefined) keep the environment's
                const connection: DockerConnection = new DockerConnection({socketPath: undefined, host: undefined, headers: {'X-Proxy-Token': 'secret'}, timeout: 5000, version: '1.56'})
                requests = []
                await connection.request({method: 'GET', path: '/info', statusCodes: {200: true}})
                assert.strictEqual(requests[0].headers['x-proxy-token'], 'secret')
                assert.strictEqual(requests[0].url, '/v1.56/info')
                connection.close()
            } finally {
                if (saved === undefined) delete process.env.DOCKER_HOST
                else process.env.DOCKER_HOST = saved
            }
        })

        it('connects to the Docker of the environment', (): void => {
            const saved: string | undefined = process.env.DOCKER_HOST
            try {
                process.env.DOCKER_HOST = 'tcp://docker.example.com:2376'
                assert.deepStrictEqual({...defaultConnectionOptions()}, {host: 'docker.example.com', port: '2376', protocol: 'https'})
                process.env.DOCKER_HOST = 'tcp://docker.example.com:2375'
                assert.strictEqual(defaultConnectionOptions().protocol, 'http')
                process.env.DOCKER_HOST = 'unix:///run/user/1000/docker.sock'
                assert.deepStrictEqual(defaultConnectionOptions(), {socketPath: '/run/user/1000/docker.sock'})
                process.env.DOCKER_HOST = 'ssh://deploy@docker.example.com:2222'
                assert.deepStrictEqual({...defaultConnectionOptions()}, {host: 'docker.example.com', port: '2222', protocol: 'ssh', username: 'deploy'})
            } finally {
                if (saved === undefined) delete process.env.DOCKER_HOST
                else process.env.DOCKER_HOST = saved
            }
        })
    })
})
