# Lakutata containerd 集成

**containerd 组件**（`lakutata/com/containerd`，`@lakutata/containerd` 包）通过 [containerd](https://containerd.io) 的 gRPC API 管理一个 containerd 命名空间中的镜像、容器、CNI 网络和命名卷，不需要 Docker，也不需要 nerdctl。它面向只运行 containerd 的 Linux 机器，例如嵌入式设备：组件直接与 containerd 的套接字通信（gRPC 客户端用 TypeScript 编写，没有原生插件），并自己完成 nerdctl 在 containerd 之上所做的工作（从镜像仓库拉取、解包镜像层、生成容器的 OCI 规范、容器日志）。它的 API 与 Docker 组件一致（[DockerIntegration](DockerIntegration.md)）。全部选项见 `@lakutata/containerd` 的 README。

它创建的容器就是 nerdctl 的容器：带有 nerdctl 的标签（`nerdctl/name`、`nerdctl/hostname` 等），因此 `nerdctl ps` 和 `ctr containers ls` 都能列出它们。

## 1. 环境要求

| 功能 | 需要 |
|---|---|
| 全部功能 | Linux，带 runc 的 containerd 1.6 或更高版本，Node.js 22 或更高版本；应用以 root 运行，或属于拥有 containerd 套接字的用户组 |
| CNI 网络（包括默认的 `bridge`）、端口发布 | CNI 插件（`bridge`、`portmap`、`host-local` 等，位于 `/opt/cni/bin`、`/usr/lib/cni` 或 `/usr/libexec/cni`，即 `cniPath` 选项）以及 iptables |
| 带 `stdin` 的 `exec()`、分开的 `stdout`/`stderr`、终端 | 主机上的 `mkfifo`（没有时，`exec()` 把两种输出都放在 `stdout` 中） |
| 构建 | BuildKit 守护进程（`buildkitd`），本地或远程 |
| 其他架构的容器 | 在 `binfmt_misc` 中注册的 QEMU（或 Rosetta）模拟器 |

## 2. 配置

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
                //组件启动容器时，超过 10 MiB 的日志文件会被轮转（0：从不轮转）
                logMaxSize: 10 * 1024 * 1024,
                registryAuths: {'registry.example.com': {username: 'deploy', password: 'secret'}},
                //通过 HTTP 访问的镜像仓库
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

组件在创建时连接 containerd：`socketPath` 上没有 containerd 时，应用启动失败并抛出 `ContainerdConnectionException`。命名空间不存在时会被创建。每个组件只在一个命名空间中工作；要管理多个命名空间，就为每个命名空间声明一个组件。

### 与 Docker 组件的不同

- `createContainer()` 在选项中接收镜像，并且从不自动拉取：请先拉取。
- 容器的输出由 containerd 的 shim 写入日志文件，重启策略由 containerd 的重启监视器执行：应用停止期间两者照常工作。日志没有时间戳。
- 没有 `loginRepository()`：凭据通过 `registryAuths` 选项或每次调用的 `auth` 给出。
- `importImage()` 返回归档中的所有镜像，`prune()` 返回它删除的内容。

## 3. 镜像

```typescript
import {type Containerd, type ContainerdImage, type ContainerdPruneResult} from 'lakutata/com/containerd'

async function images(containerd: Containerd): Promise<void> {
    //按本机平台拉取，并解包到快照器中
    const image: ContainerdImage = await containerd.pullImage({
        image: 'alpine:3.20',
        progressCallback: (progress): void => console.log(progress)
    })
    //docker.io/library/alpine:3.20、['linux/arm64/v8']、{env, cmd, entrypoint, workingDir, user, exposedPorts…}
    console.log(image.name, image.platforms, image.config)

    //其他平台（或 'all'），以及单次拉取的凭据
    await containerd.pullImage({image: 'alpine:3.20', platform: ['linux/amd64', 'linux/arm/v7']})
    await containerd.pullImage({image: 'registry.example.com/team/app:1.0', auth: {username: 'u', password: 'p'}})

    //打标签和推送
    const tagged: ContainerdImage = await image.tag('registry.example.com/team/alpine:3.20')
    await tagged.push()

    //归档：带有 docker load 所需 manifest.json 的 OCI 镜像布局；也可以导入 docker save 的归档
    await image.export({destination: '/tmp/alpine.tar'})
    await containerd.exportImages(['alpine:3.20', 'busybox'], {destination: '/tmp/images.tar'})
    const imported: ContainerdImage[] = await containerd.importImage({source: '/tmp/images.tar'})
    console.log(imported.length, (await containerd.listImages()).length)

    await tagged.remove()
    //已停止的容器和悬空镜像（allImages：所有没有容器使用的镜像）
    const pruned: ContainerdPruneResult = await containerd.prune({containers: true, images: true, allImages: false})
    console.log(pruned.images)
}
```

镜像名称按 Docker 的规则规范化（`alpine` 即 `docker.io/library/alpine:latest`）。只要有镜像或容器在使用，containerd 就会保留镜像的内容。

## 4. 容器

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
        //一个设备，以及之后插入的 USB 串口（主设备号 188）
        devices: [{hostPath: '/dev/ttyUSB0'}],
        deviceCgroupRules: ['c 188:* rwm'],
        //主机网络；'none'：只有回环接口；默认为 CNI 网络 bridge
        network: 'host',
        memoryLimit: 128 * 1024 * 1024,
        cpus: 0.5,
        //由 containerd 的重启监视器维持，应用不运行时也有效
        restartPolicy: 'always'
    })
    await container.start()
    console.log(container.state.status, container.state.pid)

    //字符串通过 /bin/sh -c 执行；无论退出码是多少，都返回退出码和输出
    const result: ContainerdExecResult = await container.exec({cmd: 'cat /etc/os-release', user: 'root', timeout: 5000})
    console.log(result.exitCode, result.stdout, result.stderr)
    await container.exec({cmd: ['sh', '-c', 'cat > /data/input'], stdin: 'content'})

    //最后 100 行；follow（默认）会在容器运行期间保持流打开
    for await (const chunk of await container.logs({tail: 100, follow: false})) process.stdout.write(chunk)

    //{cpu: {percent…}, memory: {usage, limit…}, blkio, networks, pids}
    console.log(await container.stats())

    //资源和重启策略：在线修改；其他设置：用新设置重新创建容器，名称不变
    await container.update({memoryLimit: 256 * 1024 * 1024, restartPolicy: 'unless-stopped'})
    await container.update({env: {MODE: 'debug'}})

    //带伪终端的 shell
    const tty: ContainerdContainerTTY = await container.createTTY({consoleSize: {cols: 120, rows: 40}})
    tty.onData((chunk: Buffer): void => {
        process.stdout.write(chunk)
    })
    tty.write('ls\n')
    await tty.resize({cols: 100, rows: 30})
    await tty.close()

    //把它的修改保存为镜像；把一个目录导出为 tar 归档
    await container.commit({repoTag: 'worker:patched', changes: {cmd: ['date']}})
    await container.exportDirectory({path: '/var/log', destination: '/tmp/logs.tar'})

    await container.pause()
    await container.unpause()
    //发送它的停止信号，10 秒后发送 SIGKILL
    await container.stop({timeout: 10})
    await container.restart()
    //同时删除它的快照和状态
    await container.remove({force: true})

    //按名称、标识符或其前缀查找；按标签列出
    console.log(await containerd.listContainers({app: 'worker'}))
}
```

- `devices` 在容器中创建主机的设备（单个设备，或某个目录下的所有设备，如 `/dev/snd`）。对于之后才插入的设备，绑定挂载它们所在的目录，并用 `deviceCgroupRules` 允许它们的设备号，与 Docker 的 `--device-cgroup-rule` 相同：`binds: [{hostPath: '/dev', containerPath: '/dev'}], deviceCgroupRules: ['c 188:* rwm']`。
- 在 cgroup v2 上，容器有自己的 cgroup 命名空间（`cgroupns: 'host'` 则共享主机的）。
- 容器的系统调用像 nerdctl 一样由 seccomp 过滤：使用 containerd 的默认配置，并放行容器 `capabilities` 所允许的系统调用（`capabilities: ['SYS_ADMIN']` 允许 `mount`、`unshare` 等）。`seccompProfile: 'unconfined'` 关闭过滤，给出文件路径则使用该 OCI 配置；特权容器不受限制。
- `privileged`、`capabilities` / `capabilitiesDrop`、`readonlyRootfs`、`pidMode: 'host'`、`ipcMode: 'host'`、`sysctls`、`extraHosts`、`dns`、`shmSize`、`pidsLimit`、`cpuSet`、`cpuShares`、`memorySwap`、`OOMKillDisable` 与 Docker 的同名选项相同。
- `update()` 修改资源和重启策略以外的设置时，只对组件创建的容器有效（组件把它们的设置保存在 `dataRoot` 中）。

### 卷

命名卷是 `dataRoot` 下的目录，在容器挂载时或通过 `createVolume()` 创建：

```typescript
import {type Containerd} from 'lakutata/com/containerd'

