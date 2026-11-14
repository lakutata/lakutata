# @lakutata/containerd

[English](README.md) | 中文

Lakutata 框架的 containerd 组件。该组件直接与 containerd 的 gRPC 套接字通信，管理一个 [containerd](https://containerd.io) 命名空间中的镜像、容器、CNI 网络和命名卷，无需 Docker 守护进程，也无需 nerdctl（其 gRPC 客户端以 TypeScript 编写，不含原生插件）。该组件面向只运行 containerd 的 Linux 机器，例如嵌入式设备，其 API 沿用 Docker 组件的 API。镜像可以拉取（支持镜像仓库凭据）、推送、标记、导入、导出和清理。创建容器时可以设置端口、卷、设备、seccomp 和资源限制；之后可以启动和停止容器、在容器中执行命令、以流的形式读取日志、获取统计数据、更新容器、将容器提交为镜像，以及从容器中导出目录。构建交由 BuildKit 完成。此组件创建的容器与 nerdctl 创建的容器相同，因此 `nerdctl ps` 能够列出这些容器。`lakutata` 包将本包重新导出为 `lakutata/com/containerd`。

## 安装

```shell
npm install lakutata
```

组件没有可选的 npm 依赖。机器需要满足以下要求：

| 功能 | 要求 |
|---|---|
| 全部功能 | Linux，带 runc 的 containerd 1.6 或更高版本，Node.js `>=18.10.0`；应用以 root 身份运行，或属于拥有 containerd 套接字的用户组 |
| CNI 网络、端口发布 | CNI 插件（`bridge`、`portmap`、`host-local` 等，位于 `/opt/cni/bin`、`/usr/lib/cni` 或 `/usr/libexec/cni`）以及 iptables |
| 带 `stdin` 的 `exec()`、各自独立的 `stdout`/`stderr`、终端 | 主机上的 `mkfifo`（若不存在，`exec()` 会将两种输出都放入 `stdout`） |
| 构建 | BuildKit 守护进程（`buildkitd`）：可以位于本机，通过其 unix 套接字连接；也可以位于远程，通过 TCP/TLS 连接 |
| 其他架构的容器 | 在 `binfmt_misc` 中注册的 QEMU（或 Rosetta）模拟器 |

## 用法

### 在应用中使用组件

在应用的 `components` 中注册 `Containerd`，再通过 `getObject()` 或 `@Inject` 获取该组件。组件在创建时连接 containerd。如果 `socketPath` 上没有 containerd，组件创建失败并抛出 `ContainerdConnectionException`；如果组件像本例一样列在 `bootstrap` 中，应用会因此启动失败。命名空间不存在时，组件会创建该命名空间。

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
                //以下为默认值
                socketPath: '/run/containerd/containerd.sock',
                namespace: 'default',
                snapshotter: 'overlayfs',
                //containerd 以 SystemdCgroup = true 运行 runc 时设为 systemd
                cgroupManager: 'cgroupfs',
                //容器的日志、hosts、resolv.conf、设置，以及命名卷
                dataRoot: '/var/lib/lakutata/containerd',
                //组件启动容器时，超过 10 MiB 的日志文件会被轮转（默认为 0：从不轮转）
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

### 与 Docker 组件的不同

- 中间没有守护进程：组件与 nerdctl 一样，自行拉取、解包、推送、导入和导出镜像，并生成容器的 OCI 规范。容器带有 nerdctl 的标签（`nerdctl/name` 等），CNI 网络配置也与 nerdctl 的相同（`nerdctl-<name>.conflist`），因此 nerdctl 和组件可以共用这些容器和网络配置。
- 容器的输出由 containerd 的 shim 写入日志文件，重启策略由 containerd 的重启监视器执行，因此在应用停止期间，两者仍然正常工作。日志没有时间戳。
- `createContainer()` 在选项中接收镜像，并且从不自动拉取，因此请先拉取镜像。与 Docker 一样，除非 `network` 或 `networks` 另有指定，容器会加入默认网络 `bridge`（这是一个在首次使用时创建的 CNI 网络，因此需要 CNI 插件，见“安装”一节），端口也发布在该网络上；`network: 'host'` 使容器使用主机网络。
- 不提供 `loginRepository()`，凭据来自 `registryAuths` 选项，或者每次调用的 `auth`。
- `importImage()` 返回归档中的所有镜像，`prune()` 返回其删除的内容。
- 组件只在一个命名空间中工作，无法看到其他命名空间的镜像、容器和卷。

### 镜像

```typescript
import {type Containerd, type ContainerdImage, type ContainerdPruneResult} from 'lakutata/com/containerd'

declare const containerd: Containerd

//按本机平台拉取，并解包到快照器中（只解包本机能运行的平台）
const image: ContainerdImage = await containerd.pullImage({
    image: 'alpine:3.20',
    progressCallback: (progress): void => console.log(progress)
})
//docker.io/library/alpine:3.20、['linux/arm64/v8']、{env, cmd, entrypoint, workingDir, user, exposedPorts…}
console.log(image.name, image.platforms, image.config)

//其他平台（或 'all'），以及单次拉取的凭据
await containerd.pullImage({image: 'alpine:3.20', platform: ['linux/amd64', 'linux/arm/v7']})
await containerd.pullImage({image: 'registry.example.com/team/app:1.0', auth: {username: 'u', password: 'p'}})

//打标签和推送：推送已有的所有平台（连同索引），或者只推送指定的平台
const tagged: ContainerdImage = await image.tag('registry.example.com/team/alpine:3.20')
await tagged.push()
await tagged.push({reference: 'registry.example.com/team/alpine:3.20-arm64', platform: 'linux/arm64'})

//归档：带有 docker load 所需 manifest.json 的 OCI 镜像布局；也可以导入 docker save 的归档
await image.export({destination: '/tmp/alpine.tar'})
await containerd.exportImages(['alpine:3.20', 'busybox'], {destination: '/tmp/images.tar'})
const imported: ContainerdImage[] = await containerd.importImage({source: '/tmp/images.tar'})
console.log(imported.length, (await containerd.listImages()).length)
//指定新名称：只适用于只含一个镜像的归档
await containerd.importImage({source: '/tmp/alpine.tar', name: 'alpine:backup'})

await tagged.remove()
//已停止的容器和悬空镜像（allImages：所有没有容器使用的镜像）
const pruned: ContainerdPruneResult = await containerd.prune({containers: true, images: true, allImages: false})
console.log(pruned.images)
```

镜像名称按 Docker 的规则规范化（`alpine` 即 `docker.io/library/alpine:latest`）。只要镜像的内容仍被某个镜像或容器使用，containerd 就会保留这些内容。多平台镜像的描述信息取自其中第一个本机能够运行的平台。

### 容器

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
    //一个设备，以及之后插入的 USB 串口（主设备号 188）
    devices: [{hostPath: '/dev/ttyUSB0'}],
    deviceCgroupRules: ['c 188:* rwm'],
    //另加同样大小的交换空间（memorySwap 默认为内存的两倍，-1 表示不限制）
    memoryLimit: 128 * 1024 * 1024,
    cpus: 0.5,
    restartPolicy: 'always'
})
await container.start()
console.log(container.state.status, container.state.pid)

