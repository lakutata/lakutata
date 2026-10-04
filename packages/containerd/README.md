# @lakutata/containerd

The containerd component of the lakutata framework: it manages the images, containers, CNI networks and named volumes
of a [containerd](https://containerd.io) namespace by talking to containerd's gRPC socket directly, without a Docker
daemon and without nerdctl (the gRPC client is written in TypeScript: no native addon). It targets the Linux machines
running containerd alone, such as embedded devices, with an API following the Docker component's: images pulled with
registry credentials, pushed, tagged, imported, exported and pruned; containers created with ports, volumes, devices,
seccomp and resource limits, then started, stopped, executed in, followed, measured, updated, committed and copied
from; builds sent to BuildKit. The containers it creates are nerdctl's, so `nerdctl ps` lists them. The umbrella
package `lakutata` re-exports it as `lakutata/com/containerd`.

## Installation

```shell
npm install lakutata
```

The component has no optional npm dependency. The machine needs:

| Feature | Needs |
|---|---|
| Everything | Linux, containerd 1.6 or later with runc (tested with 1.6, 1.7 and 2.4), Node.js 22 or later; the application runs as root or as a member of the group owning containerd's socket |
| CNI networks, published ports | The CNI plugins (`bridge`, `portmap`, `host-local`… in `/opt/cni/bin`, `/usr/lib/cni` or `/usr/libexec/cni`) and iptables |
| `exec()` with `stdin`, separate `stdout`/`stderr`, terminals | `mkfifo` on the host (without it, `exec()` puts both outputs in `stdout`) |
| Builds | A BuildKit daemon (`buildkitd`): local, on its unix socket, or remote over TCP/TLS |
| Containers of other architectures | QEMU (or Rosetta) emulators registered in `binfmt_misc` |

## Usage

### The component in an application

Register `Containerd` in the `components` of the application and get it with `getObject()` or `@Inject`. It connects
when it is created: without containerd on `socketPath`, the application fails to start with
`ContainerdConnectionException`. Its namespace is created when it does not exist.

```typescript
import {Application} from 'lakutata'
import {Containerd, type ContainerdContainer, type ContainerdExecResult, type ContainerdImage} from 'lakutata/com/containerd'

Application
    .run(() => ({
        id: 'device.app',
        name: 'Device',
        components: {
            containerd: {
                class: Containerd,
                //The defaults
                socketPath: '/run/containerd/containerd.sock',
                namespace: 'default',
                snapshotter: 'overlayfs',
                //systemd when containerd runs runc with SystemdCgroup = true
                cgroupManager: 'cgroupfs',
                //The containers' logs, hosts, resolv.conf, settings, and the named volumes
                dataRoot: '/var/lib/lakutata/containerd',
                //A container's log file rotated beyond 10 MiB when the component starts it (0: never)
                logMaxSize: 10 * 1024 * 1024,
                registryAuths: {'registry.example.com': {username: 'deploy', password: 'secret'}},
                insecureRegistries: ['localhost:5000']
            }
        },
        bootstrap: ['containerd']
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const containerd: Containerd = await app.getObject('containerd')
        console.log(await containerd.version())
        const image: ContainerdImage = await containerd.pullImage({image: 'alpine:3.20'})
        const container: ContainerdContainer = await containerd.createContainer({image: image.name, name: 'worker', cmd: ['sleep', 'infinity']})
        await container.start()
        const result: ContainerdExecResult = await container.exec({cmd: 'cat /etc/os-release'})
        console.log(result.stdout)
        await container.remove({force: true})
    })
```

### What differs from the Docker component

- No daemon in between: the component itself pulls, unpacks, pushes, imports and exports the images, and generates the
  containers' OCI specifications, as nerdctl does. The containers carry nerdctl's labels (`nerdctl/name`…), and the
  CNI network configurations are nerdctl's (`nerdctl-<name>.conflist`): nerdctl and the component share them.
- A container's output is written to a log file by containerd's shim, and its restart policy is applied by containerd's
  restart monitor: both keep working while the application is stopped. The logs have no timestamps.
- `createContainer()` takes the image in its options, and never pulls it: pull it first. The containers run on the
  host's network by default; ports are published through CNI networks (`networks: [{networkName: 'bridge'}]`).
- There is no `loginRepository()`: the credentials are the `registryAuths` option, or the `auth` of each call.
- `importImage()` returns every image of the archive, and `prune()` returns what it removed.
- A namespace is the unit: the images, containers and volumes of the other namespaces are not seen.

### Images

```typescript
import {type Containerd, type ContainerdImage, type ContainerdPruneResult} from 'lakutata/com/containerd'

declare const containerd: Containerd

//Pulled for the machine's platform, unpacked into the snapshotter (only the platforms the machine runs are unpacked)
const image: ContainerdImage = await containerd.pullImage({
    image: 'alpine:3.20',
    progressCallback: (progress): void => console.log(progress)
})
//docker.io/library/alpine:3.20, ['linux/arm64/v8'], {env, cmd, entrypoint, workingDir, user, exposedPorts…}
console.log(image.name, image.platforms, image.config)

//Other platforms (or 'all'), the credentials of one pull
await containerd.pullImage({image: 'alpine:3.20', platform: ['linux/amd64', 'linux/arm/v7']})
await containerd.pullImage({image: 'registry.example.com/team/app:1.0', auth: {username: 'u', password: 'p'}})

//Tags and pushes: every platform present (with the index), or only the one given
const tagged: ContainerdImage = await image.tag('registry.example.com/team/alpine:3.20')
await tagged.push()
await tagged.push({reference: 'registry.example.com/team/alpine:3.20-arm64', platform: 'linux/arm64'})

//Archives: OCI image layouts with the manifest.json of docker load; docker save archives are imported too
await image.export({destination: '/tmp/alpine.tar'})
await containerd.exportImages(['alpine:3.20', 'busybox'], {destination: '/tmp/images.tar'})
const imported: ContainerdImage[] = await containerd.importImage({source: '/tmp/images.tar'})
console.log(imported.length, (await containerd.listImages()).length)
//Another name: only for an archive of one image
await containerd.importImage({source: '/tmp/alpine.tar', name: 'alpine:backup'})

await tagged.remove()
//The stopped containers and the dangling images (allImages: every image no container uses)
const pruned: ContainerdPruneResult = await containerd.prune({containers: true, images: true, allImages: false})
console.log(pruned.images)
```

The names are normalized as Docker does (`alpine` is `docker.io/library/alpine:latest`). containerd keeps an image's
content while an image or a container uses it. A multi-platform image is described for the first of its platforms
the machine runs.

### Containers

```typescript
import {type Containerd, type ContainerdContainer, type ContainerdContainerStats, type ContainerdExecResult, type ContainerdImage} from 'lakutata/com/containerd'

declare const containerd: Containerd

const container: ContainerdContainer = await containerd.createContainer({
    image: 'alpine:3.20',
    name: 'worker',
    cmd: ['sh', '-c', 'while true; do date; sleep 1; done'],
    env: {MODE: 'production'},
    user: 'nobody',
    labels: {app: 'worker'},
    binds: [{hostPath: '/data/worker', containerPath: '/data'}],
    volumes: [{volumeName: 'worker-cache', containerPath: '/cache'}],
    tmpfs: [{containerPath: '/tmp', size: 16 * 1024 * 1024}],
    //A device, and the USB serial ports plugged later (major 188)
    devices: [{hostPath: '/dev/ttyUSB0'}],
    deviceCgroupRules: ['c 188:* rwm'],
    //And as much swap (memorySwap: twice the memory by default, -1 unlimited)
    memoryLimit: 128 * 1024 * 1024,
    cpus: 0.5,
    restartPolicy: 'always'
})
await container.start()
console.log(container.state.status, container.state.pid)

//A string runs through /bin/sh -c; the outputs are captured in memory
const result: ContainerdExecResult = await container.exec({cmd: 'cat /etc/os-release', user: 'root', timeout: 5000})
console.log(result.exitCode, result.stdout, result.stderr)
await container.exec({cmd: ['sh', '-c', 'cat > /data/input'], stdin: 'content'})

//The last 100 lines; follow (the default) keeps the stream open while the container runs
for await (const chunk of await container.logs({tail: 100, follow: false})) process.stdout.write(chunk)

const stats: ContainerdContainerStats = await container.stats()
console.log(stats.cpu.percent, stats.memory.usage, stats.pids.current)

//Resources and restart policy: live (0 removes a limit); any other setting: the container created again, its name kept
await container.update({memoryLimit: 256 * 1024 * 1024, restartPolicy: 'unless-stopped'})
await container.update({cpus: 0})
await container.update({env: {MODE: 'debug'}})

//Its changes as an image; a directory copied out as a tar archive
const patched: ContainerdImage = await container.commit({repoTag: 'worker:patched', changes: {cmd: ['date']}})
await container.exportDirectory({path: '/var/log', destination: '/tmp/logs.tar'})
console.log(patched.name, await container.processes())

await container.pause()
await container.unpause()
//Its stop signal, then SIGKILL after 10 seconds
await container.stop({timeout: 10})
//A container which is not running: its last exit code at once
console.log(await container.wait())
await container.remove()

console.log(await containerd.listContainers({app: 'worker'}))
```

- The containers get containerd's default seccomp profile, with the system calls their `capabilities` allow (as
  nerdctl does); `seccompProfile: 'unconfined'` disables it, and a file path gives an OCI profile. The privileged
  containers are unconfined.
