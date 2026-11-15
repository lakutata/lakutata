# Lakutata Installers

`lakutata package installer` builds an application's installers: system packages (deb, rpm, apk, pkg, msi…) that install
its executable, put its program in the PATH, and can register it as a service that starts with the system. They are
configured in the application's `package.json`, and need `@lakutata/builder` in the project, as do the other packing
commands ([Packaging](Packaging.md)).

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

An installer holds the directory-layout executable (`lakutata package exe --layout directory`): the program, its native
addons (`native/`) and its resources (`resources/`). The program is built with Node.js, or with Bun when
`lakutata.installer.runtime` is `"bun"`. On Node.js older than 20.12, specify a newer one with `--node-program`, as for
executables.

| Platform | Installers (default) | Their files | Made with |
|---|---|---|---|
| Linux (glibc) | `deb`, `rpm`, `tar.gz` (also `archlinux`) | `<name>_<version>_amd64.deb`, `<name>-<version>-1.x86_64.rpm`, `<name>-<version>-linux-amd64.tar.gz` | nFPM |
| Linux (musl, Alpine) | `apk`, `tar.gz` | `<name>-<version>-r0.x86_64.apk` | nFPM |
| macOS | `pkg`, `tar.gz` | `<name>-<version>-arm64.pkg`, `<name>-<version>-darwin-arm64.tar.gz` | `pkgbuild`, `productbuild` |
| Windows | `nsis`, `msi`, `zip` | `<name>-<version>-x64-setup.exe`, `<name>-<version>-x64.msi`, `<name>-<version>-win-x64.zip` | NSIS, WiX, WinSW |

- **On each platform**: a platform's installers are built on that platform, for the machine's architecture (section 7
  covers other platforms and architectures); a `pkg` package installs only on Macs of that architecture. The executables
  use the C library of the system they are built on, so build Linux packages for glibc systems on a glibc system, and
  `apk` packages on Alpine.
- **The tools** nFPM, NSIS, WiX and WinSW are downloaded once into the tool's cache (`LAKUTATA_CACHE_DIR`).
  `LAKUTATA_NFPM`, `LAKUTATA_NSIS`, `LAKUTATA_WIX` and `LAKUTATA_WINSW` name other copies, for machines without network
  access, or for Linux architectures other than x64 and arm64 (nFPM has releases only for these two). macOS needs no
  download.
- **The version** of the installers is the `version` field in the application's `package.json`.

## 2. The configuration

Installers are configured by `lakutata.installer` in the application's `package.json`. The configuration of the
`service` template with its `installer` feature (`lakutata create --with installer`):

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
| `name` | The program name (the first `bin`, otherwise the package name without its scope), in lower case | The name of the package, its directory and its files: lower case letters, digits, `+`, `-` and `.` |
| `appId` | `name` | The application identifier (`com.acme.shop`): on macOS, the package identifier and the service label; on Windows, the key of its uninstaller and its upgrades |
| `productName` | The `productName` of the `package.json`, otherwise `name` | The name shown to users (in the installers, and in the programs of Windows) |
| `description`, `homepage`, `license` | Those of the `package.json` | The package information |
| `maintainer` | The `author` of the `package.json` | Its maintainer (`Name <email>`); without one, the tool warns |
| `vendor` | None | Its vendor; on Windows, the publisher is the vendor, otherwise the maintainer |
| `runtime` | `node` | `node` or `bun` for the executable; `electron` for an Electron application (section 8), `nwjs` for an NW.js application (section 9) |
| `addToPath` | `true` | Put the program in the PATH: `/usr/bin/<program>` on Linux, `/usr/local/bin/<program>` on macOS, the machine-wide PATH on Windows |
| `service` | None | `true`, or the service options (section 4) |
| `linux.targets` | `deb`, `rpm`, `tar.gz`; on Alpine `apk`, `tar.gz` | The Linux installers (`deb`, `rpm`, `archlinux`, `tar.gz`; `apk`, `tar.gz` on Alpine) |
| `linux.depends`, `linux.recommends` | None | The system packages it needs and recommends (the C++ runtime library is always added) |
| `linux.section`, `linux.priority` | None | Its section and its priority (deb) |
| `mac.targets` | `pkg`, `tar.gz` | The macOS installers (`dmg` too, for an NW.js application) |
| `win.targets` | `nsis`, `msi`, `zip` | The Windows installers |
| `linux.scripts`, `mac.scripts`, `win.scripts`… | None | The installer scripts (section 5) |
| `electron` | None | The electron-builder configuration (section 8) |

`lakutata.icon` (beside `lakutata.installer`) is a square PNG image of 256 pixels or more: the icon of the Windows
executable and installers, and of Electron and NW.js applications.

The configuration is checked before anything is built, including the options of installers that are not being built, and
an error names the field:

```
error: The name of the package "Bad Name" must be lower case letters, digits, "+", "-" and "." (lakutata.installer.name)
error: The installer msi is not one of macOS (pkg, tar.gz)
error: The script lakutata.installer.mac.scripts.postinstall (scripts/missing.sh) does not exist
```

## 3. What is installed where

