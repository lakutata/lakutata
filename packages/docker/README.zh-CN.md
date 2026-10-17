# @lakutata/docker

[English](README.md) | 中文

lakutata 框架的 Docker 组件。它通过 Docker Engine API 操作 Docker 守护进程，不需要 Docker CLI：拉取、构建（使用 BuildKit）、导入、导出、打标签和推送镜像，创建、运行和管理容器（exec、交互式 TTY、日志、统计、commit、导出文件），以及管理网络。它可以连接本地套接字，也可以通过 HTTP、HTTPS 或 SSH 连接远程守护进程。`lakutata` 包通过 `lakutata/com/docker` 重新导出它。

## 安装

```shell
npm install lakutata
```

组件需要应用能访问到的 Docker 守护进程（Docker Engine 或 Docker Desktop，Engine API 1.41 或更高版本），本机不需要安装 Docker CLI。SSH 连接使用可选的 peer 依赖 `ssh2`，并且需要远程主机上有 Docker CLI：

```shell
npm install ssh2
```

| 连接方式 | 选项 | 需要 |
|---|---|---|
| 环境中配置的 Docker（默认） | 无：读取 `DOCKER_HOST`、`DOCKER_TLS_VERIFY`、`DOCKER_CERT_PATH`、`DOCKER_CLIENT_TIMEOUT`，否则使用本地套接字 | 无 |
| Unix 套接字 / Windows 命名管道 | `socketPath`（`buildDockerSocketConnectionOptions`） | 套接字的访问权限（`docker` 组） |
| TCP，普通 HTTP | `host`、`port`（`buildDockerHttpConnectionOptions`） | 在 TCP 上监听的守护进程（`-H tcp://0.0.0.0:2375`） |
| TCP，HTTPS | `host`、`port`，以及 PEM 内容形式的 `ca`、`cert`、`key`（`buildDockerHttpsConnectionOptions`） | 启用了 TLS 的守护进程（`--tlsverify`） |
| SSH | `host`、`port`、`username`、`sshAuthAgent`（`buildDockerSSHConnectionOptions`） | 本机的 `ssh2`；远程主机上的 Docker CLI；SSH agent 中的密钥 |

## 用法

### 在应用中使用组件

在应用的 `components` 中注册 `Docker`，然后通过 `getObject()` 或 `@Inject` 获取它。组件创建时会 ping 守护进程，并协商 API 版本：守护进程连不上时，组件创建失败，抛出 `DockerConnectionException`。如果组件是在应用启动过程中创建的（列在 `bootstrap` 里，或者注入到了这样的对象中），应用的启动也会随之失败。

```typescript
import {Application} from 'lakutata'
import {Docker, type DockerContainer, type DockerImage} from 'lakutata/com/docker'

Application
    .run(() => ({
        id: 'docker.app',
        name: 'Docker',
        components: {
            //环境中的 Docker：DOCKER_HOST，否则为本地套接字
            docker: {class: Docker}
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const docker: Docker = await app.getObject('docker')

        //拉取后按 alpine:3.20 查找
        const image: DockerImage = await docker.pullImage({repo: 'alpine', tag: '3.20'})

        //创建并启动
        const container: DockerContainer = await image.run({
            name: 'hello',
            cmd: ['sh', '-c', 'echo started; sleep 3600'],
            env: {MODE: 'production'}
        })
        console.log(container.id, container.state.status)

        //退出码、stdout 和 stderr
        const {exitCode, stdout} = await container.exec({cmd: ['cat', '/etc/alpine-release']})
        console.log(exitCode, stdout)

        await container.stop({timeout: 10})
        await container.remove()
    })
```

### 连接

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
        //套接字，请求超时 60 秒
        local: buildDockerSocketConnectionOptions({socketPath: '/var/run/docker.sock', timeout: 60000}),
        //TLS：传入 PEM 内容，而不是文件路径
        remote: buildDockerHttpsConnectionOptions({
            host: 'docker.example.com',
            port: 2376,
            ca: readFileSync('/etc/docker/certs/ca.pem'),
            cert: readFileSync('/etc/docker/certs/cert.pem'),
            key: readFileSync('/etc/docker/certs/key.pem')
        }),
        //SSH：通过 SSH agent（SSH_AUTH_SOCK）认证
        builder: buildDockerSSHConnectionOptions({host: 'build.example.com', port: 22, username: 'deploy'}),
        //直接写出选项，并固定 API 版本
        pinned: {class: Docker, version: '1.47'}
    }
}))
```

- 没有 `socketPath` 或 `host` 时，组件连接环境中配置的 Docker，给出的其他选项（`timeout`、`headers`、`version`……）覆盖环境中的设置。
- `ca`、`cert` 和 `key` 都给出时，`protocol` 默认为 `'https'`，否则默认为 `'http'`。
- `timeout`（毫秒）是请求最多可以空闲多久；空闲同样久的流（比如持续跟踪的日志）也会被关闭。

### 镜像

```typescript
import {createReadStream} from 'node:fs'
import {type Docker, type DockerImage} from 'lakutata/com/docker'

