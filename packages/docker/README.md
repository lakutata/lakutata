# @lakutata/docker

The Docker component of the lakutata framework: it drives a Docker daemon over the Docker Engine API, without the
Docker CLI, to pull, build (with BuildKit), import, export, tag and push images, to create, run and manage containers
(exec, interactive TTYs, logs, stats, commit, file export) and to manage networks. It connects to a local socket, or to
a remote daemon over HTTP, HTTPS or SSH. The umbrella package `lakutata` re-exports it as `lakutata/com/docker`.

## Installation

```shell
npm install lakutata
```

The component needs a Docker daemon (Docker Engine or Docker Desktop, Engine API 1.41 or newer) reachable from the
application; no Docker CLI is needed locally. The SSH connections use the optional peer dependency `ssh2`, and the
Docker CLI on the remote host:

```shell
npm install ssh2
```

| Connection | Options | Needs |
|---|---|---|
| The Docker of the environment (default) | none: `DOCKER_HOST`, `DOCKER_TLS_VERIFY`, `DOCKER_CERT_PATH`, `DOCKER_CLIENT_TIMEOUT`, else the local socket | nothing |
| Unix socket / Windows named pipe | `socketPath` (`buildDockerSocketConnectionOptions`) | access to the socket (the `docker` group) |
| TCP, plain HTTP | `host`, `port` (`buildDockerHttpConnectionOptions`) | a daemon listening on TCP (`-H tcp://0.0.0.0:2375`) |
| TCP, HTTPS | `host`, `port`, `ca`, `cert`, `key` as PEM contents (`buildDockerHttpsConnectionOptions`) | a daemon with TLS (`--tlsverify`) |
| SSH | `host`, `port`, `username`, `sshAuthAgent` (`buildDockerSSHConnectionOptions`) | `ssh2` locally; the Docker CLI remotely; a key in the SSH agent |

## Usage

### The component in an application

Register `Docker` in the `components` of the application, then get it with `getObject()` or `@Inject`. When it is
created, the component pings the daemon and negotiates the API version: an unreachable daemon fails the launch with
`DockerConnectionException`.

```typescript
import {Application} from 'lakutata'
import {Docker, type DockerContainer, type DockerImage} from 'lakutata/com/docker'

Application
    .run(() => ({
        id: 'docker.app',
        name: 'Docker',
        components: {
            //The Docker of the environment: DOCKER_HOST, else the local socket
            docker: {class: Docker}
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const docker: Docker = await app.getObject('docker')

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

### Connections

```typescript
import {readFileSync} from 'node:fs'
import {Application} from 'lakutata'
import {
    buildDockerHttpsConnectionOptions,
    buildDockerSocketConnectionOptions,
    buildDockerSSHConnectionOptions,
    Docker
} from 'lakutata/com/docker'

Application.run(() => ({
    id: 'docker.app',
    name: 'Docker',
    components: {
        //A socket, with a request timeout of 60 s
        local: buildDockerSocketConnectionOptions({socketPath: '/var/run/docker.sock', timeout: 60000}),
        //TLS: the PEM contents, not the file paths
        remote: buildDockerHttpsConnectionOptions({
            host: 'docker.example.com',
            port: 2376,
            ca: readFileSync('/etc/docker/certs/ca.pem'),
            cert: readFileSync('/etc/docker/certs/cert.pem'),
            key: readFileSync('/etc/docker/certs/key.pem')
        }),
        //SSH: authenticated by the SSH agent (SSH_AUTH_SOCK)
        builder: buildDockerSSHConnectionOptions({host: 'build.example.com', port: 22, username: 'deploy'}),
        //The options as they are, with a fixed API version
        pinned: {class: Docker, version: '1.47'}
    }
}))
```

- Without `socketPath` nor `host`, the component connects to the Docker of the environment, with the other options
  given (`timeout`, `headers`, `version`…) applied over the environment's.
- `protocol` defaults to `'https'` when `ca`, `cert` and `key` are all given, to `'http'` otherwise.
- `timeout` (milliseconds) is the time a request may stay idle; it also ends the streams (followed logs) idle for that
  long.

### Images

```typescript
import {createReadStream} from 'node:fs'
import {type Docker, type DockerImage} from 'lakutata/com/docker'

