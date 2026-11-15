# Lakutata 安装包

`lakutata package installer` 制作应用的安装包，即系统的软件包（deb、rpm、apk、pkg、msi 等）。这些软件包安装应用的可执行文件，将程序加入 PATH，还可以将应用注册为随系统启动的服务。安装包在应用的 `package.json` 中配置；与其他打包命令一样，项目需要安装 `@lakutata/builder`（见[打包](Packaging.md)）。

## 1. 制作安装包

```bash
npm run build
npx lakutata package installer                  # 配置中的安装包，输出到 dist/installer/
npx lakutata package installer --target pkg     # 只制作其中几种
```

```
› Node.js v24.11.1 embedded
› Resources: texts
✔ dist/installer/greet-1.0.0-arm64.pkg (pkg, 36.0 MB)
```

安装包中是目录布局的可执行文件（`lakutata package exe --layout directory`）：程序本身及其原生插件（`native/`）和资源（`resources/`）。程序使用 Node.js 制作；`lakutata.installer.runtime` 为 `"bun"` 时使用 Bun 制作。在低于 20.12 的 Node.js 上，与制作可执行文件时一样，请用 `--node-program` 指定一个更新的 Node.js。

| 平台 | 安装包（默认） | 文件名 | 制作工具 |
|---|---|---|---|
| Linux（glibc） | `deb`、`rpm`、`tar.gz`（还支持 `archlinux`） | `<name>_<version>_amd64.deb`、`<name>-<version>-1.x86_64.rpm`、`<name>-<version>-linux-amd64.tar.gz` | nFPM |
| Linux（musl、Alpine） | `apk`、`tar.gz` | `<name>-<version>-r0.x86_64.apk` | nFPM |
| macOS | `pkg`、`tar.gz` | `<name>-<version>-arm64.pkg`、`<name>-<version>-darwin-arm64.tar.gz` | `pkgbuild`、`productbuild` |
| Windows | `nsis`、`msi`、`zip` | `<name>-<version>-x64-setup.exe`、`<name>-<version>-x64.msi`、`<name>-<version>-win-x64.zip` | NSIS、WiX、WinSW |

- **在各自的平台上制作**：某个平台的安装包需要在该平台上制作，并针对本机的架构（其他平台和架构见第 7 节）；`pkg` 软件包也只能安装在同一架构的 Mac 上。可执行文件使用制作时所在系统的 C 库，因此面向 glibc 系统的 Linux 软件包需要在 glibc 系统上制作，`apk` 软件包需要在 Alpine 上制作。
- **制作工具** nFPM、NSIS、WiX 和 WinSW 只下载一次，保存在本工具的缓存中（`LAKUTATA_CACHE_DIR`）。`LAKUTATA_NFPM`、`LAKUTATA_NSIS`、`LAKUTATA_WIX` 和 `LAKUTATA_WINSW` 可以指定这些制作工具的其他副本，适用于没有网络的机器，或者 x64 和 arm64 以外的 Linux 架构（nFPM 仅发布了这两种架构的版本）。在 macOS 上无需下载任何工具。
- **安装包的版本**即为应用 `package.json` 中的 `version`。

## 2. 配置

安装包由应用 `package.json` 中的 `lakutata.installer` 配置。以下是启用 `installer` 可选功能（`lakutata create --with installer`）的 `service` 模板中的配置：

