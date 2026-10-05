# Lakutata Docker Integration

The **Docker component** (`lakutata/com/docker`, package `@lakutata/docker`) drives a Docker daemon over the Docker
Engine API, without the Docker CLI: it pulls, builds (with BuildKit), imports, exports, tags and pushes images, creates,
runs and manages containers (exec, interactive TTYs, logs, stats, commit, file export) and manages networks. It
connects to a local socket, or to a remote daemon over HTTP, HTTPS or SSH. The README of `@lakutata/docker` and the
typings of `lakutata/com/docker` give every option.

The component is not preset: declare it in the `components` of the application. For a machine running containerd
without Docker (embedded Linux devices), see [ContainerdIntegration](ContainerdIntegration.md).

## 1. Requirements and connections

The component needs a Docker daemon (Docker Engine or Docker Desktop, Engine API 1.41 or newer) reachable from the
application. The SSH connections use the optional peer dependency `ssh2` (`npm install ssh2`) and the Docker CLI on the
remote host.

| Connection | Options |
|---|---|
| The Docker of the environment (default) | none: `DOCKER_HOST`, `DOCKER_TLS_VERIFY`, `DOCKER_CERT_PATH`, `DOCKER_CLIENT_TIMEOUT`, else the local socket |
| Unix socket / Windows named pipe | `socketPath` (`buildDockerSocketConnectionOptions`) |
| TCP, plain HTTP | `host`, `port` (`buildDockerHttpConnectionOptions`) |
| TCP, HTTPS | `host`, `port`, `ca`, `cert`, `key` as PEM contents (`buildDockerHttpsConnectionOptions`) |
| SSH | `host`, `port`, `username`, `sshAuthAgent` (`buildDockerSSHConnectionOptions`) |

When it is created, the component pings the daemon and negotiates the API version: an unreachable daemon fails the
launch with `DockerConnectionException`. `timeout` (milliseconds) is the time a request may stay idle.

```typescript
import {readFileSync} from 'node:fs'
import {Application} from 'lakutata'
import {buildDockerHttpsConnectionOptions, buildDockerSocketConnectionOptions, Docker} from 'lakutata/com/docker'

Application.run(() => ({
    id: 'docker.app',
    name: 'Docker',
    components: {
        //The Docker of the environment: DOCKER_HOST, else the local socket
        docker: {class: Docker},
        //A socket, with a request timeout of 60 s
        local: buildDockerSocketConnectionOptions({socketPath: '/var/run/docker.sock', timeout: 60000}),
        //TLS: the PEM contents, not the file paths
        remote: buildDockerHttpsConnectionOptions({
            host: 'docker.example.com',
            port: 2376,
            ca: readFileSync('/etc/docker/certs/ca.pem'),
            cert: readFileSync('/etc/docker/certs/cert.pem'),
            key: readFileSync('/etc/docker/certs/key.pem')
        })
    },
    bootstrap: ['docker']
}))
```

## 2. A first example

```typescript
import {Application} from 'lakutata'
import {Docker, type DockerContainer, type DockerImage} from 'lakutata/com/docker'

Application
    .run(() => ({
        id: 'docker.app',
        name: 'Docker',
        components: {
            docker: {class: Docker}
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const docker: Docker = await app.getObject<Docker>('docker')

        //Pulled, then looked up as alpine:3.20
        const image: DockerImage = await docker.pullImage({repo: 'alpine', tag: '3.20'})

        //Created, then started
        const container: DockerContainer = await image.run({
            name: 'hello',
            cmd: ['sh', '-c', 'echo started; sleep 3600'],
            env: {MODE: 'production'}
        })
        console.log(container.id, container.state.status)

        //The exit code, stdout and stderr
        const {exitCode, stdout} = await container.exec({cmd: ['cat', '/etc/alpine-release']})
        console.log(exitCode, stdout)

        await container.stop({timeout: 10})
        await container.remove()
    })
```

## 3. Images

```typescript
import {createReadStream} from 'node:fs'
import {type Docker, type DockerImage} from 'lakutata/com/docker'

async function images(docker: Docker): Promise<void> {
    //Pull, with the registry's credentials and the progress messages
    await docker.pullImage({
        repo: 'registry.example.com/base/node',
        tag: '22',
        platform: 'linux/amd64',
        auth: {serverAddress: 'registry.example.com', username: 'ci', password: 'secret'},
        outputCallback: (output: Record<string, any>): void => console.log(output.status, output.progress ?? '')
    })

    //Build with BuildKit: the context is the files listed (directories with their content), minus .dockerignore
    const app: DockerImage = await docker.buildImage({
        workdir: '/srv/app',
        files: ['Dockerfile', 'package.json', 'src'],
        repoTag: 'app:1.0.0',
        buildargs: {NODE_ENV: 'production'},
        outputCallback: (output: Record<string, any>): void => console.log(output.stream ?? '')
    })

    //Tag, push, save to an archive, load it back
    await app.tag({repo: 'registry.example.com/team/app', tag: '1.0.0'})
    await app.push({repo: 'registry.example.com/team/app', tag: '1.0.0', auth: {serverAddress: 'registry.example.com', username: 'ci', password: 'secret'}})
    await app.export({destination: '/tmp/app.tar', repoTag: 'app:1.0.0'})
    const loaded: DockerImage = await docker.importImage({source: createReadStream('/tmp/app.tar')})
    console.log(loaded.repoTags)

    //Look up by ID, short ID or name, list, remove (forced by default), prune
    console.log((await docker.getImage('app:1.0.0')).id)
    console.log((await docker.listImages()).map((image: DockerImage): string[] => image.repoTags))
    await app.remove()
    await docker.prune({containers: false, images: true, networks: false, volumes: false})
}
```

