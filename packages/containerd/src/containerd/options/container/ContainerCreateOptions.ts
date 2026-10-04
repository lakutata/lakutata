import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import type {ContainerdRestartPolicy} from '../../types/ContainerdRestartPolicy.js'
import type {ContainerdBind} from '../../types/ContainerdBind.js'
import type {ContainerdDevice} from '../../types/ContainerdDevice.js'
import type {ContainerdTmpfs} from '../../types/ContainerdTmpfs.js'
import type {ContainerdVolume} from '../../types/ContainerdVolume.js'

/**
 * The settings of a container created by {@link Containerd.createContainer}: its image, its process, its mounts, its
 * networks, its resources and its security. Only `image` is required; the container is created stopped (`start()` it)
 * as a nerdctl container (`nerdctl ps` lists it), with an OCI runtime specification built as nerdctl builds it. The
 * component keeps these settings: {@link ContainerdContainer.update} creates the container again with the ones it
 * changes.
 *
 * Unlike the Docker component, the container joins the host network unless `networks` is given, its ports are
 * published only on a CNI network, and its named volumes are directories the component keeps (not Docker's nor
 * nerdctl's volumes).
 * @example
 * ```typescript
 * import {Containerd} from 'lakutata/com/containerd'
 *
 * declare const containerd: Containerd
 *
 * await containerd.pullImage({image: 'nginx:1.27'})
 * const container = await containerd.createContainer({
 *     image: 'nginx:1.27',
 *     name: 'web',
 *     env: {NGINX_PORT: '80'},
 *     binds: [{hostPath: '/srv/www', containerPath: '/usr/share/nginx/html', rw: false}],
 *     volumes: [{volumeName: 'web-cache', containerPath: '/var/cache/nginx'}],
 *     //The default nerdctl network, its port 80 published on the host port 8080
 *     networks: [{networkName: 'bridge'}],
 *     ports: [{port: 80, hostPorts: [8080]}],
 *     memoryLimit: 256 * 1024 * 1024,
 *     cpus: 0.5,
 *     restartPolicy: 'unless-stopped'
 * })
 * await container.start()
 * ```
 */
export class ContainerCreateOptions extends DTO {
    /**
     * The image of the container: its name or a reference (`'alpine:3.20'`, `'docker.io/library/alpine:3.20'`,
     * `'registry.example.com/app@sha256:…'`). Required. The image must be in containerd already (pull, import or build
     * it first): a missing one throws {@link ContainerdImageNotFoundException}.
     */
    @Expect(DTO.String().required())
    public image: string

    /**
     * The platform of the image run (`'linux/amd64'`, `'linux/arm/v7'`, or `'arm64'` for `linux/arm64`), pulled
     * beforehand; another architecture than the machine's needs a QEMU emulator registered in binfmt_misc
     * ({@link Containerd.supportedPlatforms}). The machine's platform by default; an image without it throws
     * {@link ContainerdPlatformException}.
     */
    @Expect(DTO.String().optional())
    public platform?: string

    /**
     * The name of the container, matching `[a-zA-Z0-9][a-zA-Z0-9_.-]*` and unique in the namespace (a name in use
     * throws {@link ContainerdContainerNameConflictException}). By default, the last part of the image name and the
     * first 5 hexadecimal digits of the container ID (`'nginx-3fa2c'`).
     */
    @Expect(DTO.String().pattern(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/).optional())
    public name?: string

    /**
     * The host name of the container, written to its `/etc/hostname` and its `HOSTNAME` variable. By default, the
     * host's name on the host network, the first 12 digits of the container ID otherwise.
     */
    @Expect(DTO.String().optional())
    public hostname?: string

    /**
     * The command of the container, its arguments (`['nginx', '-g', 'daemon off;']`), run after the entry point. The
     * image's command by default; dropped when `entrypoint` is given without it (as Docker does).
     */
    @Expect(DTO.Array(DTO.String()).optional())
    public cmd?: string[]

    /**
     * The entry point of the container, its arguments, replacing the image's; `['']` removes the image's entry point.
     * The image's entry point by default. A container left with neither an entry point nor a command fails to be
     * created.
     */
    @Expect(DTO.Array(DTO.String()).optional())
    public entrypoint?: string[]

    /**
     * The environment variables of the container, added to the image's ones (and replacing them by name). The
     * container also gets `HOSTNAME`, and `PATH` and `HOME` (the user's home directory) when the image has none.
     */
    @Expect(DTO.Object().pattern(DTO.String(), DTO.String().allow('')).optional())
    public env?: Record<string, string>