```json
{
  "bin": {"shop": "build/App.js"},
  "scripts": {"package": "lakutata package installer"},
  "lakutata": {
    "icon": "../resources/logo.png",
    "installer": {
      "name": "shop",
      "service": {"env": {"PORT": "8080"}},
      "linux": {"targets": ["deb", "rpm", "tar.gz"]}
    }
  }
}
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `name` | 程序名（第一个 `bin`，没有时为去掉作用域的包名）的小写形式 | 软件包、安装目录和文件的名称：小写字母、数字、`+`、`-` 和 `.` |
| `appId` | `name` | 应用的标识（`com.acme.shop`）：在 macOS 上是软件包的标识和服务的标签；在 Windows 上是卸载程序和升级所用的键 |
| `productName` | `package.json` 的 `productName`，没有时为 `name` | 显示给用户的名称（在安装程序中，以及 Windows 的程序列表中） |
| `description`、`homepage`、`license` | 取自 `package.json` | 软件包的信息 |
| `maintainer` | `package.json` 的 `author` | 维护者（`Name <email>`）；未设置时工具会发出警告 |
| `vendor` | 无 | 供应商；在 Windows 上，发布者为供应商，未设置供应商时为维护者 |
| `runtime` | `node` | 可执行文件使用 `node` 或 `bun`；Electron 应用使用 `electron`（第 8 节），NW.js 应用使用 `nwjs`（第 9 节） |
| `addToPath` | `true` | 将程序加入 PATH：Linux 上是 `/usr/bin/<program>`，macOS 上是 `/usr/local/bin/<program>`，Windows 上是机器的 PATH |
| `service` | 无 | `true`，或服务的选项（第 4 节） |
| `linux.targets` | `deb`、`rpm`、`tar.gz`；Alpine 上是 `apk`、`tar.gz` | Linux 的安装包（`deb`、`rpm`、`archlinux`、`tar.gz`；Alpine 上是 `apk`、`tar.gz`） |
| `linux.depends`、`linux.recommends` | 无 | 依赖和推荐的系统软件包（始终会加入 C++ 运行库） |
| `linux.section`、`linux.priority` | 无 | 分类和优先级（deb） |
| `mac.targets` | `pkg`、`tar.gz` | macOS 的安装包（NW.js 应用还可以使用 `dmg`） |
| `win.targets` | `nsis`、`msi`、`zip` | Windows 的安装包 |
| `linux.scripts`、`mac.scripts`、`win.scripts` 等 | 无 | 安装包执行的脚本（第 5 节） |
| `electron` | 无 | electron-builder 的配置（第 8 节） |

`lakutata.icon`（与 `lakutata.installer` 并列）是一张 256 像素或更大的正方形 PNG 图片，用作 Windows 可执行文件和安装程序的图标，以及 Electron 和 NW.js 应用的图标。

配置在构建任何内容之前即会检查，不制作的安装包的选项也在检查之列；出错时，错误信息会指出相应的字段：

```
error: The name of the package "Bad Name" must be lower case letters, digits, "+", "-" and "." (lakutata.installer.name)
error: The installer msi is not one of macOS (pkg, tar.gz)
error: The script lakutata.installer.mac.scripts.postinstall (scripts/missing.sh) does not exist
```

## 3. 安装位置

| | Linux | macOS | Windows |
|---|---|---|---|
| 应用 | `/opt/<name>` | `/usr/local/lib/<name>` | `C:\Program Files\<name>` |
| PATH 中的程序 | `/usr/bin/<program>` | `/usr/local/bin/<program>` | 机器的 PATH |
| 服务 | `/usr/lib/systemd/system/<service>.service`；`/etc/init.d/<service>`（OpenRC，Alpine） | `/Library/LaunchDaemons/<appId>.plist` | 一个 Windows 服务：程序旁边的 `<name>-service.exe`（WinSW） |
| 服务的环境变量 | `/etc/<name>/<name>.env` | `/usr/local/etc/<name>/<name>.env` | `C:\ProgramData\<name>\<name>.env` |
| 工作目录（数据） | `/var/lib/<name>` | `/usr/local/var/lib/<name>` | `C:\ProgramData\<name>` |
| 日志 | systemd 的日志（`journalctl -u <service>`）；OpenRC 下为 `/var/log/<name>.log` | `/usr/local/var/log/<name>.log` | `C:\ProgramData\<name>\logs` |
| 卸载 | 通过包管理器 | `sudo /usr/local/lib/<name>/uninstall` | 与其他 Windows 程序相同 |

- **macOS 不会卸载软件包**：随应用安装的 `uninstall` 脚本负责删除应用及其服务，以及 PATH 中的链接。
- **卸载时保留**数据、环境变量文件和服务的用户，以便重新安装后继续使用。
- 压缩包（`tar.gz`、`zip`）中只包含应用本身，既不注册服务，也不执行脚本。

## 4. 服务

设置了 `service`（`true`，或服务的选项）时，应用会随系统启动。应用由 systemd、Alpine 上的 OpenRC 或 macOS 上的 launchd 运行，或者作为 Windows 服务（WinSW）运行。安装时会启用并启动服务，升级时会重启服务，卸载时会先停止并禁用服务。

```json
{
  "lakutata": {
    "installer": {
      "service": {
        "args": ["serve"],
        "env": {"PORT": "8080", "LOG_LEVEL": "info"},
        "restart": "on-failure"
      }
    }
  }
}
```

| 选项 | 默认值 | 含义 |
|---|---|---|
| `name` | `name` | 服务的名称（systemd、OpenRC、Windows）；在 macOS 上，服务以 `appId` 命名 |
| `description` | 软件包的描述 | |
| `args` | 无 | 程序的参数 |
| `env` | `MODE=production` | 服务的环境变量，加在 `MODE=production` 之上 |
| `user` | 安装时创建的系统用户：Linux 上为 `<name>`，macOS 上为 `_<name>`（隐藏）；Windows 上为虚拟账户 `NT SERVICE\<service>` | 运行服务的用户；也可以是 `root`（Linux、macOS），或 Windows 上的 `LocalService`、`NetworkService`、`LocalSystem` |
| `restart` | `on-failure` | 失败时重启（`on-failure`）、每次结束时都重启（`always`），或者从不重启（`no`）；在 Windows 上和 OpenRC 下，`on-failure` 和 `always` 的效果相同 |
| `autoStart` | `true` | 安装时启用并启动服务；为 `false` 时由管理员启用并启动服务（`sudo systemctl enable --now <service>`；在 macOS 上先执行 `sudo launchctl enable system/<appId>`，再执行 `sudo launchctl bootstrap system /Library/LaunchDaemons/<appId>.plist`） |

- **环境变量文件**保存 `env`。管理员可以修改该文件，升级和卸载都会保留这些修改。服务在启动时读取该文件，因此修改后请重启服务（`sudo systemctl restart <service>`、`sudo rc-service <service> restart`、`sudo launchctl kickstart -k system/<appId>`、`Restart-Service <service>`）。
- **工作目录**属于服务的用户。应用的数据写入该目录，使用相对路径或 `process.cwd()` 即可。
- **停止**服务时，应用会优雅退出：应用收到 `SIGTERM`，在 Windows 上则收到 Ctrl+C，Node.js 将其作为 `SIGINT` 处理。systemd、launchd 和 WinSW 会给应用 30 秒的退出时间。

## 5. 安装脚本

安装包可以执行应用的脚本（项目中的文件），用于创建数据库、迁移数据或执行清理。脚本可以针对一个平台（该平台的所有安装包都会执行），可以针对某一种安装包（替换该平台在同一时机执行的脚本），可以作为 Linux 软件包的原生脚本，也可以是一个 NSIS 文件：

```json
{
  "lakutata": {
    "installer": {
      "linux": {
        "scripts": {"postinstall": "scripts/linux/postinstall.sh", "preremove": "scripts/linux/preremove.sh"},
        "rpm": {"scripts": {"postinstall": "scripts/linux/rpm-postinstall.sh"}},
        "deb": {"nativeScripts": {"postinstall": "scripts/linux/postinst.sh"}}
      },
      "mac": {"scripts": {"postinstall": "scripts/mac/postinstall.sh"}},
      "win": {"scripts": {"postinstall": "scripts/win/postinstall.ps1"}, "nsis": {"include": "scripts/win/installer.nsh"}}
    }
  }
}
```

| 脚本 | 执行时机 |
|---|---|
| `preinstall` | 安装应用的文件之前 |
| `postinstall` | 文件安装之后、服务启动之前 |
| `preremove` | 卸载之前，此时服务已停止 |
| `postremove` | 文件删除之后 |

```sh
#!/bin/sh
# scripts/linux/postinstall.sh：$1 为 install 或 upgrade
if [ "$1" = install ]; then
    echo "Installed in $LAKUTATA_INSTALL_DIR"