declare const docker: Docker

//拉取，附带镜像仓库的凭据和进度消息
const node: DockerImage = await docker.pullImage({
    repo: 'registry.example.com/base/node',
    tag: '22',
    platform: 'linux/amd64',
    auth: {serverAddress: 'registry.example.com', username: 'ci', password: 'secret'},
    outputCallback: (output: Record<string, any>): void => console.log(output.status, output.progress ?? '')
})

//使用 BuildKit 构建：构建上下文是列出的文件（目录连同其内容），排除 .dockerignore 中的文件
const app: DockerImage = await docker.buildImage({
    workdir: '/srv/app',
    files: ['Dockerfile', 'package.json', 'src'],
    repoTag: 'app:1.0.0',
    buildargs: {NODE_ENV: 'production'},
    outputCallback: (output: Record<string, any>): void => console.log(output.stream ?? '')
})

//打标签、推送、保存为归档文件、再加载回来
await app.tag({repo: 'registry.example.com/team/app', tag: '1.0.0'})
await app.push({repo: 'registry.example.com/team/app', tag: '1.0.0', auth: {serverAddress: 'registry.example.com', username: 'ci', password: 'secret'}})
await app.export({destination: '/tmp/app.tar', repoTag: 'app:1.0.0'})
const loaded: DockerImage = await docker.importImage({source: createReadStream('/tmp/app.tar')})

//按 ID、短 ID 或名称查找，列出，删除（默认强制），清理
console.log((await docker.getImage('app:1.0.0')).id, loaded.repoTags, node.platform)
console.log((await docker.listImages()).map((image: DockerImage): string[] => image.repoTags))
await app.remove()
await docker.prune({containers: false, images: true, networks: false, volumes: false})
```

- `getImage()` 按守护进程的规则解析名称：完整或短 ID、`alpine`（即 `alpine:latest`）、`docker.io/library/alpine:3.20`，或者摘要。`pullImage()` 也用同样的方式查找拉取到的镜像。
- `listImages()` 会读取每个镜像的详细信息，每个镜像发送一次请求。
- 不带选项的 `prune()` 清理已停止的容器和悬空镜像；未使用的网络和匿名卷只在指定时清理（`networks: true`、`volumes: true`）。
- 拉取、构建、推送和 `loginRepository()` 会完整发送镜像仓库的凭据（`auth`），包括其中的令牌（`identityToken`、`registryToken`）。

### 容器

```typescript
import {createWriteStream} from 'node:fs'
import {type Docker, type DockerContainer, type DockerContainerTTY, type DockerImage} from 'lakutata/com/docker'

declare const docker: Docker

const image: DockerImage = await docker.getImage('nginx:1.27')
//创建，但不启动
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

//目前为止的日志（follow: true 时在容器运行期间保持流打开）
const logs: NodeJS.ReadableStream = await web.logs({follow: false, tail: 100, timestamps: true})
logs.pipe(process.stdout)

//一次 CPU、内存、网络和块 I/O 的采样
console.log(await web.stats())

//命令行（由 /bin/sh -c 执行），以及它的退出码
const {exitCode, stdout, stderr} = await web.exec({cmd: 'nginx -t && ls /etc/nginx | wc -l'})
console.log(exitCode, stdout, stderr)

//带 TTY 的交互式 shell（默认 /bin/sh）
const tty: DockerContainerTTY = await web.createTTY({consoleSize: {cols: 120, rows: 40}})
tty.onData((chunk: Buffer): void => {
    process.stdout.write(chunk)
})
tty.write('nginx -v\n')
await tty.resize({cols: 160, rows: 50})
tty.write('exit\n')

//把容器中的一个目录导出为 tar 归档；用容器的文件生成镜像
await web.exportDirectory({path: '/etc/nginx', destination: createWriteStream('/tmp/nginx-conf.tar')})
const snapshot: DockerImage = await web.commit({repoTag: 'web-snapshot:1'})
console.log(snapshot.id)

//资源限制和重启策略在线修改；其他设置通过重建容器修改（容器的 ID 会变）
await web.update({memoryLimit: 512 * 1024 * 1024, restartPolicy: 'on-failure:3'})
await web.update({env: {TZ: 'UTC'}})

await web.restart({timeout: 5})
await web.kill({signal: 'SIGHUP'})
await web.pause()
await web.unpause()
await web.stop()
await web.remove({force: true})