- `devices` creates the host's devices in the container (a device, or every device of a directory such as `/dev/snd`).
  For the devices plugged later, bind their directory and allow their numbers with `deviceCgroupRules`, as Docker's
  `--device-cgroup-rule` does. A `privileged` container gets every device of the host's `/dev` (as nerdctl gives
  them).
- The containers have their own cgroup namespace on cgroup v2 (`cgroupns: 'host'` shares the host's).
- `privileged`, `capabilities`, `capabilitiesDrop`, `readonlyRootfs`, `pidMode: 'host'`, `ipcMode: 'host'`, `sysctls`,
  `extraHosts`, `dns`, `shmSize`, `pidsLimit`, `cpuSet`, `cpuShares`, `memorySwap` and `OOMKillDisable` are Docker's
  options of the same names. As with Docker, `memorySwap` is the memory and the swap together, needs `memoryLimit`,
  and is twice `memoryLimit` by default.
- `update()` with other settings than the resources and the restart policy only works for the containers the component
  created (it keeps their settings in `dataRoot`). A resource set to `0` (`cpuSet: []`) is removed at once, from the
  running container too.
- `wait()` of a container which is not running resolves at once, as `docker wait` does: the exit code of its last run,
  `0` when it was never started.

Terminals run a process with a pseudo terminal in a running container: `/bin/sh` by default; a string command runs
through `/bin/sh -c` as `exec()` runs it, an array as it is.

```typescript
import {type Containerd, type ContainerdContainer, type ContainerdContainerTTY} from 'lakutata/com/containerd'

declare const containerd: Containerd

const container: ContainerdContainer = await containerd.getContainer('worker')
const tty: ContainerdContainerTTY = await container.createTTY({consoleSize: {cols: 120, rows: 40}})
tty.onData((chunk: Buffer): void => {
    process.stdout.write(chunk)
})
tty.write('ls\n')
await tty.resize({cols: 100, rows: 30})
//Or tty.raw, a duplex stream to pipe a socket into
await tty.close()
```

### Networks

Besides `host` (the default) and `none`, the containers join CNI networks: nerdctl's default `bridge` (`nerdctl0`,
`10.4.0.0/24`, created when first asked for) and the networks created, bridges, macvlans or ipvlans, with IPv4 and
IPv6 subnets. Each container's networks are set up by its runc hooks, so they also work when containerd restarts it
without the application.