fi
```

- **参数**（`$1`，PowerShell 中为 `$args[0]`）表明安装包正在执行的操作：`preinstall` 和 `postinstall` 收到 `install` 或 `upgrade`，`preremove` 和 `postremove` 收到 `remove`（升级时不执行卸载脚本）。各个包管理器（dpkg、rpm、apk、pacman）表示升级的方式各不相同，安装包会将这些方式统一转换为上述参数。
- **`LAKUTATA_INSTALL_DIR`** 是应用所在的目录。
- **以 root 身份执行**；在 Windows 上，NSIS 以管理员身份执行，Windows Installer 以系统账户身份执行。脚本失败时，安装（或卸载）也会失败。
- **Linux 和 macOS**：脚本由第一行指定的解释器执行（`#!/bin/bash`），默认为 `/bin/sh`。`linux.<package>.nativeScripts` 作为软件包自身的脚本执行，并接收包管理器的参数（apk 和 archlinux 另有 `preupgrade`、`postupgrade`）。在 macOS 上，卸载脚本由 `uninstall` 执行。
- **Windows**：脚本是 PowerShell 文件（`.ps1`），由 Windows PowerShell 执行。Windows Installer 通过命令行传入每个脚本，因此每个脚本的大小限制在约 23 KB 以内。`win.nsis.include` 是一个 NSIS 文件（`.nsh`），可以定义以下宏：`customHeader`、`customInit`、`customInstall`（在安装的最后）、`customUnInit` 和 `customUnInstall`（在卸载的开始）。
- **压缩包**不执行任何脚本。某个脚本在待制作的某种安装包中不会被执行时，工具会发出警告（`! Some scripts of the application are not run by their installers: tar.gz (postinstall)`）。

