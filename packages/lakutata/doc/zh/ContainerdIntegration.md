# Lakutata containerd 集成

**containerd 组件**（`lakutata/com/containerd`，包 `@lakutata/containerd`）通过 [containerd](https://containerd.io)
的 API 管理它的镜像与容器，不需要 Docker，也不需要 nerdctl。它面向只运行 containerd 的机器，例如嵌入式 Linux 设备：
组件直接与 containerd 的 socket 通信（基于 HTTP/2 的 gRPC，纯 TypeScript 实现，没有原生插件），并自行完成 nerdctl
在 containerd 之上所做的工作（从镜像仓库拉取、解包镜像层、生成容器的 OCI 规范、容器日志）。

它创建的容器与 nerdctl 的容器一致：带有 nerdctl 的标签（`nerdctl/name`、`nerdctl/hostname`……），因此
`nerdctl ps` 与 `ctr containers ls` 都能列出它们。

## 1. 配置

```typescript
import {Application} from 'lakutata'
import {Containerd} from 'lakutata/com/containerd'

Application.run({
    id: 'device.app',
    name: 'device',
    components: {
        containerd: {
            class: Containerd,
            socketPath: '/run/containerd/containerd.sock', //默认值
            namespace: 'default',                          //nerdctl 使用的命名空间
            snapshotter: 'overlayfs',                      //或 native
            cgroupManager: 'cgroupfs',                     //containerd 以 SystemdCgroup 运行 runc 时为 systemd
            dataRoot: '/var/lib/lakutata/containerd',      //容器的日志、hosts、resolv.conf
            logMaxSize: 10 * 1024 * 1024,                  //容器启动时轮转超过该大小的日志（0：不轮转）
            registryAuths: {'registry.example.com': {username: 'deploy', password: 'secret'}},
            insecureRegistries: ['localhost:5000']         //通过 HTTP 访问的镜像仓库
        }
    },
    bootstrap: ['containerd']
})
```

应用需要有访问 containerd socket 的权限（通常是 root）。containerd 不可用时，组件在启动时抛出
`ContainerdConnectionException`；命名空间不存在时组件会创建它。

## 2. 镜像

```typescript
const containerd: Containerd = await app.getObject('containerd')

//拉取本机平台的镜像，并解包到快照中
const image = await containerd.pullImage({image: 'alpine:3.20', progressCallback: progress => console.log(progress)})
image.name      //docker.io/library/alpine:3.20
image.platforms //['linux/arm64/v8']
image.config    //{env, cmd, entrypoint, workingDir, user, exposedPorts, volumes, labels, stopSignal}

//其他平台（或全部平台）、镜像仓库的凭据
await containerd.pullImage({image: 'alpine:3.20', platform: ['linux/amd64', 'linux/arm/v7']})
await containerd.pullImage({image: 'registry.example.com/team/app:1.0', auth: {username: 'u', password: 'p'}})

await image.tag('registry.example.com/team/alpine:3.20')
await (await containerd.getImage('registry.example.com/team/alpine:3.20')).push()

//归档：OCI 镜像布局（docker load 与 nerdctl load 可加载）、docker save 的归档
await image.export({destination: '/tmp/alpine.tar'})
await containerd.exportImages(['alpine:3.20', 'busybox'], {destination: '/tmp/images.tar'})
await containerd.importImage({source: '/tmp/alpine.tar'})

await containerd.listImages()
await image.remove()
```

镜像名称按 Docker 的方式规范化（`alpine` 即 `docker.io/library/alpine:latest`）。只要还有镜像或容器在使用，
containerd 就会保留镜像的内容（通过其垃圾回收标签）。

## 3. 容器

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
    network: 'host',          //宿主机网络；none：只有回环接口；默认是 CNI 网络 bridge（见下文）
    memoryLimit: 128 * 1024 * 1024,
    cpus: 0.5,
    restartPolicy: 'always'   //由 containerd 的 restart monitor 维持，应用未运行时也有效
})
await container.start()
container.state  //{status: 'running', pid, exitCode, startedAt, finishedAt…}

const result = await container.exec({cmd: 'cat /etc/os-release', user: 'root'})
result.exitCode; result.stdout; result.stderr
await container.exec({cmd: ['sh', '-c', 'cat > /data/input'], stdin: 'content'})

for await (const chunk of await container.logs({tail: 100, follow: false})) process.stdout.write(chunk)