    /**
     * The working directory of the container's process; the image's one by default, `/` without it.
     */
    @Expect(DTO.String().optional())
    public workingDir?: string

    /**
     * The user of the container's process: `'user'`, `'user:group'`, `'uid'` or `'uid:gid'`, the names resolved by
     * the image's `/etc/passwd` and `/etc/group`. The image's user by default, root without it.
     */
    @Expect(DTO.String().optional())
    public user?: string

    /**
     * The labels of the container, added to the image's ones; the ones the component sets (`nerdctl/…`,
     * `containerd.io/restart.…`) cannot be overridden. {@link Containerd.listContainers} filters by them.
     */
    @Expect(DTO.Object().pattern(DTO.String(), DTO.String().allow('')).optional())
    public labels?: Record<string, string>

    /**
     * Give the container all the capabilities, access to every device by its cgroup, the host's devices in its `/dev`
     * (the character and block devices of the host's `/dev` when the container is created, as nerdctl gives them; a
     * device plugged later needs a bind of `/dev`), `/sys` and `/sys/fs/cgroup` writable, no masked paths, no seccomp
     * filter and no `no_new_privs`.
     * @default false
     */
    @Expect(DTO.Boolean().optional())
    public privileged?: boolean

    /**
     * Mount the container's root file system read only (its mounts, tmpfs and volumes stay writable).
     * @default false
     */
    @Expect(DTO.Boolean().optional())
    public readonlyRootfs?: boolean

    /**
     * The Linux capabilities added to the default ones (the 14 Docker gives: `CHOWN`, `DAC_OVERRIDE`, `FSETID`,
     * `FOWNER`, `MKNOD`, `NET_RAW`, `SETGID`, `SETUID`, `SETFCAP`, `SETPCAP`, `NET_BIND_SERVICE`, `SYS_CHROOT`, `KILL`,
     * `AUDIT_WRITE`), with or without the `CAP_` prefix, in any case (`'NET_ADMIN'`, `'cap_sys_time'`); `'ALL'` adds
     * them all. Added after `capabilitiesDrop` is applied. Unlike the Docker component, the names are not checked
     * against a list.
     */
    @Expect(DTO.Array(DTO.String()).optional())
    public capabilities?: string[]

    /**
     * The Linux capabilities removed from the default ones, with or without the `CAP_` prefix (`'NET_RAW'`); `'ALL'`
     * removes them all, before `capabilities` adds its ones.
     */
    @Expect(DTO.Array(DTO.String()).optional())
    public capabilitiesDrop?: string[]

    /**
     * The seccomp profile filtering the system calls of the container: `'default'`, the default profile of containerd
     * and nerdctl (the system calls allowed by the container's capabilities), applied when the kernel supports seccomp;
     * `'unconfined'`, no filter; or the path of a JSON file holding an OCI seccomp profile (the `linux.seccomp` object
     * of a runtime specification), read when the container is created. Privileged containers have no filter.
     * @default 'default'
     */
    @Expect(DTO.String().optional().default('default'))
    public seccompProfile?: 'default' | 'unconfined' | string

    /**
     * The host directories and files mounted into the container. Each needs `hostPath` and `containerPath`; `rw`
     * defaults to `true`, `propagation` to `'rprivate'`.
     */
    @Expect(DTO.Array(DTO.Object({
        hostPath: DTO.String().required(),
        containerPath: DTO.String().required(),
        rw: DTO.Boolean().optional().default(true),
        propagation: DTO.String().valid('private', 'rprivate', 'shared', 'rshared', 'slave', 'rslave').optional()
    })).optional())
    public binds?: ContainerdBind[]

    /**
     * The named volumes mounted into the container, created empty when they do not exist ({@link ContainerdVolume}).
     * Each needs `volumeName` (`[a-zA-Z0-9][a-zA-Z0-9_.-]*`) and `containerPath`.
     */
    @Expect(DTO.Array(DTO.Object({
        volumeName: DTO.String().pattern(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/).required(),
        containerPath: DTO.String().required(),
        readonly: DTO.Boolean().optional()
    })).optional())
    public volumes?: ContainerdVolume[]

    /**
     * The tmpfs mounted into the container ({@link ContainerdTmpfs}). Each needs `containerPath`; `size` is a positive
     * integer of bytes, `mode` three or four octal digits.
     */
    @Expect(DTO.Array(DTO.Object({
        containerPath: DTO.String().required(),
        size: DTO.Number().integer().positive().optional(),
        mode: DTO.String().pattern(/^[0-7]{3,4}$/).optional()
    })).optional())
    public tmpfs?: ContainerdTmpfs[]

