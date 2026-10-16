# Lakutata Containerd Integration

The **containerd component** (`lakutata/com/containerd`, package `@lakutata/containerd`) manages the images, containers,
CNI networks and named volumes of a [containerd](https://containerd.io) namespace over the gRPC API of containerd,
without Docker and without nerdctl. It targets the Linux machines that run containerd alone, such as embedded devices:
the component talks to the socket of containerd (its gRPC client is written in TypeScript, no native addon), and does
by itself what nerdctl does on top of it (pulling from the registries, unpacking the layers, generating the OCI
specifications of the containers, their logs). Its API follows the one of the Docker component
([DockerIntegration](DockerIntegration.md)). The README of `@lakutata/containerd` gives every option.

The containers it creates are the ones of nerdctl: they carry its labels (`nerdctl/name`, `nerdctl/hostname`…), so
`nerdctl ps` and `ctr containers ls` list them.

## 1. Requirements

| Feature | Needs |
|---|---|
| Everything | Linux, containerd 1.6 or later with runc, Node.js 22 or later; the application runs as root or as a member of the group owning the socket of containerd |
| CNI networks (the default `bridge` included), published ports | The CNI plugins (`bridge`, `portmap`, `host-local`… in `/opt/cni/bin`, `/usr/lib/cni` or `/usr/libexec/cni`, the `cniPath` option) and iptables |
| `exec()` with `stdin`, separate `stdout`/`stderr`, terminals | `mkfifo` on the host (without it, `exec()` puts both outputs in `stdout`) |
| Builds | A BuildKit daemon (`buildkitd`), local or remote |
| Containers of other architectures | QEMU (or Rosetta) emulators registered in `binfmt_misc` |

## 2. Configuration

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
                //The logs, hosts, resolv.conf and settings of the containers, and the named volumes
                dataRoot: '/var/lib/lakutata/containerd',
                //The log file of a container rotated beyond 10 MiB when the component starts it (0: never)
                logMaxSize: 10 * 1024 * 1024,
                registryAuths: {'registry.example.com': {username: 'deploy', password: 'secret'}},
                //The registries served over HTTP
                insecureRegistries: ['localhost:5000']
            }
        },
        bootstrap: ['containerd']
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const containerd: Containerd = await app.getObject<Containerd>('containerd')
        console.log(await containerd.version())
        const image: ContainerdImage = await containerd.pullImage({image: 'alpine:3.20'})
        const container: ContainerdContainer = await containerd.createContainer({image: image.name, name: 'worker', cmd: ['sleep', 'infinity']})
        await container.start()
        const result: ContainerdExecResult = await container.exec({cmd: 'cat /etc/os-release'})
        console.log(result.exitCode, result.stdout)
        await container.remove({force: true})
    })
```

The component connects when it is created: without containerd on `socketPath`, the application fails to start with a
`ContainerdConnectionException`. Its namespace is created when it does not exist. Each component works in one
namespace; declare one component per namespace to manage several.

### What differs from the Docker component

- `createContainer()` takes the image in its options and never pulls it: pull it first.
- The output of a container is written to a log file by the shim of containerd, and its restart policy is applied by the
  restart monitor of containerd: both keep working while the application is stopped. The logs have no timestamps.
- There is no `loginRepository()`: the credentials are the `registryAuths` option, or the `auth` of each call.
- `importImage()` returns every image of the archive, and `prune()` returns what it removed.

## 3. Images

```typescript
import {type Containerd, type ContainerdImage, type ContainerdPruneResult} from 'lakutata/com/containerd'

async function images(containerd: Containerd): Promise<void> {
    //Pulled for the platform of the machine, unpacked into the snapshotter
    const image: ContainerdImage = await containerd.pullImage({
        image: 'alpine:3.20',
        progressCallback: (progress): void => console.log(progress)
    })
    //docker.io/library/alpine:3.20, ['linux/arm64/v8'], {env, cmd, entrypoint, workingDir, user, exposedPorts…}
    console.log(image.name, image.platforms, image.config)

    //Other platforms (or 'all'), the credentials of one pull
    await containerd.pullImage({image: 'alpine:3.20', platform: ['linux/amd64', 'linux/arm/v7']})
    await containerd.pullImage({image: 'registry.example.com/team/app:1.0', auth: {username: 'u', password: 'p'}})

    //Tags and pushes
    const tagged: ContainerdImage = await image.tag('registry.example.com/team/alpine:3.20')
    await tagged.push()

    //Archives: OCI image layouts with the manifest.json of docker load; the archives of docker save are imported too
    await image.export({destination: '/tmp/alpine.tar'})
    await containerd.exportImages(['alpine:3.20', 'busybox'], {destination: '/tmp/images.tar'})
    const imported: ContainerdImage[] = await containerd.importImage({source: '/tmp/images.tar'})
    console.log(imported.length, (await containerd.listImages()).length)

    await tagged.remove()
    //The stopped containers and the dangling images (allImages: every image no container uses)
    const pruned: ContainerdPruneResult = await containerd.prune({containers: true, images: true, allImages: false})
    console.log(pruned.images)
}
```

The names of the images are normalized as Docker does (`alpine` is `docker.io/library/alpine:latest`). containerd keeps
the content of an image while an image or a container uses it.

## 4. Containers

```typescript
import {type Containerd, type ContainerdContainer, type ContainerdContainerTTY, type ContainerdExecResult} from 'lakutata/com/containerd'