```typescript
import {type Containerd, type ContainerdContainer, type ContainerdNetworkInfo} from 'lakutata/com/containerd'

declare const containerd: Containerd

//A free subnet of 10.4.0.0/16 without subnet
const backend: ContainerdNetworkInfo = await containerd.createNetwork({name: 'backend', subnet: '10.4.10.0/24'})
await containerd.createNetwork({name: 'dual', subnet: '10.4.11.0/24', ipv6Subnet: 'fd00:4:11::/64'})
await containerd.createNetwork({name: 'lan', driver: 'macvlan', parent: 'eth0', subnet: '192.168.1.0/24', gateway: '192.168.1.1'})

const web: ContainerdContainer = await containerd.createContainer({
    image: 'nginx:alpine',
    //eth0 and eth1
    networks: [{networkName: 'bridge'}, {networkName: backend.name, ip: '10.4.10.5'}],
    //Published through the first network
    ports: [{port: 80, hostPorts: [8080]}]
})
await web.start()
console.log(web.networks, web.ports)

await web.remove({force: true})
//Refused while a container uses it
await containerd.removeNetwork('backend')
console.log(await containerd.listNetworks())
```

### Volumes

Named volumes are directories under `dataRoot`, created when a container mounts them or by `createVolume()`.

```typescript
import {type Containerd, type ContainerdVolumeInfo} from 'lakutata/com/containerd'

declare const containerd: Containerd

const volume: ContainerdVolumeInfo = await containerd.createVolume({name: 'data', labels: {app: 'web'}})
console.log(volume.mountpoint)
await containerd.createContainer({image: 'alpine:3.20', volumes: [{volumeName: 'data', containerPath: '/var/lib/app'}]})
console.log(await containerd.listVolumes())
//The unused networks and volumes too
await containerd.prune({networks: true, volumes: true})
```

