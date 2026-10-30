# Lakutata Installers

`lakutata package installer` makes the installers of an application: the packages of the system (deb, rpm, apk, pkg,
msi…) that install its executable, put its program in the PATH, and can register it as a service that starts with the
system. They are configured in the `package.json` of the application, and need `@lakutata/builder` in the project, as do
the other packing commands ([Packaging](Packaging.md)).

## 1. Making installers

```bash
npm run build
npx lakutata package installer                  # the installers of the configuration, in dist/installer/
npx lakutata package installer --target pkg     # only some of them
```

```
› Node.js v24.11.1 embedded
› Resources: texts
✔ dist/installer/greet-1.0.0-arm64.pkg (pkg, 36.0 MB)
```

An installer holds the executable of the directory layout (`lakutata package exe --layout directory`): the program,
its native addons (`native/`) and its resources (`resources/`). The program is made with Node.js, or with Bun when
`lakutata.installer.runtime` is `"bun"`. On a Node.js older than 20.12, give a newer one with `--node-program`, as for
the executables.

| Platform | Installers (default) | Their files | Made with |
|---|---|---|---|
| Linux (glibc) | `deb`, `rpm`, `tar.gz` (also `archlinux`) | `<name>_<version>_amd64.deb`, `<name>-<version>-1.x86_64.rpm`, `<name>-<version>-linux-amd64.tar.gz` | nFPM |
| Linux (musl, Alpine) | `apk`, `tar.gz` | `<name>-<version>-r0.x86_64.apk` | nFPM |
| macOS | `pkg`, `tar.gz` | `<name>-<version>-arm64.pkg`, `<name>-<version>-darwin-arm64.tar.gz` | `pkgbuild`, `productbuild` |
| Windows | `nsis`, `msi`, `zip` | `<name>-<version>-x64-setup.exe`, `<name>-<version>-x64.msi`, `<name>-<version>-win-x64.zip` | NSIS, WiX, WinSW |

- **On each platform**: the installers of a platform are made on that platform, for the architecture of the machine
  (section 7 covers the other platforms and architectures); a `pkg` package installs on the Macs of that architecture
  only. The executables use the C library of the system they are made on, so make the Linux packages for glibc systems
  on a glibc system, and the `apk` packages on Alpine.
- **The tools** nFPM, NSIS, WiX and WinSW are downloaded once into the cache of the tool (`LAKUTATA_CACHE_DIR`).
  `LAKUTATA_NFPM`, `LAKUTATA_NSIS`, `LAKUTATA_WIX` and `LAKUTATA_WINSW` name other copies, for machines without a
  network, or for Linux architectures other than x64 and arm64 (nFPM has releases for these two only). macOS needs no
  download.
- **The version** of the installers is the `version` of the `package.json` of the application.

## 2. The configuration

The installers are configured by `lakutata.installer` in the `package.json` of the application. The one of the
`service` template, with its `installer` feature (`lakutata create --with installer`):

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

| Field | Default | Meaning |
|---|---|---|
| `name` | The name of the program (the first `bin`, else the name of the package without its scope), in lower case | The name of the package, of its directory and of its files: lower case letters, digits, `+`, `-` and `.` |
| `appId` | `name` | The identifier of the application (`com.acme.shop`): on macOS, the identifier of the package and the label of the service; on Windows, the key of its uninstaller and of its upgrades |
| `productName` | The `productName` of the `package.json`, else `name` | The name shown to users (in the installers, and in the programs of Windows) |
| `description`, `homepage`, `license` | Those of the `package.json` | The information of the packages |
| `maintainer` | The `author` of the `package.json` | Its maintainer (`Name <email>`); without one, the tool warns |
| `vendor` | None | Its vendor; on Windows, the publisher is the vendor, else the maintainer |
| `runtime` | `node` | `node` or `bun` for the executable; `electron` for an Electron application (section 8) |
| `addToPath` | `true` | Put the program in the PATH: `/usr/bin/<program>` on Linux, `/usr/local/bin/<program>` on macOS, the PATH of the machine on Windows |
| `service` | None | `true`, or the options of the service (section 4) |
| `linux.targets` | `deb`, `rpm`, `tar.gz`; on Alpine `apk`, `tar.gz` | The Linux installers (`deb`, `rpm`, `archlinux`, `tar.gz`; `apk`, `tar.gz` on Alpine) |
| `linux.depends`, `linux.recommends` | None | The system packages it needs and recommends (the C++ runtime library is always added) |
| `linux.section`, `linux.priority` | None | Its section and its priority (deb) |
| `mac.targets` | `pkg`, `tar.gz` | The macOS installers |
| `win.targets` | `nsis`, `msi`, `zip` | The Windows installers |
| `linux.scripts`, `mac.scripts`, `win.scripts`… | None | The scripts of the installers (section 5) |
| `electron` | None | The configuration of electron-builder (section 8) |