async function volumes(containerd: Containerd): Promise<void> {
    await containerd.createVolume({name: 'data', labels: {app: 'web'}})
    await containerd.createContainer({image: 'alpine:3.20', volumes: [{volumeName: 'data', containerPath: '/var/lib/app'}]})
    console.log(await containerd.listVolumes())
    //有容器挂载时拒绝删除，即使容器已停止
    await containerd.removeVolume('data').catch((error: Error): void => console.log(error.message))
    //已停止的容器、悬空镜像、未使用的网络和卷
    await containerd.prune({networks: true, volumes: true})
}
```

## 5. 网络

容器默认加入 CNI 网络 `bridge`（nerdctl 的默认网络，`nerdctl0`，`10.4.0.0/24`，在第一个容器需要时创建），端口发布在这个网络上。`network: 'host'` 让容器使用主机的网络，`network: 'none'` 只保留回环接口，`networks` 列出容器加入的 CNI 网络：`bridge` 以及创建的网络（bridge、macvlan 或 ipvlan，支持 IPv4 和 IPv6 子网）。网络配置就是 nerdctl 的配置（`/etc/cni/net.d/nerdctl-<name>.conflist`），nerdctl 和组件可以共用。需要安装 CNI 插件和 iptables（见环境要求）。

```typescript
import {type Containerd, type ContainerdContainer, type ContainerdNetworkInfo} from 'lakutata/com/containerd'