async function containers(containerd: Containerd): Promise<void> {
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
        //The network of the host; 'none': its loopback only; by default the CNI network bridge
        network: 'host',
        memoryLimit: 128 * 1024 * 1024,
        cpus: 0.5,
        //Kept by the restart monitor of containerd, even when the application is not running
        restartPolicy: 'always'
    })
    await container.start()
    console.log(container.state.status, container.state.pid)

    //A string runs through /bin/sh -c; resolves with the exit code and the outputs, whatever the exit code
    const result: ContainerdExecResult = await container.exec({cmd: 'cat /etc/os-release', user: 'root', timeout: 5000})
    console.log(result.exitCode, result.stdout, result.stderr)
    await container.exec({cmd: ['sh', '-c', 'cat > /data/input'], stdin: 'content'})

    //The last 100 lines; follow (the default) keeps the stream open while the container runs
    for await (const chunk of await container.logs({tail: 100, follow: false})) process.stdout.write(chunk)

    //{cpu: {percent…}, memory: {usage, limit…}, blkio, networks, pids}
    console.log(await container.stats())

    //Resources and restart policy: live; any other setting: the container created again, its name kept
    await container.update({memoryLimit: 256 * 1024 * 1024, restartPolicy: 'unless-stopped'})
    await container.update({env: {MODE: 'debug'}})

    //A shell with a pseudo terminal
    const tty: ContainerdContainerTTY = await container.createTTY({consoleSize: {cols: 120, rows: 40}})
    tty.onData((chunk: Buffer): void => {
        process.stdout.write(chunk)
    })
    tty.write('ls\n')
    await tty.resize({cols: 100, rows: 30})
    await tty.close()

    //Its changes as an image; a directory copied out as a tar archive
    await container.commit({repoTag: 'worker:patched', changes: {cmd: ['date']}})
    await container.exportDirectory({path: '/var/log', destination: '/tmp/logs.tar'})

    await container.pause()
    await container.unpause()
    //Its stop signal, then SIGKILL after 10 seconds
    await container.stop({timeout: 10})
    await container.restart()
    //Its snapshot and its state removed
    await container.remove({force: true})

    //By its name, its identifier or a prefix of it; by labels
    console.log(await containerd.listContainers({app: 'worker'}))
}
```

- `devices` creates devices of the host in the container (a device, or every device of a directory such as
  `/dev/snd`). For the devices plugged later, bind their directory and allow their numbers with `deviceCgroupRules`, as
  the `--device-cgroup-rule` of Docker does: `binds: [{hostPath: '/dev', containerPath: '/dev'}], deviceCgroupRules:
  ['c 188:* rwm']`.
- The containers have a cgroup namespace of their own on cgroup v2 (`cgroupns: 'host'` shares the one of the host).
- Their system calls are filtered by seccomp as nerdctl filters them: the default profile of containerd, with the
  system calls their `capabilities` allow (`capabilities: ['SYS_ADMIN']` allows `mount`, `unshare`…).
  `seccompProfile: 'unconfined'` disables it, the path of a file gives an OCI profile; the privileged containers are
  unconfined.
- `privileged`, `capabilities` / `capabilitiesDrop`, `readonlyRootfs`, `pidMode: 'host'`, `ipcMode: 'host'`, `sysctls`,
  `extraHosts`, `dns`, `shmSize`, `pidsLimit`, `cpuSet`, `cpuShares`, `memorySwap`, `OOMKillDisable` are the options of
  Docker of the same names.
- `update()` with other settings than the resources and the restart policy only works for the containers the component
  created (it keeps their settings in `dataRoot`).

### Volumes

Named volumes are directories under `dataRoot`, created when a container mounts them or by `createVolume()`:

```typescript
import {type Containerd} from 'lakutata/com/containerd'