//命令为字符串时通过 /bin/sh -c 执行；输出收集在内存中
const result: ContainerdExecResult = await container.exec({cmd: 'cat /etc/os-release', user: 'root', timeout: 5000})
console.log(result.exitCode, result.stdout, result.stderr)
await container.exec({cmd: ['sh', '-c', 'cat > /data/input'], stdin: 'content'})

//最后 100 行；follow（默认）会在容器运行期间保持流打开
for await (const chunk of await container.logs({tail: 100, follow: false})) process.stdout.write(chunk)

const stats: ContainerdContainerStats = await container.stats()
console.log(stats.cpu.percent, stats.memory.usage, stats.pids.current)

//资源和重启策略在线修改（0 表示取消限制）；修改其他设置会重新创建容器，名称不变
await container.update({memoryLimit: 256 * 1024 * 1024, restartPolicy: 'unless-stopped'})
await container.update({cpus: 0})
await container.update({env: {MODE: 'debug'}})

//把容器中的修改提交为镜像；把一个目录导出为 tar 归档
const patched: ContainerdImage = await container.commit({repoTag: 'worker:patched', changes: {cmd: ['date']}})
await container.exportDirectory({path: '/var/log', destination: '/tmp/logs.tar'})
console.log(patched.name, await container.processes())

await container.pause()
await container.unpause()
//先发送容器的停止信号，10 秒后再发送 SIGKILL
await container.stop({timeout: 10})
//容器没有运行时：立即返回它上一次的退出码
console.log(await container.wait())
await container.remove()