`lakutata.icon` (beside `lakutata.installer`) is a square PNG image of 256 pixels or more: the icon of the Windows
executable and installers, and of the Electron applications.

The configuration is checked before anything is built, the options of the installers that are not made included, and an
error names the field:

```
error: The name of the package "Bad Name" must be lower case letters, digits, "+", "-" and "." (lakutata.installer.name)
error: The installer msi is not one of macOS (pkg, tar.gz)
error: The script lakutata.installer.mac.scripts.postinstall (scripts/missing.sh) does not exist
```

## 3. What is installed where

| | Linux | macOS | Windows |
|---|---|---|---|
| The application | `/opt/<name>` | `/usr/local/lib/<name>` | `C:\Program Files\<name>` |
| Its program in the PATH | `/usr/bin/<program>` | `/usr/local/bin/<program>` | the PATH of the machine |
| Its service | `/usr/lib/systemd/system/<service>.service`; `/etc/init.d/<service>` (OpenRC, Alpine) | `/Library/LaunchDaemons/<appId>.plist` | a Windows service: `<name>-service.exe` (WinSW) next to the program |
| The environment of the service | `/etc/<name>/<name>.env` | `/usr/local/etc/<name>/<name>.env` | `C:\ProgramData\<name>\<name>.env` |
| Its working directory (its data) | `/var/lib/<name>` | `/usr/local/var/lib/<name>` | `C:\ProgramData\<name>` |
| Its logs | the journal of systemd (`journalctl -u <service>`); `/var/log/<name>.log` with OpenRC | `/usr/local/var/log/<name>.log` | `C:\ProgramData\<name>\logs` |
| Removal | by the package manager | `sudo /usr/local/lib/<name>/uninstall` | like other Windows programs |

- **macOS does not remove packages**: the `uninstall` script installed with the application removes it, its service and
  its link in the PATH.
- **The removal keeps** the data, the environment file and the user of the service, so that a new installation finds
  them again.
- The archives (`tar.gz`, `zip`) only hold the application: they register no service and run no script.

## 4. The service

With `service` (`true`, or its options), the application runs when the system starts: under systemd, OpenRC on Alpine,
launchd on macOS, or as a Windows service (WinSW). The installation enables and starts it, an upgrade restarts it, and
the removal stops and disables it first.

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

| Option | Default | Meaning |
|---|---|---|
| `name` | `name` | The name of the service (systemd, OpenRC, Windows); on macOS the service is named by `appId` |
| `description` | The description of the package | |
| `args` | None | The arguments of the program |
| `env` | `MODE=production` | Its environment, added to `MODE=production` |
| `user` | A system user created by the installation: `<name>` on Linux, `_<name>` (hidden) on macOS; on Windows the virtual account `NT SERVICE\<service>` | The user it runs as; `root` (Linux, macOS), or `LocalService`, `NetworkService`, `LocalSystem` on Windows |
| `restart` | `on-failure` | Restart it when it fails (`on-failure`), whenever it ends (`always`), or never (`no`); on Windows and with OpenRC, `on-failure` and `always` behave alike |
| `autoStart` | `true` | Enable and start it at the installation; otherwise the administrator enables and starts it (`sudo systemctl enable --now <service>`; on macOS, `sudo launchctl enable system/<appId>`, then `sudo launchctl bootstrap system /Library/LaunchDaemons/<appId>.plist`) |

- **The environment file** holds `env`. Administrators can change it, and upgrades and removals keep their changes. The
  service reads it when it starts, so restart the service after changing it (`sudo systemctl restart <service>`,
  `sudo rc-service <service> restart`, `sudo launchctl kickstart -k system/<appId>`, `Restart-Service <service>`).
- **The working directory** of the service belongs to its user: write the data of the application there, with
  relative paths or `process.cwd()`.
- **Stopping** the service ends the application gracefully: it receives `SIGTERM`, or on Windows a Ctrl+C, which Node.js
  receives as `SIGINT`. systemd, launchd and WinSW give it 30 seconds to end.

## 5. Installer scripts

The installers can run scripts of the application, files of the project: to create a database, migrate data, or
clean up. They are given for a platform (run by all its installers), for one installer (replacing the platform's
script of the same moment), as native scripts of a Linux package, or as an NSIS file:

```json
{
  "lakutata": {
    "installer": {
      "linux": {
        "scripts": {"postinstall": "build/linux/postinstall.sh", "preremove": "build/linux/preremove.sh"},
        "rpm": {"scripts": {"postinstall": "build/linux/rpm-postinstall.sh"}},
        "deb": {"nativeScripts": {"postinstall": "build/linux/postinst.sh"}}
      },
      "mac": {"scripts": {"postinstall": "build/mac/postinstall.sh"}},
      "win": {"scripts": {"postinstall": "build/win/postinstall.ps1"}, "nsis": {"include": "build/win/installer.nsh"}}
    }
  }
}
```