async function volumes(containerd: Containerd): Promise<void> {
    await containerd.createVolume({name: 'data', labels: {app: 'web'}})
    await containerd.createContainer({image: 'alpine:3.20', volumes: [{volumeName: 'data', containerPath: '/var/lib/app'}]})
    console.log(await containerd.listVolumes())
    //Refused while a container mounts it, even a stopped one
    await containerd.removeVolume('data').catch((error: Error): void => console.log(error.message))
    //The stopped containers, the dangling images, the unused networks and volumes
    await containerd.prune({networks: true, volumes: true})
}
```

## 5. Networks

A container joins the CNI network `bridge` by default (the default network of nerdctl, `nerdctl0`, `10.4.0.0/24`,
created when a container first asks for it), where its ports are published. `network: 'host'` gives it the network of
the host, `network: 'none'` its loopback only, and `networks` lists the CNI networks it joins: `bridge` and the networks
created (bridges, macvlans or ipvlans, with IPv4 and IPv6 subnets). Their configurations are the ones of nerdctl
(`/etc/cni/net.d/nerdctl-<name>.conflist`), so nerdctl and the component share them. The CNI plugins and iptables must
be installed (see the requirements).

```typescript
import {type Containerd, type ContainerdContainer, type ContainerdNetworkInfo} from 'lakutata/com/containerd'

async function networks(containerd: Containerd): Promise<void> {
    //Without subnet: a free subnet of 10.4.0.0/16
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
    //[{networkName: 'bridge', interface: 'eth0', ip: '10.4.0.2', gateway: '10.4.0.1', mac…}, …]
    console.log(web.networks, web.ports)

    await web.remove({force: true})
    //Refused while a container uses it
    await containerd.removeNetwork('backend')
    console.log(await containerd.listNetworks())
}
```

The networks of a container are set up by its runc hooks, as nerdctl does: they are added when its task is created and
deleted when it stops, also when containerd restarts it by its restart policy (after a reboot, without the
application). Its address is given at each start and written in its `/etc/hosts`.

## 6. Builds

The images are built by [BuildKit](https://github.com/moby/buildkit): a `buildkitd` of the machine (its socket,
`buildkitAddress: 'unix:///run/buildkit/buildkitd.sock'` by default, with its containerd or runc worker), or a remote
one (`buildkitAddress: 'tcp://builder:1234'`, with `buildkitTLS: {ca, cert, key}`). The component sends the context of
the build (without the files its `.dockerignore` excludes) and the Dockerfile over the session of BuildKit, as
`docker buildx` does, and imports the image built into containerd:

```typescript
import {type Containerd, type ContainerdImage} from 'lakutata/com/containerd'

async function build(containerd: Containerd): Promise<void> {
    console.log(await containerd.buildkitVersion(), await containerd.buildkitPlatforms())
    const image: ContainerdImage = await containerd.buildImage({
        //The context
        workdir: '/srv/app',
        //Dockerfile by default
        dockerfile: 'docker/App.Dockerfile',
        repoTag: 'registry.example.com/team/app:1.0',
        buildargs: {NODE_ENV: 'production'},
        //The platform of the machine by default
        platform: ['linux/arm64', 'linux/amd64'],
        //Pushed to its registry once built
        push: true,
        //#3 [2/3] RUN npm ci …
        outputCallback: (line: string): void => console.log(line)
    })
    console.log(image.platforms)
}
```

BuildKit pulls the base images with the registry credentials of the component (or `auth`).

## 7. Platforms and events

`containerd.supportedPlatforms()` gives the platforms the machine runs: its own, and the ones of the emulators
registered in `binfmt_misc` (QEMU, Rosetta). A container of another platform runs once its emulator is registered:
`createContainer({image: 'alpine:3.20', platform: 'linux/amd64', cmd: ['uname', '-m']})` after pulling that platform.

`containerd.events(signal)` streams the events of containerd in the namespace:

```typescript
import {type Containerd, type ContainerdEvent} from 'lakutata/com/containerd'

async function watch(containerd: Containerd): Promise<void> {
    const abort: AbortController = new AbortController()
    setTimeout((): void => abort.abort(), 60000)
    for await (const event of containerd.events(abort.signal)) {
        //{topic: '/tasks/exit', type: 'containerd.events.TaskExit', event: {containerId, exitStatus…}, namespace, timestamp}
        const received: ContainerdEvent = event
        console.log(received.topic, received.event)
    }
}
```

## 8. Exceptions

`ContainerdConnectionException`, `ContainerdImageNotFoundException`, `ContainerdImagePullException`,
`ContainerdImagePushException`, `ContainerdImageImportException`, `ContainerdImageExportException`,
`ContainerdImageBuildException` (BuildKit is not reachable, or the build failed), `ContainerdPlatformException` (the
image has no manifest for the platform), `ContainerdContainerNotFoundException`,
`ContainerdContainerNameConflictException`, `ContainerdContainerStateException` (running, not running, paused),
`ContainerdPathNotFoundException`, `ContainerdNetworkNotFoundException`, `ContainerdNetworkConflictException` (the
network exists, its subnet overlaps another one, or a container uses it), `ContainerdVolumeNotFoundException`,
`ContainerdVolumeInUseException`. All are exported by `lakutata/com/containerd`.

## 9. Limits of this version

- The projects of Compose are not supported.
- The logs of the containers have no timestamps.