## 6. 签名

- **macOS**：`pkg` 安装包和 `dmg` 磁盘映像未签名，其安装的程序或应用也仅有临时签名（ad hoc）。在组织以外的机器上分发所需的 Developer ID 签名和公证，目前尚未提供。
- **Windows**：NSIS 和 MSI 安装包未签名，分发前请用 signtool 签名。用 Node.js 制作的程序保留了 `node.exe` 的签名，而该签名已不再匹配，工具会对此发出警告。
- **Linux**：软件包未签名。

## 7. 其他平台

其他平台的安装包需要在相应平台上制作，可以在 CI 中为每个平台准备一台机器，Linux 也可以使用对应架构的容器。启用 `installer` 可选功能的模板提供了以下两个脚本：

```json
{
  "scripts": {
    "package:host": "npm run build && npm run package -w app -- --outdir ../../dist/installer",
    "package:linux": "docker buildx build --file Dockerfile.installer --output type=local,dest=dist/installer ."
  }
}
```

`npm run package:linux` 在容器中制作 Linux 软件包（在 macOS 和 Windows 上同样适用），并将其复制到 `dist/installer`；`docker buildx build --platform linux/arm64 ...` 制作其他架构的软件包。该脚本所用的 `Dockerfile.installer` 如下：

```dockerfile
FROM node:22-bookworm AS build
WORKDIR /project
COPY . .
RUN (npm ci --no-audit --no-fund || npm install --no-audit --no-fund) && npm run build && npm run package -w app -- --outdir /installer

FROM scratch
COPY --from=build /installer /
```

`apk` 软件包以同样的方法在 `node:22-alpine` 上制作；应用含有原生插件时，使用 Bun 制作（Node.js 的可执行文件在 musl 上无法加载原生插件）。其余的安装包由 CI 的矩阵制作，例如使用 GitHub Actions：

```yaml
jobs:
  installers:
    strategy:
      matrix:
        os: [ubuntu-latest, ubuntu-24.04-arm, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run package:host
      - uses: actions/upload-artifact@v4
        with:
          name: installers-${{ runner.os }}-${{ runner.arch }}
          path: dist/installer/
```

## 8. Electron 应用

设置 `"runtime": "electron"` 后，安装包由 electron-builder 制作，项目需要安装 electron-builder 和 `electron`。主进程会被打包（不含 Electron 本身），主进程的原生插件和资源（`lakutata.resources`：渲染进程和预加载脚本，通过 `resourcesPath()` 读取）放入 Electron 的资源目录。`electron-react` 和 `electron-vue` 模板即采用这种配置。