| Script | When it runs |
|---|---|
| `preinstall` | Before the files of the application are installed |
| `postinstall` | After they are installed, before the service starts |
| `preremove` | Before the removal, once the service is stopped |
| `postremove` | After the files are removed |

```sh
#!/bin/sh
# build/linux/postinstall.sh: $1 is install or upgrade
if [ "$1" = install ]; then
    echo "Installed in $LAKUTATA_INSTALL_DIR"
fi
```

- **Their argument** (`$1`, `$args[0]` in PowerShell) says what the installer does: `install` or `upgrade` for
  `preinstall` and `postinstall`, `remove` for `preremove` and `postremove` (an upgrade runs no removal script). Each
  package manager signals an upgrade in its own way (dpkg, rpm, apk, pacman): the installers translate it.
- **`LAKUTATA_INSTALL_DIR`** is the directory of the application.
- **They run as root**; on Windows, as an administrator with NSIS and as the system account with Windows Installer.
  When a script fails, the installation (or the removal) fails.
- **Linux and macOS**: the scripts run with the interpreter of their first line (`#!/bin/bash`), `/bin/sh` by default.
  `linux.<package>.nativeScripts` run as the scripts of the package itself, with the arguments of the package manager
  (and `preupgrade`, `postupgrade` for apk and archlinux). On macOS, the `uninstall` script runs the removal scripts.
- **Windows**: the scripts are PowerShell files (`.ps1`), run by Windows PowerShell. Windows Installer passes each one
  on a command line, which limits it to about 23 KB. `win.nsis.include` is an NSIS file (`.nsh`) that may define the
  macros `customHeader`, `customInit`, `customInstall` (at the end of the installation), `customUnInit` and
  `customUnInstall` (at the start of the removal).
- **The archives** run no script: the tool warns when a script would not run in one of the installers it makes
  (`! Some scripts of the application are not run by their installers: tar.gz (postinstall)`).

## 6. Signing

- **macOS**: the `pkg` installers are not signed, and the program they install is signed ad hoc only. The Developer ID
  signature and the notarization, which distribution outside the machines of the organization needs, are not made yet.
- **Windows**: the NSIS and MSI installers are not signed: sign them with signtool before distributing them. The program
  made with Node.js keeps the signature of `node.exe`, which no longer matches, and the tool warns of it.
- **Linux**: the packages are not signed.

## 7. Other platforms

The installers of the other platforms are made on them: a CI with a machine per platform, or, for Linux, a container
of the architecture. The templates with the `installer` feature have both scripts:

```json
{
  "scripts": {
    "package:host": "npm run build && npm run package -w app -- --outdir ../../dist/installer",
    "package:linux": "docker buildx build --file Dockerfile.installer --output type=local,dest=dist/installer ."
  }
}
```

`npm run package:linux` makes the Linux packages in a container (on macOS and Windows too) and copies them to
`dist/installer`; `docker buildx build --platform linux/arm64 ...` makes those of another architecture. Its
`Dockerfile.installer`:

```dockerfile
FROM node:22-bookworm AS build
WORKDIR /project
COPY . .
RUN (npm ci --no-audit --no-fund || npm install --no-audit --no-fund) && npm run build && npm run package -w app -- --outdir /installer

FROM scratch
COPY --from=build /installer /
```

The `apk` packages are made the same way on `node:22-alpine`, with Bun when the application has native addons (the
executables of Node.js do not load them on musl). A CI matrix makes the rest, for example with GitHub Actions:

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

## 8. Electron applications

With `"runtime": "electron"`, the installers are made by electron-builder, which the project installs with `electron`.
The main process is bundled (Electron left out), and its native addons and resources (`lakutata.resources`: the
renderer and the preload script, read through `resourcesPath()`) go into the resources of Electron. The `electron-react`
and `electron-vue` templates are configured this way.

- **The installers** are targets of electron-builder: `deb` on Linux, `dmg` on macOS and `nsis` on Windows by default
  (`linux.targets`, `mac.targets`, `win.targets`). The name of the files is the name of the package, without its scope.
- **`electron`** is merged into the configuration of electron-builder: icons, file associations, signing, updates.
  `name`, `appId`, `productName`, the description, the maintainer, the homepage and the license are given to it too.
- **An Electron application is not a service**: it runs in the session of its user, and `service` is refused.
- **The scripts** run in the `deb` and `rpm` packages (all four), the `pkg` (`preinstall`, `postinstall`) and the
  `nsis` installer (`preinstall`, `postinstall`, `preremove`); the other targets run none.
- **Native addons** are copied as they are installed: electron-builder does not rebuild them. The addons built on
  Node-API run as they are; install the Electron builds of the others before packing (`electron-rebuild`)
  ([NativeAddons](NativeAddons.md), section 4).
- On Linux arm64, the deb and rpm packages need the fpm of the system (`gem install fpm`, `USE_SYSTEM_FPM=true`), as the
  `Dockerfile.installer` of the Electron templates installs it.
