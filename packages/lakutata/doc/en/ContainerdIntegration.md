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
    network: 'host',          //or none: its loopback only
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
- The containers have a cgroup namespace of their own on cgroup v2 (`cgroupns: 'host'` shares the one of the host).
- `privileged`, `capabilities` / `capabilitiesDrop`, `readonlyRootfs`, `pidMode: 'host'`, `ipcMode: 'host'`, `sysctls`,
  `extraHosts`, `dns`, `shmSize`, `pidsLimit`, `cpuSet`, `OOMKillDisable` are the options of Docker of the same names.

## 4. Platforms of other architectures

`containerd.supportedPlatforms()` gives the platforms the machine runs: its own one, and the ones of the emulators
registered in `binfmt_misc` (QEMU, Rosetta), detected by the ELF machine of their entries whatever their names. A
container of another platform runs once its emulator is registered:

```typescript
await containerd.pullImage({image: 'alpine:3.20', platform: 'linux/amd64'})
const container = await containerd.createContainer({image: 'alpine:3.20', platform: 'linux/amd64', cmd: ['uname', '-m']})
```

## 5. Events

```typescript
const abort = new AbortController()
for await (const event of containerd.events(abort.signal)) {
    //{topic: '/tasks/exit', type: 'containerd.events.TaskExit', event: {containerId, exitStatus…}, namespace, timestamp}
}
```

## 6. Exceptions

`ContainerdConnectionException`, `ContainerdImageNotFoundException`, `ContainerdImagePullException`,
`ContainerdImagePushException`, `ContainerdImageImportException`, `ContainerdImageExportException`,
`ContainerdPlatformException` (the image has no manifest of the platform), `ContainerdContainerNotFoundException`,
`ContainerdContainerNameConflictException`, `ContainerdContainerStateException` (running, not running, paused).

## 7. Limits of this version

- The networks are the one of the host and none; the networks of CNI (bridges) and the ports published come next.
- The images are not built yet (BuildKit, local or remote, comes next), nor the projects of Compose.
- The containers run without seccomp profile, and their logs have no timestamps.