//所有容器，包括已停止的
console.log((await docker.listContainers()).map((container: DockerContainer): string => `${container.name}: ${container.state.status}`))
```

- `DockerContainer` 是一个快照：它自己的操作会刷新它；其他地方做的修改，需要重新获取才能看到（`docker.getContainer(id)`，也接受名称或短 ID）。如果容器的镜像已经被强制删除，读取这个容器时就没有镜像信息，它的 `image` 为 `undefined`。
- 启动正在运行的容器，或者停止已停止的容器，都什么也不做，与 Docker CLI 一样。
- `exec()` 运行时没有 TTY，也没有 stdin；无论退出码是多少，它都返回 `{exitCode, stdout, stderr}`（与 containerd 组件相同）。数组形式的命令原样执行；字符串是命令行，由 `/bin/sh -c` 执行。
- `createTTY()` 默认运行 `/bin/sh`；它的 `cmd` 与 `exec()` 的规则相同。写入失败时，由应用的 `log` 组件记录；没有这个组件时，输出到控制台。
- `kill()` 默认发送 `SIGKILL`，也可以指定信号（`'SIGHUP'`、`15`）。
- `update()` 在线修改内存限制、CPU 和重启策略，名称则通过重命名容器来修改。修改其他设置时，会按容器的完整配置重建容器（命令、挂载、网络，匿名卷也会重新挂载）。新容器先用临时名称创建，创建完成后（如果旧容器在运行，还要等新容器启动）才取代旧容器，所以中途失败时旧容器保持原样。容器的 ID 会变，卷以外的文件不会保留。
- 容器从未启动过时，`state.startedAt` 为 `null`；从未退出过时，`state.finishedAt` 为 `null`。
- 不提供的功能：附加到主进程、向容器中复制文件、管理卷（`prune()` 的清理除外），以及守护进程的事件。

### 网络

```typescript
import {type Docker, type NetworkInfo} from 'lakutata/com/docker'

declare const docker: Docker