    /**
     * The host devices given to the container ({@link ContainerdDevice}): a device node, or a directory of them. Each
     * needs `hostPath`; `cgroupPermissions` is one to three of `r`, `w` and `m`, each at most once, in any order
     * (`'rw'`, `'mr'`), `'rwm'` by default.
     */
    @Expect(DTO.Array(DTO.Object({
        hostPath: DTO.String().required(),
        containerPath: DTO.String().optional(),
        cgroupPermissions: DTO.String().pattern(/^(?!.*(.).*\1)[rwm]{1,3}$/).optional().default('rwm')
    })).optional())
    public devices?: ContainerdDevice[]

    /**
     * The devices the container's cgroup allows besides the ones given, as Docker's `--device-cgroup-rule` writes them:
     * a type (`c` character, `b` block, `a` all), the major and minor numbers or `*`, the access (one to three of `r`,
     * `w`, `m`, each at most once): `"c 188:* rwm"` for the USB serial ports. They let the container use the devices
     * plugged after its start, with a bind of `/dev` (or of `/dev/serial`, `/dev/bus/usb`).
     */
    @Expect(DTO.Array(DTO.String().pattern(/^[acb] (\*|\d+):(\*|\d+) (?!.*(.).*\3)[rwm]{1,3}$/)).optional())
    public deviceCgroupRules?: string[]

    /**
     * The network of a container without `networks`: `'host'`, the host's network stack, or `'none'`, a network
     * namespace with only its loopback. Ignored when `networks` is given. Unlike Docker, the default is the host
     * network.
     * @default 'host'
     */
    @Expect(DTO.String().valid('host', 'none').optional().default('host'))
    public network?: 'host' | 'none'

    /**
     * The CNI networks the container joins, in order (its interfaces `eth0`, `eth1`…): `'bridge'`, the default nerdctl
     * network (`10.4.0.0/24`, created when first used), or one created by {@link Containerd.createNetwork}. Each needs
     * `networkName`, of an existing network other than `host` and `none` (a missing one throws
     * {@link ContainerdNetworkNotFoundException}), given once; `ip` and `ipv6` set its address on the network (`''` or
     * absent: one given by the network's IPAM). Requires the CNI plugins in the component's `cniPath`.
     */
    @Expect(DTO.Array(DTO.Object({
        networkName: DTO.String().required(),
        ip: DTO.String().allow('').ip({version: 'ipv4'}).optional(),
        ipv6: DTO.String().allow('').ip({version: 'ipv6'}).optional()
    })).optional())
    public networks?: { networkName: string, ip?: string, ipv6?: string }[]

    /**
     * The container ports published on the host, by the CNI `portmap` plugin on its first network: it needs `networks`
     * (ports on the host or `none` network fail the creation). Each needs `port`, the container port, and `hostPorts`,
     * one or more host ports forwarding to it; `type` is `'tcp'` (the default), `'udp'` or `'sctp'`; `hostIP` limits
     * them to one host address (all of them by default). Unlike the Docker component, `hostPorts` is required and
     * `type` is optional.
     */
    @Expect(DTO.Array(DTO.Object({
        port: DTO.Number().port().required(),
        type: DTO.String().valid('tcp', 'udp', 'sctp').optional().default('tcp'),
        hostPorts: DTO.Array(DTO.Number().port()).min(1).required(),
        hostIP: DTO.String().ip().optional()
    })).optional())
    public ports?: { port: number, type?: 'tcp' | 'udp' | 'sctp', hostPorts: number[], hostIP?: string }[]

    /**
     * `'host'` shares the host's PID namespace (the container sees the host processes); a namespace of its own when
     * not given.
     */
    @Expect(DTO.String().valid('host').optional())
    public pidMode?: 'host'

    /**
     * `'host'` shares the host's IPC namespace (its shared memory and message queues); a namespace of its own when not
     * given.
     */
    @Expect(DTO.String().valid('host').optional())
    public ipcMode?: 'host'

    /**
     * The cgroup namespace: `'private'`, one of its own (its cgroup seen as the root of its `/sys/fs/cgroup`), applied
     * on cgroup v2 hosts only; `'host'`, the host's one.
     * @default 'private'
     */
    @Expect(DTO.String().valid('private', 'host').optional().default('private'))
    public cgroupns?: 'private' | 'host'