| | Linux | macOS | Windows |
|---|---|---|---|
| The application | `/opt/<name>` | `/usr/local/lib/<name>` | `C:\Program Files\<name>` |
| Its program in the PATH | `/usr/bin/<program>` | `/usr/local/bin/<program>` | the machine-wide PATH |
| Its service | `/usr/lib/systemd/system/<service>.service`; `/etc/init.d/<service>` (OpenRC, Alpine) | `/Library/LaunchDaemons/<appId>.plist` | a Windows service: `<name>-service.exe` (WinSW) next to the program |
| The service's environment | `/etc/<name>/<name>.env` | `/usr/local/etc/<name>/<name>.env` | `C:\ProgramData\<name>\<name>.env` |
| Its working directory (its data) | `/var/lib/<name>` | `/usr/local/var/lib/<name>` | `C:\ProgramData\<name>` |
| Its logs | the systemd journal (`journalctl -u <service>`); `/var/log/<name>.log` with OpenRC | `/usr/local/var/log/<name>.log` | `C:\ProgramData\<name>\logs` |
| Removal | by the package manager | `sudo /usr/local/lib/<name>/uninstall` | like other Windows programs |

- **macOS does not remove packages**: the `uninstall` script installed with the application removes it, its service and
  its link in the PATH.
- **The removal keeps** the data, the environment file and the service user, so that a new installation finds them
  again.
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
| `name` | `name` | The service name (systemd, OpenRC, Windows); on macOS the service is named by `appId` |
| `description` | The package description | |
| `args` | None | The program's arguments |
| `env` | `MODE=production` | Its environment, added to `MODE=production` |
| `user` | A system user created by the installation: `<name>` on Linux, `_<name>` (hidden) on macOS; on Windows the virtual account `NT SERVICE\<service>` | The user it runs as; `root` (Linux, macOS), or `LocalService`, `NetworkService`, `LocalSystem` on Windows |
| `restart` | `on-failure` | Restart it when it fails (`on-failure`), whenever it ends (`always`), or never (`no`); on Windows and with OpenRC, `on-failure` and `always` behave alike |
| `autoStart` | `true` | Enable and start it on installation; otherwise the administrator enables and starts it (`sudo systemctl enable --now <service>`; on macOS, `sudo launchctl enable system/<appId>`, then `sudo launchctl bootstrap system /Library/LaunchDaemons/<appId>.plist`) |

- **The environment file** holds `env`. Administrators can change it, and upgrades and removals keep their changes. The
  service reads it when it starts, so restart the service after changing it (`sudo systemctl restart <service>`,
  `sudo rc-service <service> restart`, `sudo launchctl kickstart -k system/<appId>`, `Restart-Service <service>`).
- **The working directory** of the service belongs to its user: write the application's data there, with relative paths
  or `process.cwd()`.
- **Stopping** the service stops the application gracefully: it receives `SIGTERM`, or on Windows a Ctrl+C, which
  Node.js receives as `SIGINT`. systemd, launchd and WinSW allow it 30 seconds to stop.

## 5. Installer scripts

Installers can run the application's scripts, which are files in the project: to create a database, migrate data, or
clean up. They are specified for a platform (run by all its installers), for one installer (replacing the platform's
script for the same stage), as native scripts of a Linux package, or as an NSIS file:

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

| Script | When it runs |
|---|---|
| `preinstall` | Before the application's files are installed |
| `postinstall` | After they are installed, before the service starts |
| `preremove` | Before the removal, once the service is stopped |
| `postremove` | After the files are removed |

```sh
#!/bin/sh
# scripts/linux/postinstall.sh: $1 is install or upgrade
if [ "$1" = install ]; then
    echo "Installed in $LAKUTATA_INSTALL_DIR"
fi
```

- **Their argument** (`$1`, `$args[0]` in PowerShell) says what the installer does: `install` or `upgrade` for
  `preinstall` and `postinstall`, `remove` for `preremove` and `postremove` (an upgrade runs no removal script). Each
  package manager signals an upgrade in its own way (dpkg, rpm, apk, pacman): the installers translate it.
- **`LAKUTATA_INSTALL_DIR`** is the application directory.
- **They run as root**; on Windows, as an administrator with NSIS and as the system account with Windows Installer.
  When a script fails, the installation (or the removal) fails.
- **Linux and macOS**: scripts run with the interpreter named on their first line (`#!/bin/bash`), `/bin/sh` by default.
  `linux.<package>.nativeScripts` run as the package's own scripts, with the package manager's arguments (and
  `preupgrade`, `postupgrade` for apk and archlinux). On macOS, the `uninstall` script runs the removal scripts.
- **Windows**: the scripts are PowerShell files (`.ps1`), run by Windows PowerShell. Windows Installer passes each one
  on a command line, which limits it to about 23 KB. `win.nsis.include` is an NSIS file (`.nsh`) that may define the
  macros `customHeader`, `customInit`, `customInstall` (at the end of installation), `customUnInit` and
  `customUnInstall` (at the start of removal).
- **The archives** run no script: the tool warns when a script would not run in one of the installers it builds
  (`! Some scripts of the application are not run by their installers: tar.gz (postinstall)`).