const network: NetworkInfo = await docker.createNetwork({
    name: 'backend',
    driver: 'bridge',
    NetworkIPAMConfigs: [{subnet: '172.30.0.0/16', gateway: '172.30.0.1'}],
    internal: false
})
//由守护进程选择子网
await docker.createNetwork({name: 'frontend'})
console.log(network.id, network.IPAMConfigs)
//Docker 报告的驱动：bridge、host、null、overlay……
console.log((await docker.listNetworks()).map((item: NetworkInfo): string => `${item.name}: ${item.driver}`))
//按 ID、短 ID 或名称查找
console.log((await docker.getNetwork('frontend')).id)
await docker.removeNetwork('frontend')
await docker.removeNetwork(network.id)
```

## API

| 导出 | 说明 |
|---|---|
| `Docker` | 组件：`pullImage`、`buildImage`、`importImage`、`getImage`、`listImages`、`createContainer`、`getContainer`、`listContainers`、`createNetwork`、`getNetwork`、`listNetworks`、`removeNetwork`、`prune`、`loginRepository`、`checkRepositoryAuth`；连接选项 |
| `DockerImage` | 一个镜像：`id`、`repoTags`、`platform`、`size`、`config`；`tag()`、`export()`、`push()`、`remove()`、`run()` |
| `DockerContainer` | 一个容器：它的设置和 `state`；`start()`、`stop()`、`restart()`、`pause()`、`unpause()`、`kill()`、`remove()`、`update()`、`commit()`、`exec()`、`createTTY()`、`logs()`、`stats()`、`exportDirectory()` |
| `DockerContainerTTY` | 带 TTY 的交互式命令：`raw`、`readable`、`writable`、`onData()`、`write()`、`resize()` |
| `buildDockerConnectionOptions`、`buildDockerSocketConnectionOptions`、`buildDockerHttpConnectionOptions`、`buildDockerHttpsConnectionOptions`、`buildDockerSSHConnectionOptions` | 为每种连接方式构建组件选项 |
| `IDockerConnectionOptions`、`IDockerSocketConnectionOptions`、`IDockerHttpConnectionOptions`、`IDockerHttpsConnectionOptions`、`IDockerSSHConnectionOptions`、`IDockerKeyObject` | 连接选项 |
| `ImagePullOptions`、`ImageBuildOptions`、`ImageImportOptions`、`ImageExportOptions`、`ImageTagOptions`、`ImagePushOptions`、`ImageRemoveOptions` | 镜像操作的选项 |
| `ContainerSettingOptions`、`ContainerStopOptions`、`ContainerKillOptions`、`ContainerRemoveOptions`、`ContainerCommitOptions`、`ContainerExecOptions`、`ContainerCreateTTYOptions`、`ContainerTTYConsoleSizeOptions`、`ContainerLogsOptions`、`ContainerExportDirectoryOptions` | 容器操作的选项 |
| `NetworkCreateOptions`、`DockerPruneOptions`、`DockerAuthOptions` | 创建网络和 `prune()` 的选项，以及镜像仓库的凭据 |
| `ContainerState`、`ContainerPort`、`ContainerBind`、`ContainerDevice`、`ContainerNetwork`、`ContainerCapability`、`ContainerRestartPolicy`、`ContainerStats`、`ContainerConfig`、`ContainerExecResult` | 容器相关的类型，以及 `exec()` 的结果 |
| `ImageConfig`、`ImageExposePort`、`RepositoryTag`、`NetworkInfo`、`DockerOutputCallback` | 镜像、网络和进度消息的类型 |
| `parseRepositoryTag`、`parseEnvToRecord` | 把镜像引用拆成仓库和标签；把 `NAME=value` 形式的条目转成键值对象 |
| `DockerConnectionException`、`DockerContainerNotFoundException`、`DockerImageNotFoundException`、`DockerImagePullException`、`DockerImageBuildException`、`DockerImageImportException`、`DockerImagePushException`、`DockerImageRepoTagNotFoundException`、`DockerNetworkNotFoundException`、`DockerRequestException` | 异常 |

以上全部由 `lakutata/com/docker` 和 `@lakutata/docker` 导出。类型声明中的每一项都附有说明和示例。

## 错误

| 异常 | 什么时候 |
|---|---|
| `DockerConnectionException`（`E_DOCKER_CONNECTION`） | 组件创建时：守护进程无法访问或没有应答，TLS 握手失败，或者没有安装 `ssh2` 却使用 SSH |
| `DockerContainerNotFoundException`（`E_DOCKER_CONTAINER_NOT_FOUND`） | `getContainer()` 找不到这个 ID、短 ID 或名称的容器；对已删除的容器执行操作 |
| `DockerImageNotFoundException`（`E_DOCKER_IMAGE_NOT_FOUND`） | `getImage()` 找不到这个 ID 或名称的镜像；`createContainer()`（或 `update()` 重建容器时）使用的镜像不存在；对已删除的镜像执行操作 |
| `DockerImagePullException`（`E_DOCKER_IMAGE_PULL`） | `pullImage()` 失败，或者组件在拉取过程中被销毁 |
| `DockerImageBuildException`（`E_DOCKER_IMAGE_BUILD`） | `buildImage()` 失败：某个步骤失败、缺少文件、基础镜像无法拉取，或者组件在构建过程中被销毁 |
| `DockerImageImportException`（`E_DOCKER_IMAGE_IMPORT`） | `importImage()`：守护进程拒绝归档文件，或者加载完成后找不到加载出的镜像 |
| `DockerImagePushException`（`E_DOCKER_IMAGE_PUSH`） | `push()`：镜像仓库拒绝推送 |
| `DockerImageRepoTagNotFoundException`（`E_DOCKER_IMAGE_REPO_TAG_NOT_FOUND`） | `export()` 指定了镜像没有的标签，并且 `createRepoTagIfNotExists: false` |
| `DockerNetworkNotFoundException`（`E_DOCKER_NETWORK_NOT_FOUND`） | `getNetwork()` 或 `removeNetwork()` 给出的 ID、短 ID 或名称没有匹配的网络；创建或重建容器时指定的网络不存在 |
| `DockerRequestException`（`E_DOCKER_REQUEST`） | 守护进程拒绝了请求，而上面的异常都不适用：它的 `statusCode` 是 HTTP 状态码（名称已被占用或容器没有运行时为 409，`loginRepository()` 的凭据被拒绝时为 401，设置不合法时为 400，守护进程自身出错时为 500），消息来自守护进程 |
| `InvalidMethodAcceptException`（来自 `lakutata`） | 调用的选项不合法 |
| Node.js 的错误 | 组件创建之后守护进程无法访问（`ECONNREFUSED`……）；`importImage()` 的 `source` 文件无法读取（`ENOENT`……） |

组件被销毁时（应用停止时），正在进行的拉取和构建会被中止，并以各自的异常失败；正在进行的列表查询返回空列表。

## 另见

- `lakutata` 包中的 `doc/zh/DockerIntegration.md`：Docker 集成指南。
- `@lakutata/containerd`（`lakutata/com/containerd`）：同样的 API，基于 containerd，不需要 Docker 守护进程。
- `@lakutata/core`（`lakutata`）：组件、`Application` 和依赖注入。
- `npm run test:docker`（在本包中运行）用本机的 Docker 测试这个组件。