`removeVolume()` refuses a volume that a container mounts, even a stopped one.

### Builds with BuildKit

`buildImage()` sends the build context (without the files its `.dockerignore` excludes) and the Dockerfile to BuildKit
over its session, as `docker buildx` does, then imports the image built into containerd. BuildKit is a local
`buildkitd` (its unix socket, with its containerd or runc worker) or a remote one over TCP, with TLS:

```typescript
import {readFileSync} from 'node:fs'
import {Application} from 'lakutata'
import {Containerd, type ContainerdImage} from 'lakutata/com/containerd'

Application
    .run(() => ({
        id: 'builder.app',
        name: 'Builder',
        components: {
            containerd: {
                class: Containerd,
                buildkitAddress: 'tcp://builder:1234',
                buildkitTLS: {ca: readFileSync('ca.pem'), cert: readFileSync('cert.pem'), key: readFileSync('key.pem')}
            }
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const containerd: Containerd = await app.getObject('containerd')
        console.log(await containerd.buildkitVersion(), await containerd.buildkitPlatforms())
        const image: ContainerdImage = await containerd.buildImage({
            workdir: '/srv/app',
            dockerfile: 'docker/App.Dockerfile',
            repoTag: 'registry.example.com/team/app:1.0',
            buildargs: {NODE_ENV: 'production'},
            //The machine's by default
            platform: ['linux/arm64', 'linux/amd64'],
            push: true,
            outputCallback: (line: string): void => console.log(line)
        })
        console.log(image.platforms)
    })
```

BuildKit pulls the base images with the component's registry credentials (or `auth`).

### Namespaces, platforms and events

Each component works in one namespace; register one component per namespace to manage several (`k8s.io` is the
Kubernetes one). `supportedPlatforms()` lists the platforms the machine runs: its own and the emulators registered in
`binfmt_misc`, so that a container of another architecture runs once its emulator is registered. `events()` streams
containerd's events of the namespace.