async function networks(containerd: Containerd): Promise<void> {
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
    //[{networkName: 'bridge', interface: 'eth0', ip: '10.4.0.2', gateway: '10.4.0.1', mac…}, …]
    console.log(web.networks, web.ports)

    await web.remove({force: true})
    //有容器使用时拒绝删除
    await containerd.removeNetwork('backend')
    console.log(await containerd.listNetworks())
}
```

容器的网络像 nerdctl 一样由它的 runc 钩子配置：在创建任务时添加，在停止时删除；containerd 按重启策略重启容器时（例如重启机器后，应用不在运行）也是如此。容器的地址在每次启动时分配，并写入它的 `/etc/hosts`。

## 6. 构建

镜像由 [BuildKit](https://github.com/moby/buildkit) 构建：本机的 `buildkitd`（它的套接字，默认 `buildkitAddress: 'unix:///run/buildkit/buildkitd.sock'`，使用 containerd 或 runc worker），或者远程的 BuildKit（`buildkitAddress: 'tcp://builder:1234'`，配合 `buildkitTLS: {ca, cert, key}`）。组件像 `docker buildx` 一样，通过 BuildKit 的会话发送构建上下文（排除 `.dockerignore` 中的文件）和 Dockerfile，并把构建好的镜像导入 containerd：

```typescript
import {type Containerd, type ContainerdImage} from 'lakutata/com/containerd'

async function build(containerd: Containerd): Promise<void> {
    console.log(await containerd.buildkitVersion(), await containerd.buildkitPlatforms())
    const image: ContainerdImage = await containerd.buildImage({
        //构建上下文
        workdir: '/srv/app',
        //默认为 Dockerfile
        dockerfile: 'docker/App.Dockerfile',
        repoTag: 'registry.example.com/team/app:1.0',
        buildargs: {NODE_ENV: 'production'},
        //默认为本机平台
        platform: ['linux/arm64', 'linux/amd64'],
        //构建完成后推送到镜像仓库
        push: true,
        //#3 [2/3] RUN npm ci …
        outputCallback: (line: string): void => console.log(line)
    })
    console.log(image.platforms)
}
```

BuildKit 使用组件的镜像仓库凭据（或 `auth`）拉取基础镜像。

## 7. 平台与事件

`containerd.supportedPlatforms()` 返回本机能运行的平台：本机平台，以及在 `binfmt_misc` 中注册的模拟器（QEMU、Rosetta）对应的平台。注册了模拟器后，就能运行其他平台的容器：先拉取该平台的镜像，再 `createContainer({image: 'alpine:3.20', platform: 'linux/amd64', cmd: ['uname', '-m']})`。

`containerd.events(signal)` 以流的形式返回命名空间中 containerd 的事件：

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

## 8. 异常

`ContainerdConnectionException`、`ContainerdImageNotFoundException`、`ContainerdImagePullException`、`ContainerdImagePushException`、`ContainerdImageImportException`、`ContainerdImageExportException`、`ContainerdImageBuildException`（BuildKit 不可达或构建失败）、`ContainerdPlatformException`（镜像没有该平台的清单）、`ContainerdContainerNotFoundException`、`ContainerdContainerNameConflictException`、`ContainerdContainerStateException`（正在运行、未运行、已暂停）、`ContainerdPathNotFoundException`、`ContainerdNetworkNotFoundException`、`ContainerdNetworkConflictException`（网络已存在、子网与其他网络重叠，或有容器在使用）、`ContainerdVolumeNotFoundException`、`ContainerdVolumeInUseException`。它们都由 `lakutata/com/containerd` 导出。

## 9. 当前版本的限制

- 不支持 Compose 项目。
- 容器日志没有时间戳。
