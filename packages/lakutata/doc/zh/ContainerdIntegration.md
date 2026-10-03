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
    network: 'host',          //或 none：只有回环接口
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

await containerd.getContainer('worker')        //按名称、ID 或 ID 前缀
await containerd.listContainers({app: 'web'})  //按标签
```

- 容器的输出由 containerd 的 shim 写入日志文件，因此应用停止或重启时日志仍会继续记录。`exec` 分别捕获标准输出与
  标准错误（使用系统的 `mkfifo` 创建 FIFO；没有 `mkfifo` 时二者都在 `stdout` 中）。
- 在 cgroup v2 上容器拥有独立的 cgroup 命名空间（`cgroupns: 'host'` 则共享宿主机的）。
- `privileged`、`capabilities` / `capabilitiesDrop`、`readonlyRootfs`、`pidMode: 'host'`、`ipcMode: 'host'`、
  `sysctls`、`extraHosts`、`dns`、`shmSize`、`pidsLimit`、`cpuSet`、`OOMKillDisable` 与 Docker 的同名选项含义相同。

## 4. 其他架构的平台

`containerd.supportedPlatforms()` 返回本机可运行的平台：本机自身的平台，以及注册在 `binfmt_misc` 中的模拟器
（QEMU、Rosetta）的平台。模拟器按条目中的 ELF 机器类型识别，与条目名称无关。注册了对应模拟器后即可运行其他平台的容器：

```typescript
await containerd.pullImage({image: 'alpine:3.20', platform: 'linux/amd64'})
const container = await containerd.createContainer({image: 'alpine:3.20', platform: 'linux/amd64', cmd: ['uname', '-m']})
```

## 5. 事件

```typescript
const abort = new AbortController()
for await (const event of containerd.events(abort.signal)) {
    //{topic: '/tasks/exit', type: 'containerd.events.TaskExit', event: {containerId, exitStatus…}, namespace, timestamp}
}
```

## 6. 异常

`ContainerdConnectionException`、`ContainerdImageNotFoundException`、`ContainerdImagePullException`、
`ContainerdImagePushException`、`ContainerdImageImportException`、`ContainerdImageExportException`、
`ContainerdPlatformException`（镜像没有该平台的清单）、`ContainerdContainerNotFoundException`、
`ContainerdContainerNameConflictException`、`ContainerdContainerStateException`（正在运行、未运行、已暂停）。

## 7. 当前版本的限制

- 网络只支持宿主机网络与 none；CNI 网络（网桥）与端口发布将在后续版本提供。
- 暂不支持构建镜像（后续通过本地或远程的 BuildKit 提供），也暂不支持 Compose 项目。
- 容器运行时没有 seccomp 配置，日志不带时间戳。