## 6. Signing

- **macOS**: `pkg` installers and `dmg` images are not signed, and the program or application they install is signed
  only ad hoc. The Developer ID signature and notarization, which distribution outside the organization's machines
  requires, are not performed yet.
- **Windows**: NSIS and MSI installers are not signed; sign them with signtool before distributing them. A program built
  with Node.js keeps the signature of `node.exe`, which no longer matches, and the tool warns about it.
- **Linux**: the packages are not signed.

## 7. Other platforms

Installers for other platforms are built on those platforms: a CI with one machine per platform, or, for Linux, a
container of each architecture. Templates with the `installer` feature have both scripts:

```json
{
  "scripts": {
    "package:host": "npm run build && npm run package -w app -- --outdir ../../dist/installer",
    "package:linux": "docker buildx build --file Dockerfile.installer --output type=local,dest=dist/installer ."
  }
}
```

`npm run package:linux` builds the Linux packages in a container (on macOS and Windows too) and copies them to
`dist/installer`; `docker buildx build --platform linux/arm64 ...` builds them for another architecture. Its
`Dockerfile.installer`:

```dockerfile
FROM node:22-bookworm AS build
WORKDIR /project
COPY . .
RUN (npm ci --no-audit --no-fund || npm install --no-audit --no-fund) && npm run build && npm run package -w app -- --outdir /installer

FROM scratch
COPY --from=build /installer /
```

`apk` packages are built the same way on `node:22-alpine`, with Bun when the application has native addons (executables
built with Node.js do not load them on musl). A CI matrix builds the rest, for example with GitHub Actions:

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

With `"runtime": "electron"`, the installers are built by electron-builder, which the project installs alongside
`electron`. The main process is bundled (without Electron), and its native addons and resources (`lakutata.resources`:
the renderer and the preload script, read through `resourcesPath()`) go into Electron's resources. The `electron-react`
and `electron-vue` templates are configured this way.

- **The installers** are electron-builder targets: `deb` on Linux, `dmg` on macOS and `nsis` on Windows by default
  (`linux.targets`, `mac.targets`, `win.targets`). Their files are named after the package, without its scope.
- **`electron`** is merged into the electron-builder configuration: icons, file associations, signing, updates. `name`,
  `appId`, `productName`, the description, the maintainer, the homepage and the license are passed to it too.
- **An Electron application is not a service**: it runs in its user's session, and `service` is rejected.
- **The scripts** run in the `deb` and `rpm` packages (all four), the `pkg` (`preinstall`, `postinstall`) and the
  `nsis` installer (`preinstall`, `postinstall`, `preremove`); the other targets run none.
- **Native addons** are copied in their installed form: electron-builder does not rebuild them. Node-API addons run
  unchanged; install the Electron builds of the others before packing (`electron-rebuild`)
  ([Native Addons](NativeAddons.md), section 4).
- On Linux arm64, deb and rpm packages need the system's fpm (`gem install fpm`, `USE_SYSTEM_FPM=true`), which the
  Electron templates' `Dockerfile.installer` installs.

## 9. NW.js applications

With `"runtime": "nwjs"`, the installers hold an NW.js application built by the builder. It is the normal flavor of the
application's NW.js (its `lakutata.nwjs`, set by `lakutata nwjs use`), downloaded once into the Lakutata cache and
checked against its release checksums, with the application inside: its bundle for the Node.js that this NW.js includes,
its native addons, its resources (`lakutata.resources`, read through `resourcesPath()`) and the NW.js manifest. The
`nwjs-react` and `nwjs-vue` templates are configured this way.

- **The runtime** is named after the application: on Windows, `<name>.exe`, whose icon and version information are the
  application's; on Linux, `<name>`; on macOS, `<productName>.app`, whose `Info.plist` specifies its name, identifier
  (`appId`), version and icon, and which is re-signed ad hoc.
- **The installers** are those of a desktop application: `dmg` on macOS, `nsis` on Windows and `deb` on Linux by default
  (also `pkg` and `tar.gz` on macOS, `msi` and `zip` on Windows, `rpm` and `tar.gz` on Linux). The Windows installers
  add the application to the start menu and the desktop; the `dmg` disk image holds it beside a link to /Applications,
  where its user drags it, and the `pkg` package installs it there (an Intel application, on Apple silicon Macs too);
  the Linux packages add its desktop entry and icons, and depend on Chromium's libraries.
- **The architecture** is the machine's, or the one specified by `--arch` (`x64`, `ia32`, `arm64`): `ia32` builds
  installers for 32-bit Windows, which install the application among the 32-bit programs. An NW.js release without an
  Apple silicon build (0.72) is packaged for Intel.
- **An NW.js application is not a service**, and is not put in the PATH (`addToPath` is `false` by default).
- **The scripts** run as for other applications, but a macOS application is removed by deleting it: no removal script
  runs there.
- **Native addons** are made to load in NW.js: rebuilt for its architecture, or with its headers when they use the V8
  API, and, on Windows, set to load the Node.js that NW.js includes ([Native Addons](NativeAddons.md), section 4).
