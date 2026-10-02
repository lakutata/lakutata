import assert from 'node:assert'
import {Application} from '../../../exports/Lakutata.js'
import {Docker, type DockerContainer, type DockerImage, type NetworkInfo} from '../../../exports/DockerComponent.js'
import {RunChecks} from '../support/Scenario.js'

/**
 * The image of the containers of the checks: an image of the machine (no pull), LAKUTATA_DOCKER_IMAGE or postgres:16-alpine
 */
const IMAGE: string = process.env.LAKUTATA_DOCKER_IMAGE ?? 'postgres:16-alpine'

/**
 * The names of the resources created by the checks, removed at their end
 */
const NAME: string = `lakutata-integration-${process.pid}`

Application
    .run(() => ({
        id: 'integration.docker',
        name: 'IntegrationDocker',
        components: {
            log: {level: 'warn'},
            docker: {class: Docker}
        }
    }))
    .onLaunched((app: Application): Promise<void> => RunChecks(app, async (check): Promise<void> => {
        const docker: Docker = await app.getObject<Docker>('docker')
        let image: DockerImage | undefined
        let network: NetworkInfo | undefined
        let container: DockerContainer | undefined
        try {
            await check(`the image ${IMAGE} of the machine is listed`, async (): Promise<void> => {
                image = await docker.getImage(IMAGE)
                assert.ok(image.repoTags.includes(IMAGE), image.repoTags.join(','))
                assert.ok((await docker.listImages()).some((listed: DockerImage): boolean => listed.id === image!.id))
            })

            await check('a network is created and listed', async (): Promise<void> => {
                network = await docker.createNetwork({name: NAME, driver: 'bridge', NetworkIPAMConfigs: []})
                assert.ok((await docker.listNetworks()).some((listed: NetworkInfo): boolean => listed.name === NAME))
            })

            await check('a container of the image, on the network, runs its command and gives its logs', async (): Promise<void> => {
                container = await docker.createContainer(image!.id, {name: NAME, cmd: ['sh', '-c', 'echo "integration of $SCENARIO"'], env: {SCENARIO: 'lakutata'}, networks: [{networkName: NAME}]})
                assert.ok((await docker.listContainers()).some((listed: DockerContainer): boolean => listed.id === container!.id))
                await container.start()
                let logs: string = ''
                for (let attempt: number = 0; attempt < 50 && !logs.includes('integration of lakutata'); attempt++) {
                    await new Promise((resolve: (value?: unknown) => void): unknown => setTimeout(resolve, 200))
                    //The logs of a container are a stream, ended when they are not followed
                    const chunks: Buffer[] = []
                    for await (const chunk of await container.logs({stdout: true, stderr: true})) chunks.push(Buffer.from(chunk as Buffer))
                    logs = Buffer.concat(chunks).toString()
                }
                assert.match(logs, /integration of lakutata/)
            })
        } finally {
            await check('the container and the network are removed', async (): Promise<void> => {
                if (container) await container.remove({force: true})
                if (network) await docker.removeNetwork(network.id)
                assert.ok(!(await docker.listContainers()).some((listed: DockerContainer): boolean => listed.name === NAME || listed.name === `/${NAME}`))
                assert.ok(!(await docker.listNetworks()).some((listed: NetworkInfo): boolean => listed.name === NAME))
            })
        }
    }))
    .onFatalException((error: Error): number => {
        console.error(error)
        return 1
    })