```typescript
import {Application} from 'lakutata'
import {Containerd, type ContainerdContainer, type ContainerdEvent} from 'lakutata/com/containerd'

Application
    .run(() => ({
        id: 'events.app',
        name: 'Events',
        components: {
            containerd: {class: Containerd},
            kubernetes: {class: Containerd, namespace: 'k8s.io'}
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const containerd: Containerd = await app.getObject('containerd')
        console.log(containerd.supportedPlatforms())
        await containerd.pullImage({image: 'alpine:3.20', platform: 'linux/amd64'})
        const container: ContainerdContainer = await containerd.createContainer({image: 'alpine:3.20', platform: 'linux/amd64', cmd: ['uname', '-m']})
        await container.start()
        const abort: AbortController = new AbortController()
        setTimeout((): void => abort.abort(), 60000)
        for await (const event of containerd.events(abort.signal)) {
            //{topic: '/tasks/exit', type: 'containerd.events.TaskExit', event: {containerId, exitStatus…}, namespace, timestamp}
            const received: ContainerdEvent = event
            console.log(received.topic, received.event)
        }
    })
```

## API

| Export | What it is |
|---|---|
| `Containerd` | The component: `version`, `supportedPlatforms`, `detectPlatforms`, `events`; images (`listImages`, `getImage`, `pullImage`, `buildImage`, `buildkitVersion`, `buildkitPlatforms`, `importImage`, `exportImages`); networks (`listNetworks`, `getNetwork`, `createNetwork`, `removeNetwork`); containers (`listContainers`, `getContainer`, `createContainer`); volumes (`listVolumes`, `getVolume`, `createVolume`, `removeVolume`); `prune`. Its options: `socketPath`, `namespace`, `snapshotter`, `runtime`, `cgroupManager`, `dataRoot`, `logMaxSize`, `cniConfigPath`, `cniPath`, `buildkitAddress`, `buildkitTLS`, `registryAuths`, `insecureRegistries` |
| `ContainerdImage` | An image: `name`, `digest`, `platforms`, `platform`, `size`, `config`…; `tag`, `push`, `export`, `remove`, `syncImageInfo` |
| `ContainerdContainer` | A container: `id`, `name`, `state`, `networks`, `ports`, `volumes`…; `start`, `stop`, `restart`, `kill`, `pause`, `unpause`, `wait`, `remove`, `exec`, `logs`, `stats`, `createTTY`, `update`, `commit`, `exportDirectory`, `processes`, `image`, `syncContainerInfo` |
| `ContainerdContainerTTY` | A terminal in a container: `raw`, `readable`, `writable`, `onData`, `write`, `resize`, `wait`, `close` |
| `ImagePullOptions`, `ImagePushOptions`, `ImageBuildOptions`, `ImageImportOptions`, `ImageExportOptions` | The options of the image operations |
| `ContainerCreateOptions`, `ContainerStopOptions`, `ContainerKillOptions`, `ContainerRemoveOptions`, `ContainerExecOptions`, `ContainerLogsOptions`, `ContainerTTYOptions`, `ContainerTTYConsoleSizeOptions`, `ContainerResourceOptions`, `ContainerCommitOptions`, `ContainerExportDirectoryOptions` | The options of the container operations |
| `NetworkCreateOptions`, `VolumeCreateOptions`, `ContainerdPruneOptions`, `ContainerdRegistryAuthOptions` | The options of the networks, the volumes, `prune` and the registry credentials |
| `ContainerdBind`, `ContainerdVolume`, `ContainerdTmpfs`, `ContainerdDevice`, `ContainerdContainerPort`, `ContainerdRestartPolicy` | The parts of the container options |
| `ContainerdContainerState`, `ContainerdContainerNetwork`, `ContainerdContainerStats`, `ContainerdExecResult`, `ContainerdImageConfig`, `ContainerdNetworkInfo`, `ContainerdVolumeInfo`, `ContainerdPruneResult`, `ContainerdEvent` | The information returned |
| `ContainerdProgressCallback`, `ContainerdBuildOutputCallback` | The callbacks of the transfers and of the builds |
| `ContainerdConnectionException` and the other `Containerd*Exception` | The exceptions (see below) |

All are exported by `lakutata/com/containerd` and `@lakutata/containerd`. The typings document each declaration with
examples.

## Errors