    /**
     * The memory limit in bytes, a non-negative integer; `0` or absent for no limit. With it, the swap is limited too
     * (see `memorySwap`).
     */
    @Expect(DTO.Number().integer().min(0).optional())
    public memoryLimit?: number

    /**
     * The limit of the memory and the swap together in bytes, as Docker's and nerdctl's `--memory-swap`: at least
     * `memoryLimit` (equal to it, no swap), or `-1` for unlimited swap. `0` or absent with `memoryLimit`: twice
     * `memoryLimit` (as much swap as memory). A positive value needs `memoryLimit`: without it, the options are
     * refused. Discarded when the kernel does not limit the swap of the cgroups (as Docker discards it).
     */
    @Expect(DTO.Number().integer().min(-1).optional().custom((value: number, helpers) => {
        const memoryLimit: number | undefined = helpers.state.ancestors?.[0]?.memoryLimit
        if (value > 0 && !memoryLimit) return helpers.message({custom: '"memorySwap" needs "memoryLimit"'})
        if (value > 0 && value < memoryLimit!) return helpers.message({custom: '"memorySwap" (the memory and the swap) must be at least "memoryLimit"'})
        return value
    }, 'Swap Limit Validation'))
    public memorySwap?: number

    /**
     * The CPUs the container uses at most, a positive number (`1.5`): a CFS quota of `cpus × 100000` µs per period of
     * 100000 µs. No limit by default.
     */
    @Expect(DTO.Number().positive().optional())
    public cpus?: number

    /**
     * The relative CPU weight of the container against the others when the CPUs are busy, in cgroup v1 CPU shares
     * (`1024` is the kernel's default; runc converts them to a `cpu.weight` on cgroup v2). A positive integer; the
     * kernel's default when not given.
     */
    @Expect(DTO.Number().integer().positive().optional())
    public cpuShares?: number

    /**
     * The CPUs the container may run on, by their numbers (`[0, 1]`); all of them by default.
     */
    @Expect(DTO.Array(DTO.Number().integer().min(0)).optional())
    public cpuSet?: number[]

    /**
     * The processes (and threads) the container may have at most, a positive integer; no limit by default.
     */
    @Expect(DTO.Number().integer().positive().optional())
    public pidsLimit?: number

    /**
     * Disable the kernel's OOM killer for the container: its processes wait for memory instead of being killed at its
     * memory limit. Supported on cgroup v1 only.
     * @default false
     */
    @Expect(DTO.Boolean().optional())
    public OOMKillDisable?: boolean

    /**
     * The kernel parameters set in the container's namespaces (`{'net.ipv4.ip_forward': '1'}`); runc accepts only the
     * namespaced ones (`net.*` outside the host network, `kernel.shm*`, `kernel.msg*`, `fs.mqueue.*`…).
     */
    @Expect(DTO.Object().pattern(DTO.String(), DTO.String()).optional())
    public sysctls?: Record<string, string>

    /**
     * The size of the container's `/dev/shm` in bytes, a positive integer.
     * @default 67108864
     */
    @Expect(DTO.Number().integer().positive().optional())
    public shmSize?: number

    /**
     * The restart policy, applied by containerd's restart monitor ({@link ContainerdRestartPolicy}): `''` or `'no'`,
     * `'always'`, `'unless-stopped'`, `'on-failure'`, `'on-failure:N'`. Never restarted by default.
     */
    @Expect(DTO.String().allow('').pattern(/^(no|always|unless-stopped|on-failure(:\d+)?)$/).optional())
    public restartPolicy?: ContainerdRestartPolicy

    /**
     * The signal `stop()` sends first (`'SIGTERM'`, `'SIGQUIT'`, `'TERM'`, `'15'`); the image's stop signal by default,
     * `SIGTERM` without it.
     */
    @Expect(DTO.String().optional())
    public stopSignal?: string

    /**
     * The host names added to the container's `/etc/hosts`, each mapped to an IP address
     * (`{'db.local': '10.4.1.5'}`).
     */
    @Expect(DTO.Object().pattern(DTO.String(), DTO.String().ip()).optional())
    public extraHosts?: Record<string, string>

    /**
     * The IP addresses of the name servers of the container's `/etc/resolv.conf`, replacing the host's. By default,
     * the host's `/etc/resolv.conf`, without its loopback name servers outside the host network (and with `8.8.8.8`
     * and `8.8.4.4` when none is left, as Docker does).
     */
    @Expect(DTO.Array(DTO.String().ip()).optional())
    public dns?: string[]
}
