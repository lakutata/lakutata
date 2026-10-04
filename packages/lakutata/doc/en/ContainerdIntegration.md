# Lakutata containerd Integration

The **containerd component** (`lakutata/com/containerd`, package `@lakutata/containerd`) manages the images and the
containers of [containerd](https://containerd.io) over its API, without Docker and without nerdctl. It targets the
machines that run containerd alone, such as embedded Linux devices: the component talks to the socket of containerd
(gRPC over HTTP/2, written in TypeScript, no native addon), and does by itself what nerdctl does on top of it (pulling
from the registries, unpacking the layers, generating the OCI specifications of the containers, their logs).

The containers it creates are the ones of nerdctl: they carry its labels (`nerdctl/name`, `nerdctl/hostname`…), so
`nerdctl ps` and `ctr containers ls` list them.

## 1. Configuration

```typescript
import {Application} from 'lakutata'
import {Containerd} from 'lakutata/com/containerd'

Application.run({
    id: 'device.app',
    name: 'device',
    components: {
        containerd: {
            class: Containerd,
            socketPath: '/run/containerd/containerd.sock', //default
            namespace: 'default',                          //the one of nerdctl
            snapshotter: 'overlayfs',                      //or native
            cgroupManager: 'cgroupfs',                     //systemd when containerd runs runc with SystemdCgroup
            dataRoot: '/var/lib/lakutata/containerd',      //the logs, hosts, resolv.conf of the containers
            logMaxSize: 10 * 1024 * 1024,                  //rotate the logs of a container at its starts (0: never)
            registryAuths: {'registry.example.com': {username: 'deploy', password: 'secret'}},
            insecureRegistries: ['localhost:5000']         //the registries served over HTTP
        }
    },
    bootstrap: ['containerd']
})
```

The application needs the access to the socket of containerd (root, usually). The component fails at its start with a
`ContainerdConnectionException` when containerd is not there, and creates its namespace when it does not exist.

## 2. Images

```typescript
const containerd: Containerd = await app.getObject('containerd')

//Pulled for the platform of the machine, unpacked into the snapshots
const image = await containerd.pullImage({image: 'alpine:3.20', progressCallback: progress => console.log(progress)})
image.name      //docker.io/library/alpine:3.20
image.platforms //['linux/arm64/v8']
image.config    //{env, cmd, entrypoint, workingDir, user, exposedPorts, volumes, labels, stopSignal}

//Other platforms (or all of them), the credentials of a registry
await containerd.pullImage({image: 'alpine:3.20', platform: ['linux/amd64', 'linux/arm/v7']})
await containerd.pullImage({image: 'registry.example.com/team/app:1.0', auth: {username: 'u', password: 'p'}})

await image.tag('registry.example.com/team/alpine:3.20')
await (await containerd.getImage('registry.example.com/team/alpine:3.20')).push()

//Archives: OCI image layouts (loaded by docker load and nerdctl load), the archives of docker save
await image.export({destination: '/tmp/alpine.tar'})
await containerd.exportImages(['alpine:3.20', 'busybox'], {destination: '/tmp/images.tar'})
await containerd.importImage({source: '/tmp/alpine.tar'})

await containerd.listImages()
await image.remove()
```

The names of the images are normalized as Docker does (`alpine` is `docker.io/library/alpine:latest`). The content of
an image is kept by containerd as long as an image or a container uses it (the labels of its garbage collection).

## 3. Containers

```typescript
const container = await containerd.createContainer({
    image: 'alpine:3.20',
    name: 'worker',
    cmd: ['sh', '-c', 'while true; do date; sleep 1; done'],
    env: {MODE: 'production'},
    user: 'nobody',
    binds: [{hostPath: '/data/worker', containerPath: '/data'}],
    tmpfs: [{containerPath: '/tmp', size: 16 * 1024 * 1024}],
    devices: [{hostPath: '/dev/ttyUSB0'}],
    network: 'host',          //or none: its loopback only; networks of CNI: see below
    memoryLimit: 128 * 1024 * 1024,
    cpus: 0.5,
    restartPolicy: 'always'   //kept by the restart monitor of containerd, even when the application is not running
})
await container.start()
container.state  //{status: 'running', pid, exitCode, startedAt, finishedAt…}

const result = await container.exec({cmd: 'cat /etc/os-release', user: 'root'})
result.exitCode; result.stdout; result.stderr
await container.exec({cmd: ['sh', '-c', 'cat > /data/input'], stdin: 'content'})

for await (const chunk of await container.logs({tail: 100, follow: false})) process.stdout.write(chunk)

await container.stop({timeout: 10})   //its stop signal, SIGKILL after the timeout
await container.restart()
await container.pause(); await container.unpause()
await container.remove({force: true}) //its snapshot and its state removed

await containerd.getContainer('worker')        //by its name, its identifier or a prefix of it
await containerd.listContainers({app: 'web'})  //by labels
```

- The output of a container is written by the shim of containerd into its log file, so it keeps being logged when the
  application stops or restarts. `exec` captures the standard output and error apart (FIFOs created by the `mkfifo`
  of the system; without it, both are in `stdout`).
- `devices` gives devices of the host (a serial port, the devices of a directory: `/dev/snd`), created in the container
  when it is created. The devices plugged later (a USB serial port, `ttyUSB1` once plugged again) are given by a bind of
  their directory and the rule of their numbers, as Docker's `--device-cgroup-rule`:
  `binds: [{hostPath: '/dev', containerPath: '/dev'}], deviceCgroupRules: ['c 188:* rwm']` (188: the USB serial ports).
- The containers have a cgroup namespace of their own on cgroup v2 (`cgroupns: 'host'` shares the one of the host).
- Their system calls are filtered by seccomp as nerdctl filters them: the default profile of containerd, its system
  calls allowed by the capabilities of the container (`capabilities: ['SYS_ADMIN']` allows `mount`, `unshare`…).
  `seccompProfile: 'unconfined'` disables it, the path of a file gives a profile of OCI (the `linux.seccomp` of its
  specification); the privileged containers are unconfined, and the kernels without seccomp too.
- `privileged`, `capabilities` / `capabilitiesDrop`, `readonlyRootfs`, `pidMode: 'host'`, `ipcMode: 'host'`, `sysctls`,
  `extraHosts`, `dns`, `shmSize`, `pidsLimit`, `cpuSet`, `OOMKillDisable` are the options of Docker of the same names.

## 4. Networks

Besides the network of the host (the default) and `none`, the containers join the networks of CNI: `bridge` (the
default one of nerdctl, `nerdctl0`, `10.4.0.0/24`, created once a container asks it) and the networks created. Their
configurations are the ones of nerdctl (`/etc/cni/net.d/nerdctl-<name>.conflist`), so nerdctl and the component share
them. The plugins of CNI must be installed (`/opt/cni/bin`, `/usr/lib/cni` or `/usr/libexec/cni`, the `cniPath` option),
with iptables.

```typescript
const network = await containerd.createNetwork({name: 'backend', subnet: '10.4.10.0/24'}) //or a free subnet of 10.4.0.0/16
await containerd.createNetwork({name: 'lan', driver: 'macvlan', parent: 'eth0', subnet: '192.168.1.0/24', gateway: '192.168.1.1', ipRange: '192.168.1.192/27'})

const web = await containerd.createContainer({
    image: 'nginx:alpine',
    networks: [{networkName: 'bridge'}, {networkName: 'backend', ip: '10.4.10.5'}], //eth0, eth1
    ports: [{port: 80, hostPorts: [8080]}]                                          //on its first network
})
await web.start()
web.networks //[{networkName: 'bridge', interface: 'eth0', ip: '10.4.0.2', gateway: '10.4.0.1', mac…}, …]
web.ports    //[{host: '0.0.0.0', port: 80, type: 'tcp', hostPorts: [8080]}]

await containerd.listNetworks()
await containerd.removeNetwork('backend') //refused while a container uses it
```

The networks of a container are set up by its hooks (run by runc), as nerdctl does: they are added when its task is
created and deleted when it stops, also when containerd restarts it by its restart policy, after a reboot, without the
application. Its address is given at each start, and written in its `/etc/hosts`.

## 5. Builds

The images are built by [BuildKit](https://github.com/moby/buildkit): a `buildkitd` of the machine (its socket,
`buildkitAddress: 'unix:///run/buildkit/buildkitd.sock'` by default, with its containerd or runc worker), or a remote
one (`tcp://builder:1234`, with `buildkitTLS: {ca, cert, key}`). The component sends the context of the build (without
the files its `.dockerignore` excludes) and the Dockerfile over the session of BuildKit, as `docker buildx` does, and
imports the image built into containerd:

```typescript
const image = await containerd.buildImage({
    workdir: '/srv/app',                  //the context
    dockerfile: 'docker/App.Dockerfile',  //Dockerfile by default
    repoTag: 'registry.example.com/team/app:1.0',
    buildargs: {NODE_ENV: 'production'},
    platform: ['linux/arm64', 'linux/amd64'], //the one of the machine by default
    push: true,                               //pushed to its registry once built
    outputCallback: line => console.log(line) //#3 [2/3] RUN npm ci …
})
await containerd.buildkitVersion()
await containerd.buildkitPlatforms() //the platforms its workers build
```

A remote BuildKit builds for the machine (its platform by default), and the platforms it emulates with the emulators of
its own machine. The credentials of the registries of the base images are the ones of the component (or of `auth`).

## 6. Platforms of other architectures

`containerd.supportedPlatforms()` gives the platforms the machine runs: its own one, and the ones of the emulators
registered in `binfmt_misc` (QEMU, Rosetta), detected by the ELF machine of their entries whatever their names. A
container of another platform runs once its emulator is registered:

```typescript
await containerd.pullImage({image: 'alpine:3.20', platform: 'linux/amd64'})
const container = await containerd.createContainer({image: 'alpine:3.20', platform: 'linux/amd64', cmd: ['uname', '-m']})
```

## 7. Events

```typescript
const abort = new AbortController()
for await (const event of containerd.events(abort.signal)) {
    //{topic: '/tasks/exit', type: 'containerd.events.TaskExit', event: {containerId, exitStatus…}, namespace, timestamp}
}
```

## 8. Exceptions

`ContainerdConnectionException`, `ContainerdImageNotFoundException`, `ContainerdImagePullException`,
`ContainerdImagePushException`, `ContainerdImageImportException`, `ContainerdImageExportException`,
`ContainerdImageBuildException` (BuildKit is not reachable, or the build failed), `ContainerdPlatformException` (the
image has no manifest of the platform), `ContainerdContainerNotFoundException`,
`ContainerdContainerNameConflictException`, `ContainerdContainerStateException` (running, not running, paused),
`ContainerdNetworkNotFoundException`, `ContainerdNetworkConflictException` (the network exists, its subnet overlaps
another one, or a container uses it).

## 9. Limits of this version

- The projects of Compose are not supported yet.
- The logs of the containers have no timestamps.