declare const docker: Docker

//Pull, with the registry's credentials and the progress messages
const node: DockerImage = await docker.pullImage({
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

//Look up by ID, short ID or name, list, remove (forced by default), prune
console.log((await docker.getImage('app:1.0.0')).id, loaded.repoTags, node.platform)
console.log((await docker.listImages()).map((image: DockerImage): string[] => image.repoTags))
await app.remove()
await docker.prune({containers: false, images: true, networks: false, volumes: false})
```

- `getImage()` resolves the names as the daemon does: the full or short ID, `alpine` for `alpine:latest`,
  `docker.io/library/alpine:3.20`, a digest; `pullImage()` finds the image pulled the same way.
- `listImages()` inspects every image: one request per image.
- `prune()` without options prunes the stopped containers and the dangling images; the unused networks and anonymous
  volumes only when asked (`networks: true`, `volumes: true`).
- The registry credentials (`auth`) are sent whole, the tokens (`identityToken`, `registryToken`) included, by the
  pulls, the builds, the pushes and `loginRepository()`.

### Containers

```typescript
import {createWriteStream} from 'node:fs'
import {type Docker, type DockerContainer, type DockerContainerTTY, type DockerImage} from 'lakutata/com/docker'

declare const docker: Docker

const image: DockerImage = await docker.getImage('nginx:1.27')
//Created, not started
const web: DockerContainer = await docker.createContainer(image.id, {
    name: 'web',
    hostname: 'web',
    ports: [{port: 80, type: 'tcp', hostPorts: [8080]}],
    binds: [{hostPath: '/srv/www', containerPath: '/usr/share/nginx/html', rw: false}],
    networks: [{networkName: 'backend', ip: '172.30.0.10'}],
    memoryLimit: 256 * 1024 * 1024,
    cpuSet: [0, 1],
    restartPolicy: 'unless-stopped'
})
await web.start()

//The logs so far (follow: true keeps the stream open while the container runs)
const logs: NodeJS.ReadableStream = await web.logs({follow: false, tail: 100, timestamps: true})
logs.pipe(process.stdout)

//One sample of CPU, memory, network and block I/O
console.log(await web.stats())

//A command line (run by /bin/sh -c), and its exit code
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

//A directory of the container as a tar archive; an image of its files
await web.exportDirectory({path: '/etc/nginx', destination: createWriteStream('/tmp/nginx-conf.tar')})
const snapshot: DockerImage = await web.commit({repoTag: 'web-snapshot:1'})
console.log(snapshot.id)

//The limits and the restart policy changed live; the other settings by recreating the container (its ID changes)
await web.update({memoryLimit: 512 * 1024 * 1024, restartPolicy: 'on-failure:3'})
await web.update({env: {TZ: 'UTC'}})

await web.restart({timeout: 5})
await web.kill({signal: 'SIGHUP'})
await web.pause()
await web.unpause()
await web.stop()
await web.remove({force: true})

//All the containers, the stopped ones included
console.log((await docker.listContainers()).map((container: DockerContainer): string => `${container.name}: ${container.state.status}`))
```

- A `DockerContainer` is a snapshot: its operations refresh it, the changes made by others are seen by getting it again
  (`docker.getContainer(id)`, which also takes a name or a short ID). A container whose image was removed with force is
  read without it: its `image` is `undefined`.
- Starting a running container or stopping a stopped one does nothing, as the Docker CLI.
- `exec()` runs without TTY nor stdin and resolves with `{exitCode, stdout, stderr}`, whatever the exit code (as the
  containerd component's). An array command runs as it is; a string is a command line, run by `/bin/sh -c`.
- `createTTY()` runs `/bin/sh` by default; its `cmd` follows the rules of `exec()`. Its write failures are logged by the
  application's `log` component, else by the console.
- `kill()` sends `SIGKILL` by default, or the signal given (`'SIGHUP'`, `15`).
- `update()` changes the memory limit, the CPUs and the restart policy live, and the name by renaming the container.
  The other settings recreate it from its whole configuration (command, mounts, networks, the anonymous volumes
  mounted again): created under a temporary name, it replaces the old one only once created (and started, when the
  old one ran), so a failure leaves the old one as it was. Its ID changes; its files outside the volumes are not kept.
- `state.startedAt` and `state.finishedAt` are `null` when the container was never started or never exited.
- Not provided: attaching to the main process, copying files into a container, the volumes (other than by `prune()`)
  and the daemon's events.

### Networks

```typescript
import {type Docker, type NetworkInfo} from 'lakutata/com/docker'

declare const docker: Docker

const network: NetworkInfo = await docker.createNetwork({
    name: 'backend',
    driver: 'bridge',
    NetworkIPAMConfigs: [{subnet: '172.30.0.0/16', gateway: '172.30.0.1'}],
    internal: false
})
//The subnet chosen by the daemon
await docker.createNetwork({name: 'frontend'})
console.log(network.id, network.IPAMConfigs)
//The drivers as Docker reports them: bridge, host, null, overlay…
console.log((await docker.listNetworks()).map((item: NetworkInfo): string => `${item.name}: ${item.driver}`))
//By ID, short ID or name
console.log((await docker.getNetwork('frontend')).id)
await docker.removeNetwork('frontend')
await docker.removeNetwork(network.id)
```

## API

| Export | What it is |
|---|---|
| `Docker` | The component: `pullImage`, `buildImage`, `importImage`, `getImage`, `listImages`, `createContainer`, `getContainer`, `listContainers`, `createNetwork`, `getNetwork`, `listNetworks`, `removeNetwork`, `prune`, `loginRepository`, `checkRepositoryAuth`; the connection options |
| `DockerImage` | An image: `id`, `repoTags`, `platform`, `size`, `config`; `tag()`, `export()`, `push()`, `remove()`, `run()` |
| `DockerContainer` | A container: its settings and `state`; `start()`, `stop()`, `restart()`, `pause()`, `unpause()`, `kill()`, `remove()`, `update()`, `commit()`, `exec()`, `createTTY()`, `logs()`, `stats()`, `exportDirectory()` |
| `DockerContainerTTY` | An interactive command with a TTY: `raw`, `readable`, `writable`, `onData()`, `write()`, `resize()` |
| `buildDockerConnectionOptions`, `buildDockerSocketConnectionOptions`, `buildDockerHttpConnectionOptions`, `buildDockerHttpsConnectionOptions`, `buildDockerSSHConnectionOptions` | Build the component options for each kind of connection |
| `IDockerConnectionOptions`, `IDockerSocketConnectionOptions`, `IDockerHttpConnectionOptions`, `IDockerHttpsConnectionOptions`, `IDockerSSHConnectionOptions`, `IDockerKeyObject` | The connection options |
| `ImagePullOptions`, `ImageBuildOptions`, `ImageImportOptions`, `ImageExportOptions`, `ImageTagOptions`, `ImagePushOptions`, `ImageRemoveOptions` | The options of the image operations |
| `ContainerSettingOptions`, `ContainerStopOptions`, `ContainerKillOptions`, `ContainerRemoveOptions`, `ContainerCommitOptions`, `ContainerExecOptions`, `ContainerCreateTTYOptions`, `ContainerTTYConsoleSizeOptions`, `ContainerLogsOptions`, `ContainerExportDirectoryOptions` | The options of the container operations |
| `NetworkCreateOptions`, `DockerPruneOptions`, `DockerAuthOptions` | The options of the networks, of `prune()`, and the registry credentials |
| `ContainerState`, `ContainerPort`, `ContainerBind`, `ContainerDevice`, `ContainerNetwork`, `ContainerCapability`, `ContainerRestartPolicy`, `ContainerStats`, `ContainerConfig`, `ContainerExecResult` | The types of the containers, and the result of `exec()` |
| `ImageConfig`, `ImageExposePort`, `RepositoryTag`, `NetworkInfo`, `DockerOutputCallback` | The types of the images, the networks and the progress messages |
| `parseRepositoryTag`, `parseEnvToRecord` | Split an image reference into repository and tag; turn `NAME=value` entries into a record |
| `DockerConnectionException`, `DockerContainerNotFoundException`, `DockerImageNotFoundException`, `DockerImagePullException`, `DockerImageBuildException`, `DockerImageImportException`, `DockerImagePushException`, `DockerImageRepoTagNotFoundException`, `DockerNetworkNotFoundException`, `DockerRequestException` | The exceptions |

All are exported by `lakutata/com/docker` and `@lakutata/docker`. The typings document each declaration with examples.

## Errors

| Exception | When |
|---|---|
| `DockerConnectionException` (`E_DOCKER_CONNECTION`) | The component's creation: the daemon unreachable or not answering, the TLS handshake failing, SSH without `ssh2` |
| `DockerContainerNotFoundException` (`E_DOCKER_CONTAINER_NOT_FOUND`) | `getContainer()` finds no container with this ID, short ID or name; an operation of a container removed |
| `DockerImageNotFoundException` (`E_DOCKER_IMAGE_NOT_FOUND`) | `getImage()` finds no image with this ID or name; `createContainer()` (or the recreation of `update()`) of a missing image; an operation of an image removed |
| `DockerImagePullException` (`E_DOCKER_IMAGE_PULL`) | `pullImage()` fails, or the component is destroyed during the pull |
| `DockerImageBuildException` (`E_DOCKER_IMAGE_BUILD`) | `buildImage()` fails: a step, a missing file, a base image which cannot be pulled, the component destroyed during the build |
| `DockerImageImportException` (`E_DOCKER_IMAGE_IMPORT`) | `importImage()`: the daemon rejects the archive, or the loaded image is unknown |
| `DockerImagePushException` (`E_DOCKER_IMAGE_PUSH`) | `push()`: the registry refuses the push |
| `DockerImageRepoTagNotFoundException` (`E_DOCKER_IMAGE_REPO_TAG_NOT_FOUND`) | `export()` of a tag the image does not have, with `createRepoTagIfNotExists: false` |
| `DockerNetworkNotFoundException` (`E_DOCKER_NETWORK_NOT_FOUND`) | `getNetwork()` or `removeNetwork()` with an ID, short ID or name no network has; a container created or recreated on a missing network |
| `DockerRequestException` (`E_DOCKER_REQUEST`) | The daemon refuses a request and no exception above fits: its `statusCode` is the HTTP status (409 a name already used or a container not running, 401 credentials refused by `loginRepository()`, 400 an invalid setting, 500…), its message the daemon's |
| `InvalidMethodAcceptException` (from `lakutata`) | The options of a call are invalid |
| The errors of Node.js | The daemon becomes unreachable after the component's creation (`ECONNREFUSED`…); the `source` file of `importImage()` cannot be read (`ENOENT`…) |

When the component is destroyed (the application stopping), the pulls and builds in progress are aborted and reject
with their exception; the listings in progress resolve with an empty list.

## See also

- `doc/en/DockerIntegration.md` of the package `lakutata` (Chinese in `doc/zh`): the guide of the Docker integration.
- `@lakutata/containerd` (`lakutata/com/containerd`): the same API without a Docker daemon, over containerd.
- `@lakutata/core` (`lakutata`): the components, `Application` and the dependency injection.
- `npm run test:docker` (in this package) tests the component against the Docker of the machine.