- **安装包**是 electron-builder 的目标：默认在 Linux 上为 `deb`，在 macOS 上为 `dmg`，在 Windows 上为 `nsis`（`linux.targets`、`mac.targets`、`win.targets`）。文件名取去掉作用域的包名。
- **`electron`** 会合并到 electron-builder 的配置中：图标、文件关联、签名、更新等。`name`、`appId`、`productName`、描述、维护者、主页和许可证也会传给 electron-builder。
- **Electron 应用不是服务**：该应用在用户的会话中运行，设置 `service` 会被拒绝。
- **脚本**在 `deb` 和 `rpm` 软件包（全部四种）、`pkg`（`preinstall`、`postinstall`）和 `nsis` 安装程序（`preinstall`、`postinstall`、`preremove`）中执行；其他目标均不执行脚本。
- **原生插件**按安装时的原样复制，electron-builder 不会重新构建这些插件。基于 Node-API 的插件可以直接运行；对于其他插件，请在打包前安装其为 Electron 构建的版本（`electron-rebuild`；见[原生插件](NativeAddons.md)第 4 节）。
- 在 Linux arm64 上，deb 和 rpm 软件包需要系统中的 fpm（`gem install fpm`、`USE_SYSTEM_FPM=true`），Electron 模板的 `Dockerfile.installer` 即以这种方式安装 fpm。

## 9. NW.js 应用

使用 `"runtime": "nwjs"` 时，安装包中是由构建器制作的 NW.js 应用。构建器取应用所用 NW.js 版本（应用的 `lakutata.nwjs`，由 `lakutata nwjs use` 设置）的 normal 版本，只下载一次到 Lakutata 的缓存目录，并按该版本发布的校验和核对；然后将应用放入其中，包括为该 NW.js 的 Node.js 打包的代码、原生插件、资源（`lakutata.resources`，通过 `resourcesPath()` 读取）和 NW.js 的清单。`nwjs-react` 和 `nwjs-vue` 模板即采用这种配置。

- **运行时**以应用的名称命名：Windows 上为 `<name>.exe`，其图标和版本信息均取自应用；Linux 上为 `<name>`；macOS 上为 `<productName>.app`，其 `Info.plist` 给出应用的名称、标识（`appId`）、版本和图标，该应用也会重新进行临时签名。
- **安装包**为桌面应用的安装包：默认在 macOS 上为 `dmg`，在 Windows 上为 `nsis`，在 Linux 上为 `deb`；macOS 上还可以使用 `pkg` 和 `tar.gz`，Windows 上可以使用 `msi` 和 `zip`，Linux 上可以使用 `rpm` 和 `tar.gz`。Windows 的安装程序将应用添加到开始菜单和桌面。`dmg` 磁盘映像中包含应用和一个指向 /Applications 的链接，用户将应用拖到 /Applications 即可；`pkg` 安装包则直接将应用安装到 /Applications（Intel 版的应用也可以安装到 Apple 芯片的 Mac 上）。Linux 的软件包会添加应用的桌面入口和图标，并依赖 Chromium 所需的库。
- **架构**默认为本机的架构，也可以通过 `--arch` 指定（`x64`、`ia32`、`arm64`）。`ia32` 制作 32 位 Windows 的安装包，应用安装在 32 位程序的目录中。对于没有 Apple 芯片 Mac 构建的 NW.js 版本（例如 0.72），应用会打包为 Intel 版。
- **NW.js 应用不是服务**，也不会加入 PATH（`addToPath` 默认为 `false`）。
- **脚本**的执行方式与其他应用相同，但 macOS 上的应用通过直接删除来卸载，因此在 macOS 上不会执行卸载脚本。
- **原生插件**会经过处理，以便在 NW.js 中加载：架构与 NW.js 不同的插件会针对 NW.js 的架构重新构建，使用 V8 API 的插件则使用 NW.js 的头文件重新构建；在 Windows 上，插件加载的是 NW.js 的 Node.js（见[原生插件](NativeAddons.md)第 4 节）。
