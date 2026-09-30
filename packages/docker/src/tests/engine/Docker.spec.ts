import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {arch, tmpdir} from 'node:os'
import path from 'node:path'
import {Application} from '@lakutata/core'
import {Docker, DockerContainer, DockerImage, NetworkInfo} from '../../exports/Docker.js'

/**
 * The tests run with the Docker of the machine (DOCKER_TEST=1): they pull alpine and create their images, containers and
 * networks, named lakutata-test-*, removed after them
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
            Application.run({id: 'docker.test.app', name: 'docker-test', components: {docker: {class: Docker}}, bootstrap: ['docker']})
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

    it('creates and removes a network', async (): Promise<void> => {
        const network: NetworkInfo = await docker.createNetwork({name: 'lakutata-test-network', NetworkIPAMConfigs: []})
        try {
            assert.ok((await docker.listNetworks()).some(({id}): boolean => id === network.id))
            assert.strictEqual((await docker.getNetwork(network.id)).name, 'lakutata-test-network')
        } finally {
            await docker.removeNetwork(network.id)
        }
        assert.ok(!(await docker.listNetworks()).some(({id}): boolean => id === network.id))
    })
})