- `getImage()` resolves the names as the daemon does: the full or short ID, `alpine` for `alpine:latest`, a digest.
- `prune()` without options prunes the stopped containers and the dangling images; the unused networks and anonymous
  volumes only when asked (`networks: true`, `volumes: true`).

## 4. Containers

```typescript
import {type Docker, type DockerContainer, type DockerContainerTTY, type DockerImage} from 'lakutata/com/docker'

async function containers(docker: Docker): Promise<void> {
    const image: DockerImage = await docker.getImage('nginx:1.27')
    //Created, not started
    const web: DockerContainer = await docker.createContainer(image.id, {
        name: 'web',
        ports: [{port: 80, type: 'tcp', hostPorts: [8080]}],
        binds: [{hostPath: '/srv/www', containerPath: '/usr/share/nginx/html', rw: false}],
        networks: [{networkName: 'backend', ip: '172.30.0.10'}],
        memoryLimit: 256 * 1024 * 1024,
        restartPolicy: 'unless-stopped'
    })
    await web.start()

    //The logs so far (follow: true keeps the stream open while the container runs)
    const logs: NodeJS.ReadableStream = await web.logs({follow: false, tail: 100})
    logs.pipe(process.stdout)

    //One sample of CPU, memory, network and block I/O
    console.log(await web.stats())

    //A command line (run by /bin/sh -c): resolves with its exit code, stdout and stderr, whatever the exit code
    const {exitCode, stdout, stderr} = await web.exec({cmd: 'nginx -t && ls /etc/nginx | wc -l'})
    console.log(exitCode, stdout, stderr)

    //An interactive shell with a TTY (/bin/sh by default)
    const tty: DockerContainerTTY = await web.createTTY({consoleSize: {cols: 120, rows: 40}})
    tty.onData((chunk: Buffer): void => {
        process.stdout.write(chunk)
    })
    tty.write('nginx -v\n')
    await tty.resize({cols: 160, rows: 50})
    tty.write('exit\n')

    //The limits and the restart policy changed live; the other settings by recreating the container (its ID changes)
    await web.update({memoryLimit: 512 * 1024 * 1024, restartPolicy: 'on-failure:3'})

    await web.restart({timeout: 5})
    await web.stop()
    await web.remove({force: true})

    //All the containers, the stopped ones included
    console.log((await docker.listContainers()).map((container: DockerContainer): string => `${container.name}: ${container.state.status}`))
}
```

- A `DockerContainer` is a snapshot: its operations refresh it; the changes made by others are seen by getting it
  again (`docker.getContainer(id)`, which also takes a name or a short ID).
- Starting a running container or stopping a stopped one does nothing, as the Docker CLI.
- `exec()` runs without TTY nor stdin. An array command runs as it is; a string is a command line, run by
  `/bin/sh -c`.
- `kill()` sends `SIGKILL` by default, or the signal given.
- `commit()` makes an image of a container, `exportDirectory()` writes a directory of a container as a tar archive.
- Not provided: attaching to the main process, copying files into a container, the volumes (other than by `prune()`)
  and the daemon's events.

## 5. Networks

```typescript
import {type Docker, type NetworkInfo} from 'lakutata/com/docker'

async function networks(docker: Docker): Promise<void> {
    const network: NetworkInfo = await docker.createNetwork({
        name: 'backend',
        driver: 'bridge',
        NetworkIPAMConfigs: [{subnet: '172.30.0.0/16', gateway: '172.30.0.1'}],
        internal: false
    })
    //The subnet chosen by the daemon
    await docker.createNetwork({name: 'frontend'})
    console.log(network.id, (await docker.listNetworks()).map((item: NetworkInfo): string => item.name))
    await docker.removeNetwork('frontend')
}
```

## 6. Errors

The exceptions of the component are exported by `lakutata/com/docker`: `DockerConnectionException` (the daemon is
unreachable when the component is created), `DockerContainerNotFoundException`, `DockerImageNotFoundException`,
`DockerNetworkNotFoundException`, `DockerImagePullException`, `DockerImageBuildException`,
`DockerImageImportException`, `DockerImagePushException`, `DockerImageRepoTagNotFoundException`, and
`DockerRequestException` (the daemon refuses a request; its `statusCode` is the HTTP status, 409 for a name already
used). Invalid options throw `InvalidMethodAcceptException`. When the component is destroyed, the pulls and builds in
progress are aborted.