console.log(await containerd.listContainers({app: 'worker'}))
```

- 容器使用 containerd 的默认 seccomp 配置，并放行容器的 `capabilities` 所允许的系统调用（与 nerdctl 相同）；`seccompProfile: 'unconfined'` 关闭过滤，指定文件路径时则使用该文件中的 OCI 配置。特权容器不受限制。
- `devices` 在容器中创建主机的设备（单个设备，或某个目录下的所有设备，例如 `/dev/snd`）。对于之后才插入的设备，请绑定挂载其所在的目录，并通过 `deviceCgroupRules` 允许这些设备的设备号，作用与 Docker 的 `--device-cgroup-rule` 相同。`privileged` 容器能够使用主机 `/dev` 中的所有设备（与 nerdctl 相同）。
- 在 cgroup v2 上，容器拥有独立的 cgroup 命名空间（设置 `cgroupns: 'host'` 时则共享主机的 cgroup 命名空间）。
- `privileged`、`capabilities`、`capabilitiesDrop`、`readonlyRootfs`、`pidMode: 'host'`、`ipcMode: 'host'`、`sysctls`、`extraHosts`、`dns`、`shmSize`、`pidsLimit`、`cpuSet`、`cpuShares`、`memorySwap` 和 `OOMKillDisable` 与 Docker 的同名选项作用相同。与 Docker 一样，`memorySwap` 为内存和交换空间的总和，需要同时设置 `memoryLimit`，默认为 `memoryLimit` 的两倍。
- `update()` 修改资源和重启策略以外的设置时，仅对组件创建的容器有效（组件将这些容器的设置保存在 `dataRoot` 中）。设为 `0` 的资源（或 `cpuSet: []`）会立即取消限制，对正在运行的容器同样生效。
- 对未运行的容器调用 `wait()` 会立即返回，结果为该容器上一次运行的退出码（从未启动过时为 `0`），与 `docker wait` 相同。

终端会在运行中的容器内启动一个带伪终端的进程，默认为 `/bin/sh`。与 `exec()` 一样，字符串形式的命令通过 `/bin/sh -c` 执行，数组则按原样执行。

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
//也可以使用双工流 tty.raw，把套接字通过管道接到它上面
await tty.close()
```

### 网络

除 `host` 和 `none` 外，容器加入的都是 CNI 网络：一个是 nerdctl 的默认网络 `bridge`（`nerdctl0`，`10.4.0.0/24`，在首次使用时创建；创建容器时如果未指定 `network` 或 `networks`，容器即加入该网络），其余是自行创建的网络（bridge、macvlan 或 ipvlan，支持 IPv4 和 IPv6 子网）。每个容器的网络由其 runc 钩子配置，因此即使应用没有运行、由 containerd 重启容器，网络也能正常工作。

```typescript
import {type Containerd, type ContainerdContainer, type ContainerdNetworkInfo} from 'lakutata/com/containerd'

declare const containerd: Containerd

//不指定子网时：从 10.4.0.0/16 中选一个空闲子网
const backend: ContainerdNetworkInfo = await containerd.createNetwork({name: 'backend', subnet: '10.4.10.0/24'})
await containerd.createNetwork({name: 'dual', subnet: '10.4.11.0/24', ipv6Subnet: 'fd00:4:11::/64'})
await containerd.createNetwork({name: 'lan', driver: 'macvlan', parent: 'eth0', subnet: '192.168.1.0/24', gateway: '192.168.1.1'})

const web: ContainerdContainer = await containerd.createContainer({
    image: 'nginx:alpine',
    //eth0 和 eth1
    networks: [{networkName: 'bridge'}, {networkName: backend.name, ip: '10.4.10.5'}],
    //通过第一个网络发布
    ports: [{port: 80, hostPorts: [8080]}]
})
await web.start()
console.log(web.networks, web.ports)

await web.remove({force: true})
//有容器使用时拒绝删除
await containerd.removeNetwork('backend')
console.log(await containerd.listNetworks())
```

### 卷

命名卷是 `dataRoot` 下的目录，在容器挂载时创建，也可以通过 `createVolume()` 创建。

```typescript
import {type Containerd, type ContainerdVolumeInfo} from 'lakutata/com/containerd'

declare const containerd: Containerd

const volume: ContainerdVolumeInfo = await containerd.createVolume({name: 'data', labels: {app: 'web'}})
console.log(volume.mountpoint)
await containerd.createContainer({image: 'alpine:3.20', volumes: [{volumeName: 'data', containerPath: '/var/lib/app'}]})
console.log(await containerd.listVolumes())
//同时清理未使用的网络和卷
await containerd.prune({networks: true, volumes: true})
```

`removeVolume()` 拒绝删除有容器挂载的卷，即使容器已停止。