| Exception | When |
|---|---|
| `ContainerdConnectionException` (`E_CONTAINERD_CONNECTION`) | The component is created and containerd does not answer on `socketPath` (not running, no access to the socket), or `buildkitTLS` is given with a unix socket `buildkitAddress` |
| `ContainerdImageNotFoundException` (`E_CONTAINERD_IMAGE_NOT_FOUND`) | No image has the name: `getImage()`, `createContainer()` of an image not pulled, an operation on an image removed |
| `ContainerdPlatformException` (`E_CONTAINERD_PLATFORM`) | The image has no manifest for the platform asked (pull, push, container creation) |
| `ContainerdImagePullException` (`E_CONTAINERD_IMAGE_PULL`) | The registry cannot be reached, refuses the credentials or does not have the reference; the transfer or the unpacking fails |
| `ContainerdImagePushException` (`E_CONTAINERD_IMAGE_PUSH`) | The registry cannot be reached or refuses the push |
| `ContainerdImageImportException` (`E_CONTAINERD_IMAGE_IMPORT`) | The archive cannot be read or has no image; a `name` is given with an archive of several images; the unpacking fails |
| `ContainerdImageExportException` (`E_CONTAINERD_IMAGE_EXPORT`) | The archive cannot be written |
| `ContainerdImageBuildException` (`E_CONTAINERD_IMAGE_BUILD`) | BuildKit cannot be reached, the build fails, or the image built cannot be imported |
| `ContainerdContainerNotFoundException` (`E_CONTAINERD_CONTAINER_NOT_FOUND`) | No container has the identifier, name or prefix |
| `ContainerdContainerNameConflictException` (`E_CONTAINERD_CONTAINER_NAME_CONFLICT`) | Another container has the name |
| `ContainerdContainerStateException` (`E_CONTAINERD_CONTAINER_STATE`) | `exec()`, `createTTY()`, `stats()`, `kill()`, `pause()`, `unpause()`, `processes()` on a container not running; `start()` on a paused one; `remove()` on a running one without `force`; an `update()` recreating a container the component did not create |
| `ContainerdPathNotFoundException` (`E_CONTAINERD_PATH_NOT_FOUND`) | `exportDirectory()` of a path missing from the container |
| `ContainerdNetworkNotFoundException` (`E_CONTAINERD_NETWORK_NOT_FOUND`) | No network has the name or identifier; a container created on a missing network |
| `ContainerdNetworkConflictException` (`E_CONTAINERD_NETWORK_CONFLICT`) | The network exists, its subnet overlaps another one, a container uses it, it is the default `bridge`, or nerdctl did not create it |
| `ContainerdVolumeNotFoundException` (`E_CONTAINERD_VOLUME_NOT_FOUND`) | The volume does not exist |
| `ContainerdVolumeInUseException` (`E_CONTAINERD_VOLUME_IN_USE`) | A container mounts the volume |
| `InvalidValueException` (from `lakutata`) | The component's options are invalid, when it is created; a live `update()` of a `memorySwap` without a memory limit, or below it |
| `InvalidMethodAcceptException` (from `lakutata`) | The arguments of a call do not match its options (a container name with a space, a missing `image`, a `memorySwap` without `memoryLimit`) |
| `GRPCError` (from `@lakutata/grpc`) | `wait()` aborted (the object destroyed); containerd lost |
| `Error` | The settings of a container cannot be applied (ports without a CNI network, no command, no CNI plugin, a user missing from the image); a container prefix matching several containers |

## See also

- `doc/en/ContainerdIntegration.md` of the package `lakutata` (Chinese in `doc/zh`): the guide of the component.
- `@lakutata/docker` (`lakutata/com/docker`): the same operations through a Docker daemon.
- `@lakutata/grpc`: the gRPC client the component and its builds use.
- `@lakutata/core` (`lakutata`): the components, `Application` and the dependency injection.
- `npm run test:engines` (in this package) runs the engine tests against containerd 1.6, 1.7 and 2.4 in privileged
  Docker containers (`test-env/run.sh 2.4` for one version, `--build` to rebuild its image), with a local and a remote
  BuildKit; see `test-env/README.md`.