await container.stop({timeout: 10})   //先发送停止信号，超时后发送 SIGKILL
await container.restart()
await container.pause(); await container.unpause()
await container.remove({force: true}) //同时删除其快照与状态目录

await container.stats()                         //{cpu: {percent…}, memory: {usage, limit…}, blkio, networks, pids}
await container.update({memoryLimit: 256 * 1024 * 1024, restartPolicy: 'always'}) //运行中直接修改（docker update）
await container.update({env: {MODE: 'debug'}})  //其他设置：用新设置重建容器，名称不变
const tty = await container.createTTY({consoleSize: {cols: 120, rows: 40}}) //带伪终端的 shell
tty.onData(chunk => process.stdout.write(chunk)); tty.write('ls\n'); await tty.resize({cols: 100, rows: 30})
await container.commit({repoTag: 'app:patched', changes: {cmd: ['node', 'main.js']}}) //把改动提交为镜像
await container.exportDirectory({path: '/var/log', destination: '/tmp/logs.tar'})     //导出为 tar 归档

await containerd.getContainer('worker')        //按名称、ID 或 ID 前缀
await containerd.listContainers({app: 'web'})  //按标签
```

- 容器的输出由 containerd 的 shim 写入日志文件，因此应用停止或重启时日志仍会继续记录。`exec` 分别捕获标准输出与
  标准错误（使用系统的 `mkfifo` 创建 FIFO；没有 `mkfifo` 时二者都在 `stdout` 中）。
- `devices` 把宿主机的设备（串口、某个目录中的设备，如 `/dev/snd`）在创建容器时给到容器。之后才插入的设备（USB 串口，
  或重新插拔后变成 `ttyUSB1`）可以像 Docker 的 `--device-cgroup-rule` 一样，通过绑定其目录并放行其设备号来使用：
  `binds: [{hostPath: '/dev', containerPath: '/dev'}], deviceCgroupRules: ['c 188:* rwm']`（188：USB 串口）。
- 在 cgroup v2 上容器拥有独立的 cgroup 命名空间（`cgroupns: 'host'` 则共享宿主机的）。
- 与 nerdctl 一样，容器的系统调用由 seccomp 过滤：使用 containerd 的默认 profile，并按容器的 capabilities 放行相应的系统调用
  （`capabilities: ['SYS_ADMIN']` 会放行 `mount`、`unshare` 等）。`seccompProfile: 'unconfined'` 关闭过滤，也可以给出
  OCI 格式 profile 文件的路径（其规范中的 `linux.seccomp`）；特权容器以及内核不支持 seccomp 时不过滤。
- `privileged`、`capabilities` / `capabilitiesDrop`、`readonlyRootfs`、`pidMode: 'host'`、`ipcMode: 'host'`、
  `sysctls`、`extraHosts`、`dns`、`shmSize`、`pidsLimit`、`cpuSet`、`OOMKillDisable` 与 Docker 的同名选项含义相同。

命名卷保存在 dataRoot 下，容器使用时自动创建：

```typescript
await containerd.createVolume({name: 'data', labels: {app: 'web'}})
await containerd.createContainer({image: 'app', volumes: [{volumeName: 'data', containerPath: '/var/lib/app'}]})
await containerd.listVolumes()
await containerd.removeVolume('data') //仍有容器使用时会被拒绝

//停止的容器、悬空镜像（allImages：所有未使用的镜像）、未使用的网络与卷
await containerd.prune({networks: true, volumes: true})
```

## 4. 网络

除了宿主机网络（默认）与 `none`，容器还可以加入 CNI 网络：`bridge`（nerdctl 的默认网络，`nerdctl0`，`10.4.0.0/24`，
在有容器使用时自动创建）以及自行创建的网络。网络配置与 nerdctl 的格式相同（`/etc/cni/net.d/nerdctl-<name>.conflist`），
因此 nerdctl 与组件可以共用这些网络。需要安装 CNI 插件（`/opt/cni/bin`、`/usr/lib/cni` 或 `/usr/libexec/cni`，可通过
`cniPath` 选项指定）以及 iptables。

```typescript
const network = await containerd.createNetwork({name: 'backend', subnet: '10.4.10.0/24'}) //或自动选择 10.4.0.0/16 中空闲的子网
await containerd.createNetwork({name: 'dual', subnet: '10.4.11.0/24', ipv6Subnet: 'fd00:4:11::/64'}) //同时支持 IPv6（容器可指定 ipv6）
await containerd.createNetwork({name: 'lan', driver: 'macvlan', parent: 'eth0', subnet: '192.168.1.0/24', gateway: '192.168.1.1', ipRange: '192.168.1.192/27'})

