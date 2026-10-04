# Lakutata Docker 集成

**Docker 组件**（`lakutata/com/docker`，`@lakutata/docker` 包）通过 Docker Engine API 操作 Docker 守护进程，不需要 Docker CLI：拉取、构建（使用 BuildKit）、导入、导出、打标签和推送镜像，创建、运行和管理容器（exec、交互式 TTY、日志、统计、commit、导出文件），以及管理网络。它可以连接本地套接字，也可以通过 HTTP、HTTPS 或 SSH 连接远程守护进程。全部选项见 `@lakutata/docker` 的 README 和 `lakutata/com/docker` 的类型声明。

该组件不是预置组件：需要在应用的 `components` 中声明。只运行 containerd、没有 Docker 的机器（嵌入式 Linux 设备）请参阅 [ContainerdIntegration](ContainerdIntegration.md)。

## 1. 环境要求与连接

组件需要应用能访问到的 Docker 守护进程（Docker Engine 或 Docker Desktop，Engine API 1.41 或更高版本）。SSH 连接需要可选的 peer 依赖 `ssh2`（`npm install ssh2`），以及远程主机上的 Docker CLI。

| 连接方式 | 选项 |
|---|---|
| 环境中的 Docker（默认） | 无：读取 `DOCKER_HOST`、`DOCKER_TLS_VERIFY`、`DOCKER_CERT_PATH`、`DOCKER_CLIENT_TIMEOUT`，否则使用本地套接字 |
| Unix 套接字 / Windows 命名管道 | `socketPath`（`BuildDockerSocketConnectionOptions`） |
| TCP，HTTP | `host`、`port`（`BuildDockerHttpConnectionOptions`） |
| TCP，HTTPS | `host`、`port`，以及 PEM 内容形式的 `ca`、`cert`、`key`（`BuildDockerHttpsConnectionOptions`） |
| SSH | `host`、`port`、`username`、`sshAuthAgent`（`BuildDockerSSHConnectionOptions`） |

组件创建时会 ping 守护进程并协商 API 版本：守护进程不可达时启动失败，抛出 `DockerConnectionException`。`timeout`（毫秒）是请求允许空闲的时间。

```typescript
import {readFileSync} from 'node:fs'
import {Application} from 'lakutata'
import {BuildDockerHttpsConnectionOptions, BuildDockerSocketConnectionOptions, Docker} from 'lakutata/com/docker'

Application.run(() => ({
    id: 'docker.app',
    name: 'Docker',
    components: {
        //环境中的 Docker：DOCKER_HOST，否则为本地套接字
        docker: {class: Docker},
        //套接字，请求超时 60 秒
        local: BuildDockerSocketConnectionOptions({socketPath: '/var/run/docker.sock', timeout: 60000}),
        //TLS：传入 PEM 内容，而不是文件路径
        remote: BuildDockerHttpsConnectionOptions({
            host: 'docker.example.com',
            port: 2376,
            ca: readFileSync('/etc/docker/certs/ca.pem'),
            cert: readFileSync('/etc/docker/certs/cert.pem'),
            key: readFileSync('/etc/docker/certs/key.pem')
        })
    },
    bootstrap: ['docker']
}))
```

## 2. 第一个示例

```typescript
import {Application} from 'lakutata'
import {Docker, type DockerContainer, type DockerImage} from 'lakutata/com/docker'

Application
    .run(() => ({
        id: 'docker.app',
        name: 'Docker',
        components: {
            docker: {class: Docker}
        }
    }))
    .onLaunched(async (app: Application): Promise<void> => {
        const docker: Docker = await app.getObject<Docker>('docker')

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

## 3. 镜像

```typescript
import {createReadStream} from 'node:fs'
import {type Docker, type DockerImage} from 'lakutata/com/docker'