### 用 BuildKit 构建

与 `docker buildx` 相同，`buildImage()` 通过 BuildKit 会话将构建上下文（不含 `.dockerignore` 排除的文件）和 Dockerfile 发送给 BuildKit，再将构建好的镜像导入 containerd。BuildKit 可以是本机的 `buildkitd`（通过其 unix 套接字连接，使用 containerd 或 runc worker），也可以是远程的 BuildKit，通过 TCP 连接并使用 TLS：

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
            //默认为本机平台
            platform: ['linux/arm64', 'linux/amd64'],
            push: true,
            outputCallback: (line: string): void => console.log(line)
        })
        console.log(image.platforms)
    })
```

BuildKit 使用组件的镜像仓库凭据（或 `auth`）拉取基础镜像。

### 命名空间、平台与事件

每个组件只在一个命名空间中工作；如需管理多个命名空间，请为每个命名空间注册一个组件（`k8s.io` 是 Kubernetes 的命名空间）。`supportedPlatforms()` 列出本机可以运行的平台，即本机平台，以及在 `binfmt_misc` 中注册的模拟器所对应的平台，因此注册模拟器后，即可运行其他架构的容器。`events()` 以流的形式返回该命名空间中 containerd 的事件。

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

| 导出 | 说明 |
|---|---|
| `Containerd` | 组件：`version`、`supportedPlatforms`、`detectPlatforms`、`events`；镜像（`listImages`、`getImage`、`pullImage`、`buildImage`、`buildkitVersion`、`buildkitPlatforms`、`importImage`、`exportImages`）；网络（`listNetworks`、`getNetwork`、`createNetwork`、`removeNetwork`）；容器（`listContainers`、`getContainer`、`createContainer`）；卷（`listVolumes`、`getVolume`、`createVolume`、`removeVolume`）；`prune`。选项：`socketPath`、`namespace`、`snapshotter`、`runtime`、`cgroupManager`、`dataRoot`、`logMaxSize`、`cniConfigPath`、`cniPath`、`buildkitAddress`、`buildkitTLS`、`registryAuths`、`insecureRegistries` |
| `ContainerdImage` | 镜像：`name`、`digest`、`platforms`、`platform`、`size`、`config`……；`tag`、`push`、`export`、`remove`、`syncImageInfo` |
| `ContainerdContainer` | 容器：`id`、`name`、`state`、`networks`、`ports`、`volumes`……；`start`、`stop`、`restart`、`kill`、`pause`、`unpause`、`wait`、`remove`、`exec`、`logs`、`stats`、`createTTY`、`update`、`commit`、`exportDirectory`、`processes`、`image`、`syncContainerInfo` |
| `ContainerdContainerTTY` | 容器中的终端：`raw`、`readable`、`writable`、`onData`、`write`、`resize`、`wait`、`close` |
| `ImagePullOptions`、`ImagePushOptions`、`ImageBuildOptions`、`ImageImportOptions`、`ImageExportOptions` | 镜像操作的选项 |
| `ContainerCreateOptions`、`ContainerStopOptions`、`ContainerKillOptions`、`ContainerRemoveOptions`、`ContainerExecOptions`、`ContainerLogsOptions`、`ContainerTTYOptions`、`ContainerTTYConsoleSizeOptions`、`ContainerResourceOptions`、`ContainerCommitOptions`、`ContainerExportDirectoryOptions` | 容器操作的选项 |
| `NetworkCreateOptions`、`VolumeCreateOptions`、`ContainerdPruneOptions`、`ContainerdRegistryAuthOptions` | 网络、卷、`prune` 和镜像仓库凭据的选项 |
| `ContainerdBind`、`ContainerdVolume`、`ContainerdTmpfs`、`ContainerdDevice`、`ContainerdContainerPort`、`ContainerdRestartPolicy` | 容器选项中的各个部分 |
| `ContainerdContainerState`、`ContainerdContainerNetwork`、`ContainerdContainerStats`、`ContainerdExecResult`、`ContainerdImageConfig`、`ContainerdNetworkInfo`、`ContainerdVolumeInfo`、`ContainerdPruneResult`、`ContainerdEvent` | 返回的信息 |
| `ContainerdProgressCallback`、`ContainerdBuildOutputCallback` | 镜像传输和构建的回调 |
| `ContainerdConnectionException` 和其他 `Containerd*Exception` | 异常（见下文） |

以上各项均由 `lakutata/com/containerd` 和 `@lakutata/containerd` 导出。类型声明中的每一项都附有说明和示例。

## 错误

| 异常 | 抛出时机 |
|---|---|
| `ContainerdConnectionException`（`E_CONTAINERD_CONNECTION`） | 创建组件时 containerd 未在 `socketPath` 上响应（containerd 未运行，或者套接字无法访问）；或者 `buildkitAddress` 是 unix 套接字，却给出了 `buildkitTLS` |
| `ContainerdImageNotFoundException`（`E_CONTAINERD_IMAGE_NOT_FOUND`） | 不存在该名称的镜像：`getImage()`、使用尚未拉取的镜像调用 `createContainer()`、对已删除的镜像执行操作 |
| `ContainerdPlatformException`（`E_CONTAINERD_PLATFORM`） | 镜像没有所请求平台的清单（拉取、推送、创建容器时） |
| `ContainerdImagePullException`（`E_CONTAINERD_IMAGE_PULL`） | 镜像仓库无法访问、拒绝凭据或者不存在该引用；传输或解包失败 |
| `ContainerdImagePushException`（`E_CONTAINERD_IMAGE_PUSH`） | 镜像仓库无法访问或者拒绝推送 |
| `ContainerdImageImportException`（`E_CONTAINERD_IMAGE_IMPORT`） | 归档无法读取或者不含镜像；归档中有多个镜像，却给出了 `name`；解包失败 |
| `ContainerdImageExportException`（`E_CONTAINERD_IMAGE_EXPORT`） | 归档无法写入 |
| `ContainerdImageBuildException`（`E_CONTAINERD_IMAGE_BUILD`） | BuildKit 无法访问、构建失败，或者构建好的镜像无法导入 |
| `ContainerdContainerNotFoundException`（`E_CONTAINERD_CONTAINER_NOT_FOUND`） | 没有容器与该 ID、名称或 ID 前缀匹配 |
| `ContainerdContainerNameConflictException`（`E_CONTAINERD_CONTAINER_NAME_CONFLICT`） | 已有其他容器使用该名称 |
| `ContainerdContainerStateException`（`E_CONTAINERD_CONTAINER_STATE`） | 对未运行的容器调用 `exec()`、`createTTY()`、`stats()`、`kill()`、`pause()`、`unpause()` 或 `processes()`；对已暂停的容器调用 `start()`；不带 `force` 对正在运行的容器调用 `remove()`；`update()` 需要重新创建一个并非由组件创建的容器 |
| `ContainerdPathNotFoundException`（`E_CONTAINERD_PATH_NOT_FOUND`） | `exportDirectory()` 的路径在容器中不存在 |
| `ContainerdNetworkNotFoundException`（`E_CONTAINERD_NETWORK_NOT_FOUND`） | 不存在该名称或 ID 的网络；在不存在的网络上创建容器 |
| `ContainerdNetworkConflictException`（`E_CONTAINERD_NETWORK_CONFLICT`） | 网络已存在、子网与其他网络重叠、网络正被容器使用、网络是默认的 `bridge`，或者网络并非由 nerdctl 创建 |
| `ContainerdVolumeNotFoundException`（`E_CONTAINERD_VOLUME_NOT_FOUND`） | 卷不存在 |
| `ContainerdVolumeInUseException`（`E_CONTAINERD_VOLUME_IN_USE`） | 有容器挂载了该卷 |
| `InvalidValueException`（来自 `lakutata`） | 创建组件时选项无效；在线 `update()` 修改 `memorySwap` 时，容器没有内存限制，或者新值小于内存限制 |
| `InvalidMethodAcceptException`（来自 `lakutata`） | 调用的参数不符合选项的要求（容器名称含空格、缺少 `image`、设置了 `memorySwap` 却没有 `memoryLimit`） |
| `GRPCError`（来自 `@lakutata/grpc`） | `wait()` 被中止（对象被销毁）；与 containerd 的连接断开 |
| `Error` | 容器的设置无法应用（有端口却没有 CNI 网络、没有命令、没有 CNI 插件、镜像中没有指定的用户）；容器前缀匹配到多个容器 |

## 另见

- 网站上的指南：[Containerd 集成](https://lakutata.com/zh/guide/ContainerdIntegration)。
- `lakutata` 包中的 `doc/zh/ContainerdIntegration.md`：组件的指南。
- `@lakutata/docker`（`lakutata/com/docker`）：通过 Docker 守护进程完成同样的操作。
- `@lakutata/grpc`：组件及其构建所用的 gRPC 客户端。
- `@lakutata/core`（`lakutata`）：组件、`Application` 和依赖注入。