const web = await containerd.createContainer({
    image: 'nginx:alpine',
    networks: [{networkName: 'bridge'}, {networkName: 'backend', ip: '10.4.10.5'}], //eth0, eth1
    ports: [{port: 80, hostPorts: [8080]}]                                          //发布在第一个网络上
})
await web.start()
web.networks //[{networkName: 'bridge', interface: 'eth0', ip: '10.4.0.2', gateway: '10.4.0.1', mac…}, …]
web.ports    //[{host: '0.0.0.0', port: 80, type: 'tcp', hostPorts: [8080]}]

await containerd.listNetworks()
await containerd.removeNetwork('backend') //仍有容器使用时会被拒绝
```

与 nerdctl 一样，容器的网络由其钩子（由 runc 执行）配置：在任务创建时加入网络，在任务停止时删除网络。containerd 按
restart 策略重启容器时、设备重启之后，即使应用没有运行也是如此。容器每次启动时分配地址，并写入其 `/etc/hosts`。

## 5. 构建镜像

镜像由 [BuildKit](https://github.com/moby/buildkit) 构建：可以是本机的 `buildkitd`（通过其 socket，默认
`buildkitAddress: 'unix:///run/buildkit/buildkitd.sock'`，使用 containerd 或 runc worker），也可以是远程的
`buildkitd`（`tcp://builder:1234`，可配合 `buildkitTLS: {ca, cert, key}`）。组件像 `docker buildx` 一样，通过 BuildKit
的 session 发送构建上下文（排除 `.dockerignore` 中的文件）与 Dockerfile，并把构建出的镜像导入 containerd：

```typescript
const image = await containerd.buildImage({
    workdir: '/srv/app',                  //构建上下文
    dockerfile: 'docker/App.Dockerfile',  //默认为 Dockerfile
    repoTag: 'registry.example.com/team/app:1.0',
    buildargs: {NODE_ENV: 'production'},
    platform: ['linux/arm64', 'linux/amd64'], //默认为本机平台
    push: true,                               //构建完成后推送到镜像仓库
    outputCallback: line => console.log(line) //#3 [2/3] RUN npm ci …
})
await containerd.buildkitVersion()
await containerd.buildkitPlatforms() //其 worker 可构建的平台
```

远程 BuildKit 默认为本机的平台构建镜像，也可以构建它所在机器的模拟器所支持的平台。基础镜像所在镜像仓库的凭据使用组件的配置
（或 `auth` 选项）。

## 6. 其他架构的平台

`containerd.supportedPlatforms()` 返回本机可运行的平台：本机自身的平台，以及注册在 `binfmt_misc` 中的模拟器
（QEMU、Rosetta）的平台。模拟器按条目中的 ELF 机器类型识别，与条目名称无关。注册了对应模拟器后即可运行其他平台的容器：

```typescript
await containerd.pullImage({image: 'alpine:3.20', platform: 'linux/amd64'})
const container = await containerd.createContainer({image: 'alpine:3.20', platform: 'linux/amd64', cmd: ['uname', '-m']})
```

## 7. 事件

```typescript
const abort = new AbortController()
for await (const event of containerd.events(abort.signal)) {
    //{topic: '/tasks/exit', type: 'containerd.events.TaskExit', event: {containerId, exitStatus…}, namespace, timestamp}
}
```

## 8. 异常

`ContainerdConnectionException`、`ContainerdImageNotFoundException`、`ContainerdImagePullException`、
`ContainerdImagePushException`、`ContainerdImageImportException`、`ContainerdImageExportException`、
`ContainerdImageBuildException`（无法连接 BuildKit，或构建失败）、`ContainerdPlatformException`（镜像没有该平台的清单）、`ContainerdContainerNotFoundException`、
`ContainerdContainerNameConflictException`、`ContainerdContainerStateException`（正在运行、未运行、已暂停）、
`ContainerdNetworkNotFoundException`、`ContainerdNetworkConflictException`（网络已存在、子网与其他网络重叠、或仍有容器使用）、
`ContainerdVolumeNotFoundException`、`ContainerdVolumeInUseException`。

## 9. 当前版本的限制

- 暂不支持 Compose 项目。
- 容器日志不带时间戳。