async function images(docker: Docker): Promise<void> {
    //拉取，附带镜像仓库的凭据和进度消息
    await docker.pullImage({
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
    console.log(loaded.repoTags)

    //按 ID、短 ID 或名称查找，列出，删除（默认强制），清理
    console.log((await docker.getImage('app:1.0.0')).id)
    console.log((await docker.listImages()).map((image: DockerImage): string[] => image.repoTags))
    await app.remove()
    await docker.prune({containers: false, images: true, networks: false, volumes: false})
}
```

- `getImage()` 按守护进程的规则解析名称：完整或短 ID、`alpine`（即 `alpine:latest`）、摘要。
- 不带选项的 `prune()` 清理已停止的容器和悬空镜像；未使用的网络和匿名卷只在指定时清理（`networks: true`、`volumes: true`）。

## 4. 容器

```typescript
import {type Docker, type DockerContainer, type DockerContainerTTY, type DockerImage} from 'lakutata/com/docker'

async function containers(docker: Docker): Promise<void> {
    const image: DockerImage = await docker.getImage('nginx:1.27')
    //创建，但不启动
    const web: DockerContainer = await docker.createContainer(image.id, {
        name: 'web',
        ports: [{port: 80, type: 'tcp', hostPorts: [8080]}],
        binds: [{hostPath: '/srv/www', containerPath: '/usr/share/nginx/html', rw: false}],
        networks: [{networkName: 'backend', ip: '172.30.0.10'}],
        memoryLimit: 256 * 1024 * 1024,
        restartPolicy: 'unless-stopped'
    })
    await web.start()

    //目前为止的日志（follow: true 时在容器运行期间保持流打开）
    const logs: NodeJS.ReadableStream = await web.logs({follow: false, tail: 100})
    logs.pipe(process.stdout)

    //一次 CPU、内存、网络和块 I/O 的采样
    console.log(await web.stats())

    //命令行（由 /bin/sh -c 执行）：无论退出码是多少，都返回退出码、stdout 和 stderr
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

    //内存限制和重启策略在线修改；其他设置通过重建容器修改（其 ID 会变化）
    await web.update({memoryLimit: 512 * 1024 * 1024, restartPolicy: 'on-failure:3'})

    await web.restart({timeout: 5})
    await web.stop()
    await web.remove({force: true})

    //所有容器，包括已停止的
    console.log((await docker.listContainers()).map((container: DockerContainer): string => `${container.name}: ${container.state.status}`))
}
```

- `DockerContainer` 是一个快照：它自己的操作会刷新它；其他地方做的修改需要重新获取才能看到（`docker.getContainer(id)`，也接受名称或短 ID）。
- 启动正在运行的容器或停止已停止的容器不做任何事，与 Docker CLI 一致。
- `exec()` 在没有 TTY 和 stdin 的情况下运行。数组形式的命令原样执行；字符串是命令行，由 `/bin/sh -c` 执行。
- `kill()` 默认发送 `SIGKILL`，也可以指定信号。
- `commit()` 用容器生成镜像，`exportDirectory()` 把容器中的目录写成 tar 归档。
- 不提供的功能：附加到主进程、向容器中复制文件、卷（`prune()` 除外）以及守护进程的事件。

## 5. 网络

```typescript
import {type Docker, type NetworkInfo} from 'lakutata/com/docker'

async function networks(docker: Docker): Promise<void> {
    const network: NetworkInfo = await docker.createNetwork({
        name: 'backend',
        driver: 'bridge',
        NetworkIPAMConfigs: [{subnet: '172.30.0.0/16', gateway: '172.30.0.1'}],
        internal: false
    })
    //由守护进程选择子网
    await docker.createNetwork({name: 'frontend'})
    console.log(network.id, (await docker.listNetworks()).map((item: NetworkInfo): string => item.name))
    await docker.removeNetwork('frontend')
}
```

## 6. 错误

组件的异常由 `lakutata/com/docker` 导出：`DockerConnectionException`（组件创建时守护进程不可达）、`DockerContainerNotFoundException`、`DockerImageNotFoundException`、`DockerNetworkNotFoundException`、`DockerImagePullException`、`DockerImageBuildException`、`DockerImageImportException`、`DockerImagePushException`、`DockerImageRepoTagNotFoundException`，以及 `DockerRequestException`（守护进程拒绝请求；其 `statusCode` 为 HTTP 状态码，名称已被占用时为 409）。选项不合法时抛出 `InvalidMethodAcceptException`。组件被销毁时，正在进行的拉取和构建会被中止。
