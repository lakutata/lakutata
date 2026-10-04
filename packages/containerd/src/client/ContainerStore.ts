import {randomBytes} from 'node:crypto'
import {availableParallelism, constants as osConstants, hostname as osHostname, totalmem} from 'node:os'
import {copyFile, lstat, mkdir, open, readdir, readFile, readlink, rm, stat, truncate, writeFile} from 'node:fs/promises'
import {createReadStream, existsSync, readdirSync, type BigIntStats, type Dirent, type Stats} from 'node:fs'
import {pipeline} from 'node:stream/promises'
import {pack as tarPack, type Header, type Pack} from 'tar-stream'
import path from 'node:path'
import {Readable} from 'node:stream'
import {setTimeout as sleep} from 'node:timers/promises'
import {ContainerdClient, IsGRPCError, PROCESS_TYPE_URL, SPEC_TYPE_URL, TimestampDate, type SnapshotMount} from './ContainerdClient.js'
import {GRPCStatus, Decode, Encode, type Message} from '@lakutata/grpc'
import * as M from './Messages.js'
import {FormatPlatform, HostPlatform, ParsePlatform, type Platform} from './Platforms.js'
import {ChainIds, ImageStore, type ImageConfigChanges, type ResolvedImage} from './ImageStore.js'
import {ProcessFifo} from './Fifo.js'
import {VolumeStore, type Volume} from './Volumes.js'
import {DEFAULT_NETWORK, NetworkStore, type CNINetwork, type ContainerNetworkInterface, type PortMapping} from './Networks.js'
import {DirectoryTree, LayerDirectories, LayersTree, ResolveUser, type FileTree, type ProcessUser} from './Rootfs.js'
import {Capabilities, ExecProcessSpec, GenerateSpec, ParseDeviceCgroupRule, type SpecDevice, type SpecMount} from './Spec.js'
import {DefaultSeccompProfile, SeccompSupported, type SeccompProfile} from './Seccomp.js'

/**
 * The labels of the containers: the ones of nerdctl (nerdctl ps, nerdctl logs know them), the ones of the restart
 * monitor of containerd
 */
export const ContainerLabels = {
    NAME: 'nerdctl/name',
    HOSTNAME: 'nerdctl/hostname',
    PLATFORM: 'nerdctl/platform',
    LOG_URI: 'nerdctl/log-uri',
    STATE_DIR: 'nerdctl/state-dir',
    NETWORKS: 'nerdctl/networks',
    PORTS: 'nerdctl/ports',
    MOUNTS: 'nerdctl/mounts',
    STOP_SIGNAL: 'io.containerd.image.config.stop-signal',
    RESTART_POLICY: 'containerd.io/restart.policy',
    RESTART_STATUS: 'containerd.io/restart.status',
    RESTART_LOG_URI: 'containerd.io/restart.loguri'
} as const

/**
 * The restart policies of the containers (the ones of the restart monitor of containerd): no, always,
 * unless-stopped, on-failure (on-failure:N, N restarts at most)
 */
export type RestartPolicy = 'no' | 'always' | 'unless-stopped' | 'on-failure' | `on-failure:${number}`

/**
 * The statuses of the containers
 */
export type ContainerStatus = 'created' | 'running' | 'paused' | 'pausing' | 'restarting' | 'exited' | 'unknown'

/**
 * The state of a container: its task (its process), its last exit
 */
export type ContainerRuntimeState = {
    status: ContainerStatus
    running: boolean
    paused: boolean
    pid: number
    exitCode: number
    startedAt: Date | null
    finishedAt: Date | null
}

/**
 * A mount of a container: a directory or a file of the host (bind), a tmpfs
 */
export type ContainerMount = {
    type?: 'bind' | 'tmpfs' | 'volume'
    /**
     * The directory (or the file) of the host of a bind, the name of a volume (created when it does not exist)
     */
    source?: string
    target: string
    readonly?: boolean
    /**
     * The options of the mount (size=64m for a tmpfs, the propagation of a bind: rshared…)
     */
    options?: string[]
}

/**
 * A device of the host given to a container
 */
export type ContainerDeviceMapping = {
    hostPath: string
    containerPath?: string
    permissions?: string
}

/**
 * The options of the creation of a container
 */
export type ContainerCreateOptions = {
    image: string
    name?: string
    platform?: Platform
    hostname?: string
    cmd?: string[]
    entrypoint?: string[]
    env?: Record<string, string>
    workingDir?: string
    user?: string
    labels?: Record<string, string>
    terminal?: boolean
    privileged?: boolean
    readonlyRootfs?: boolean
    capAdd?: string[]
    capDrop?: string[]
    /**
     * The profile of seccomp: the default one of containerd (and nerdctl), unconfined, or the file of a profile of OCI
     * (the linux.seccomp of its specification); the privileged containers are unconfined
     */
    seccompProfile?: 'default' | 'unconfined' | string
    mounts?: ContainerMount[]
    devices?: ContainerDeviceMapping[]
    /**
     * The devices the cgroup allows besides the ones given, as Docker writes them ("c 188:* rwm"): the devices plugged
     * after the start, given by a bind mount of /dev (or of /dev/serial, /dev/bus/usb)
     */
    deviceCgroupRules?: string[]
    /**
     * The network of the container: the one of the host, none (its loopback only), or networks of CNI (bridge, the
     * default one of nerdctl), with their addresses
     */
    network?: 'host' | 'none' | { name: string, ip?: string, ipv6?: string }[]
    /**
     * The ports published on the host (on its first network of CNI)
     */
    ports?: PortMapping[]
    pidHost?: boolean
    ipcHost?: boolean
    /**
     * The cgroup namespace: a private one (on cgroup v2), or the one of the host
     */
    cgroupns?: 'private' | 'host'
    memory?: number
    memorySwap?: number
    cpus?: number
    cpuShares?: number
    cpuset?: string
    pidsLimit?: number
    oomKillDisable?: boolean
    sysctls?: Record<string, string>
    shmSize?: number
    restart?: RestartPolicy
    stopSignal?: string
    extraHosts?: Record<string, string>
    dns?: string[]
}

/**
 * The options of the store of the containers
 */
export type ContainerStoreOptions = {
    snapshotter: string
    runtime: string
    cgroupManager: 'cgroupfs' | 'systemd'
    /**
     * The directory of the states of the containers (their logs, their hosts, resolv.conf and hostname)
     */
    dataRoot: string
    /**
     * The size of the logs of a container rotated (once): 0 never
     */
    logMaxSize: number
}

/**
 * The result of an execution in a container
 */
export type ExecResult = {
    exitCode: number
    stdout: string
    stderr: string
}

/**
 * The state of a container written by the store (its last exit, its task deleted)
 */
type StoredState = {
    startedAt?: string
    finishedAt?: string
    exitCode?: number
}

/**
 * The resolv.conf of a container: the one of the host, without its local name servers on its own network (the ones of
 * Google when it has no other one, as Docker does)
 * @param content
 * @param ownNetwork
 */
export function ResolvConf(content: string, ownNetwork: boolean): string {
    if (!ownNetwork) return content
    const lines: string[] = content.split('\n').filter((line: string): boolean => !/^\s*nameserver\s+(127\.|::1\s*$)/.test(line))
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
    if (!lines.some((line: string): boolean => /^\s*nameserver\s+/.test(line))) lines.push('nameserver 8.8.8.8', 'nameserver 8.8.4.4')
    return lines.join('\n') + '\n'
}

/**
 * An error of the runtime refusing the profile of seccomp of a container (a runc built without seccomp), with what to do
 * @param error
 */
export function SeccompHint(error: unknown): unknown {
    const message: string = (error as Error)?.message ?? ''
    if (!/seccomp/i.test(message) || !/not (supported|enabled)/i.test(message)) return error
    return Object.assign(error as Error, {message: `${message} (the runtime of this machine does not filter the system calls with seccomp: create the container with the profile of seccomp unconfined)`})
}

/**
 * The resources of a container used (its cgroup, its interfaces of network)
 */
export type ContainerResourceStats = {
    read: Date
    pids: { current: number, limit: number }
    cpu: {
        /**
         * Its time on the CPUs in nanoseconds, in the user mode and in the kernel mode
         */
        usage: number
        user: number
        system: number
        throttledPeriods: number
        throttledTime: number
        onlineCpus: number
        /**
         * Its use of the CPUs during the interval of the sampling (100 is one CPU used all the time)
         */
        percent: number
    }
    memory: {
        usage: number
        /**
         * Its usage without the cache which can be freed (the one of docker stats)
         */
        workingSet: number
        limit: number
        cache: number
        swap: number
        oomKills: number
    }
    blkio: { readBytes: number, writeBytes: number, readOps: number, writeOps: number }
    networks: Record<string, { rxBytes: number, rxPackets: number, rxErrors: number, rxDropped: number, txBytes: number, txPackets: number, txErrors: number, txDropped: number }>
}

/**
 * A terminal of a process executed in a container: its input, its output, its size, its exit
 */
export type ContainerTerminal = {
    execId: string
    input: NodeJS.WritableStream & { end(): unknown }
    output: Readable
    resize(cols: number, rows: number): Promise<void>
    exited: Promise<number>
    close(): Promise<void>
}

/**
 * The resources of a running container updated
 */
export type ContainerResourceUpdate = {
    memory?: number
    memorySwap?: number
    cpus?: number
    cpuShares?: number
    cpuset?: string
    pidsLimit?: number
    oomKillDisable?: boolean
    restart?: RestartPolicy | ''
}

/**
 * The number of a signal (SIGTERM, TERM, 15)
 * @param signal
 */
export function SignalNumber(signal: string | number): number {
    if (typeof signal === 'number') return signal
    if (/^\d+$/.test(signal)) return Number(signal)
    const name: string = signal.toUpperCase().startsWith('SIG') ? signal.toUpperCase() : `SIG${signal.toUpperCase()}`
    const number: number | undefined = (osConstants.signals as Record<string, number>)[name]
    if (number === undefined) throw new Error(`The signal ${signal} is unknown`)
    return number
}

let swapLimitSupported: boolean | undefined

/**
 * Whether the kernel limits the swap of the cgroups (Docker discards the swap limits otherwise): the files of the swap
 * limits, in the cgroups below the root on cgroup v2 (the root has none)
 */
export function SwapLimitSupported(): boolean {
    if (swapLimitSupported !== undefined) return swapLimitSupported
    if (existsSync('/sys/fs/cgroup/cgroup.controllers')) {
        try {
            swapLimitSupported = readdirSync('/sys/fs/cgroup', {withFileTypes: true}).some((entry: Dirent): boolean => entry.isDirectory() && existsSync(path.join('/sys/fs/cgroup', entry.name, 'memory.swap.max')))
        } catch {
            swapLimitSupported = false
        }
    } else {
        swapLimitSupported = existsSync('/sys/fs/cgroup/memory/memory.memsw.limit_in_bytes')
    }
    return swapLimitSupported
}

/**
 * The swap limit of a container (its memory and its swap together), as Docker and nerdctl give it: twice its memory
 * limit by default, -1 unlimited; none without a memory limit, or when the kernel does not limit the swap
 * @param memory
 * @param memorySwap
 */
export function SwapLimit(memory: number | undefined, memorySwap: number | undefined): number | undefined {
    if (!memory || !SwapLimitSupported()) return undefined
    return memorySwap === -1 || (memorySwap && memorySwap > 0) ? memorySwap : memory * 2
}

/**
 * The CPUs of the machine online, as a cpuset writes them (0-3,6)
 */
async function OnlineCpus(): Promise<string> {
    return (await readFile('/sys/devices/system/cpu/online', 'utf8').catch((): string => '')).trim() || `0-${availableParallelism() - 1}`
}

/**
 * The counters of a metrics message as numbers: the 64-bit ones beyond 2^53 (an unlimited limit, 2^64 - 1) are decoded
 * as bigints, the statistics are numbers
 * @param value
 */
function Counters<T>(value: T): T {
    if (typeof value === 'bigint') return Number(value) as T
    if (Array.isArray(value)) return value.map(Counters) as T
    if (value && typeof value === 'object' && !(value instanceof Uint8Array)) return Object.fromEntries(Object.entries(value).map(([key, item]): [string, unknown] => [key, Counters(item)])) as T
    return value
}

/**
 * The containers of containerd: created from the images (their specifications of OCI, their snapshots), their tasks
 * started, stopped, executed in; their logs written by the shims of containerd (file://), kept by the restart monitor
 * of containerd as their restart policies ask
 */
export class ContainerStore {

    public readonly volumes: VolumeStore

    constructor(protected readonly client: ContainerdClient, protected readonly images: ImageStore, protected readonly networks: NetworkStore, public readonly options: ContainerStoreOptions, volumes?: VolumeStore) {
        this.volumes = volumes ?? new VolumeStore(path.join(options.dataRoot, 'volumes', client.namespace))
    }

    /**
     * The names of the volumes of a container
     * @param container
     */
    public static Volumes(container: Message): string[] {
        try {
            return (JSON.parse(container.labels?.[ContainerLabels.MOUNTS] ?? '[]') as { Type?: string, Name?: string }[])
                .filter((mount): boolean => mount.Type === 'volume' && !!mount.Name)
                .map((mount): string => mount.Name!)
        } catch {
            return []
        }
    }

    /**
     * The networks of CNI of a container
     * @param network
     * @protected
     */
    protected async cniNetworks(network: ContainerCreateOptions['network']): Promise<{ network: CNINetwork, ip?: string, ipv6?: string }[]> {
        if (!Array.isArray(network)) return []
        if (!network.length) throw new Error('The networks of the container are empty')
        const networks: { network: CNINetwork, ip?: string, ipv6?: string }[] = []
        for (const item of network) {
            if (item.name === 'host' || item.name === 'none') throw new Error(`The network ${item.name} is not one of CNI: give it alone`)
            const found: CNINetwork | undefined = await this.networks.get(item.name)
            if (!found) throw Object.assign(new Error(`The network ${item.name} does not exist`), {code: 'NETWORK_NOT_FOUND'})
            if (networks.some((known): boolean => known.network.name === found.name)) throw new Error(`The network ${found.name} is given twice`)
            networks.push({network: found, ip: item.ip, ipv6: item.ipv6})
        }
        return networks
    }

    /**
     * The profile of seccomp of a container, as nerdctl gives it: none for the privileged ones, unconfined ones and when
     * the kernel does not filter the system calls; the default one by its capabilities; the one of a file
     * @param options
     * @protected
     */
    protected async seccomp(options: ContainerCreateOptions): Promise<SeccompProfile | undefined> {
        const profile: string = options.seccompProfile ?? 'default'
        if (options.privileged || profile === 'unconfined') return undefined
        if (profile !== 'default') {
            try {
                return JSON.parse(await readFile(profile, 'utf8')) as SeccompProfile
            } catch (error: unknown) {
                throw new Error(`The profile of seccomp ${profile} is not read: ${(error as Error).message}`, {cause: error})
            }
        }
        if (!SeccompSupported()) return undefined
        return DefaultSeccompProfile(Capabilities(options))
    }

    /**
     * The interfaces of a container on its networks of CNI (their addresses while it runs)
     * @param container
     */
    public async interfaces(container: Message): Promise<ContainerNetworkInterface[]> {
        return await this.networks.interfaces(this.stateDir(container.id))
    }

    /**
     * The directory of the state of a container
     * @param id
     */
    public stateDir(id: string): string {
        return path.join(this.options.dataRoot, 'containers', this.client.namespace, id)
    }

    /**
     * The file of the logs of a container
     * @param id
     */
    public logFile(id: string): string {
        return path.join(this.stateDir(id), `${id}.log`)
    }

    /**
     * The state written of a container
     * @param id
     */
    protected async readState(id: string): Promise<StoredState> {
        try {
            return JSON.parse(await readFile(path.join(this.stateDir(id), 'state.json'), 'utf8')) as StoredState
        } catch {
            return {}
        }
    }

    protected async writeState(id: string, state: StoredState): Promise<void> {
        await mkdir(this.stateDir(id), {recursive: true})
        await writeFile(path.join(this.stateDir(id), 'state.json'), JSON.stringify({...await this.readState(id), ...state}))
    }

    /**
     * The settings a container was created with by the component (its update creates it again with them)
     * @param id
     */
    public async readSettings<T = Record<string, any>>(id: string): Promise<T | undefined> {
        try {
            return JSON.parse(await readFile(path.join(this.stateDir(id), 'settings.json'), 'utf8')) as T
        } catch {
            return undefined
        }
    }

    public async writeSettings(id: string, settings: object): Promise<void> {
        await mkdir(this.stateDir(id), {recursive: true})
        await writeFile(path.join(this.stateDir(id), 'settings.json'), JSON.stringify(settings))
    }

    /**
     * Name a container again (its label of nerdctl)
     * @param container
     * @param name
     */
    public async rename(container: Message, name: string): Promise<void> {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) throw new Error(`The name of a container "${name}" is not valid ([a-zA-Z0-9][a-zA-Z0-9_.-]*)`)
        const used: Message[] = await this.client.listContainers([`labels."${ContainerLabels.NAME}"==${name}`])
        if (used.some((other: Message): boolean => other.id !== container.id)) throw Object.assign(new Error(`The name ${name} is used by another container`), {code: 'CONFLICT'})
        await this.label(container, {[ContainerLabels.NAME]: name})
    }

    /**
     * Find a container: by its identifier, by its name, by a prefix of its identifier (only one)
     * @param idOrName
     */
    public async find(idOrName: string): Promise<Message | undefined> {
        const byId: Message | undefined = await this.client.getContainer(idOrName)
        if (byId) return byId
        const byName: Message[] = await this.client.listContainers([`labels."${ContainerLabels.NAME}"==${idOrName}`])
        if (byName.length) return byName[0]
        if (!/^[0-9a-f]{3,}$/.test(idOrName)) return undefined
        const byPrefix: Message[] = (await this.client.listContainers()).filter((container: Message): boolean => container.id.startsWith(idOrName))
        if (byPrefix.length > 1) throw new Error(`The prefix ${idOrName} names ${byPrefix.length} containers`)
        return byPrefix[0]
    }

    /**
     * The containers
     * @param filters the filters of containerd (labels."app"==web)
     */
    public async list(filters: string[] = []): Promise<Message[]> {
        return await this.client.listContainers(filters)
    }

    /**
     * The devices of a host path (a device, or the ones of a directory)
     * @param mapping
     */
    protected async devices(mapping: ContainerDeviceMapping): Promise<SpecDevice[]> {
        const stats: BigIntStats = await stat(mapping.hostPath, {bigint: true})
        const containerPath: string = mapping.containerPath ?? mapping.hostPath
        if (stats.isDirectory()) {
            const devices: SpecDevice[] = []
            for (const entry of await readdir(mapping.hostPath)) {
                devices.push(...await this.devices({hostPath: path.join(mapping.hostPath, entry), containerPath: path.posix.join(containerPath, entry), permissions: mapping.permissions}).catch((): SpecDevice[] => []))
            }
            return devices
        }
        if (!stats.isCharacterDevice() && !stats.isBlockDevice()) throw new Error(`${mapping.hostPath} is not a device`)
        return [ContainerStore.Device(mapping.hostPath, containerPath, stats, mapping.permissions ?? 'rwm')]
    }

    /**
     * A device of the host, by the stats of its node (its major and minor numbers of its rdev, as glibc splits it)
     * @param hostPath
     * @param containerPath
     * @param stats
     * @param permissions
     */
    protected static Device(hostPath: string, containerPath: string, stats: BigIntStats, permissions: string): SpecDevice {
        const rdev: bigint = stats.rdev
        return {
            path: hostPath,
            containerPath: containerPath,
            type: stats.isCharacterDevice() ? 'c' : 'b',
            major: Number(((rdev >> 8n) & 0xfffn) | ((rdev >> 32n) & ~0xfffn)),
            minor: Number((rdev & 0xffn) | ((rdev >> 12n) & ~0xffn)),
            fileMode: Number(stats.mode & 0o777n),
            uid: Number(stats.uid),
            gid: Number(stats.gid),
            permissions: permissions
        }
    }

    /**
     * The devices of the host given to a privileged container, as containerd's WithHostDevices gives them: the
     * character and block devices of /dev and of its subdirectories, without the links, the console and the directories
     * of the pseudo terminals, the shared memory, the descriptors and the queues
     * @param directory
     */
    protected async hostDevices(directory: string = '/dev'): Promise<SpecDevice[]> {
        const devices: SpecDevice[] = []
        const entries = await readdir(directory, {withFileTypes: true}).catch((): [] => [])
        for (const entry of entries) {
            const entryPath: string = path.join(directory, entry.name)
            if (entry.isDirectory()) {
                if (!['pts', 'shm', 'fd', 'mqueue', '.lxc', '.lxd-mounts', '.udev'].includes(entry.name)) devices.push(...await this.hostDevices(entryPath))
                continue
            }
            if (entry.name === 'console' || (!entry.isCharacterDevice() && !entry.isBlockDevice())) continue
            //Removed meanwhile
            const stats: BigIntStats | undefined = await lstat(entryPath, {bigint: true}).catch((): undefined => undefined)
            if (stats && (stats.isCharacterDevice() || stats.isBlockDevice())) devices.push(ContainerStore.Device(entryPath, entryPath, stats, 'rwm'))
        }
        return devices
    }

    /**
     * The arguments of the process of a container: its entrypoint and its command, as Docker composes them
     * @param resolved
     * @param options
     */
    protected args(resolved: ResolvedImage, options: ContainerCreateOptions): string[] {
        const config = resolved.config.config ?? {}
        const entrypoint: string[] = options.entrypoint ?? config.Entrypoint ?? []
        //An entrypoint given resets the command of the image
        const cmd: string[] = options.cmd ?? (options.entrypoint ? [] : config.Cmd ?? [])
        const args: string[] = [...entrypoint.filter((part: string, index: number): boolean => !(index === 0 && part === '' && entrypoint.length === 1)), ...cmd]
        if (!args.length) throw new Error(`The image ${resolved.name} has no command: give the command of the container`)
        return args
    }

    /**
     * Create a container of an image: its snapshot (its root file system, the image unpacked), its specification, its
     * state directory (its hosts, resolv.conf, hostname, logs)
     * @param options
     */
    public async create(options: ContainerCreateOptions): Promise<Message> {
        const platform: Platform = options.platform ?? HostPlatform()
        const resolved: ResolvedImage = await this.images.resolve(options.image, platform)
        const id: string = randomBytes(32).toString('hex')
        const name: string = options.name ?? `${resolved.name.split('/').pop()!.split(/[:@]/)[0].replace(/[^a-zA-Z0-9_.-]/g, '')}-${id.slice(0, 5)}`
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) throw new Error(`The name of a container "${name}" is not valid ([a-zA-Z0-9][a-zA-Z0-9_.-]*)`)
        if ((await this.client.listContainers([`labels."${ContainerLabels.NAME}"==${name}`])).length) throw Object.assign(new Error(`The name ${name} is used by another container`), {code: 'CONFLICT'})
        const network: 'host' | 'none' | 'cni' = Array.isArray(options.network) ? 'cni' : options.network ?? 'host'
        const cniNetworks: { network: CNINetwork, ip?: string, ipv6?: string }[] = await this.cniNetworks(options.network)
        const ports: PortMapping[] = options.ports ?? []
        if (ports.length && network !== 'cni') throw new Error(`The ports of a container are published on its networks of CNI (${DEFAULT_NETWORK}), not on the network ${network}`)
        const hostname: string = options.hostname ?? (network === 'host' ? osHostname() : id.slice(0, 12))
        const lease: string = await this.client.createLease()
        const stateDir: string = this.stateDir(id)
        try {
            const chain: string[] = ChainIds(resolved.config.rootfs?.diff_ids ?? [])
            const parent: string = chain[chain.length - 1] ?? ''
            if (parent && !(await this.client.statSnapshot(this.options.snapshotter, parent))) await this.images.unpack(resolved.manifest, lease)
            const mounts: SnapshotMount[] = await this.client.prepareSnapshot(this.options.snapshotter, id, parent, {}, lease)
            const user: ProcessUser = await ResolveUser(mounts, options.user ?? resolved.config.config?.User)
            //The environment: the one of the image, PATH, HOSTNAME, HOME, the one given
            const env: Map<string, string> = new Map([['PATH', '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin']])
            for (const entry of resolved.config.config?.Env ?? []) env.set(entry.split('=')[0], entry.slice(entry.indexOf('=') + 1))
            env.set('HOSTNAME', hostname)
            if (!env.has('HOME')) env.set('HOME', user.home)
            for (const [key, value] of Object.entries(options.env ?? {})) env.set(key, value)
            if (options.terminal && !env.has('TERM')) env.set('TERM', 'xterm')
            //The files of the network of the container
            await mkdir(stateDir, {recursive: true})
            const hostHosts: string = network === 'host' ? await readFile('/etc/hosts', 'utf8').catch((): string => '') : ''
            const hosts: string[] = [hostHosts.trimEnd() || '127.0.0.1\tlocalhost localhost.localdomain\n::1\tlocalhost localhost.localdomain ip6-localhost ip6-loopback']
            if (network === 'none') hosts.push(`127.0.0.1\t${hostname}`)
            for (const [host, address] of Object.entries(options.extraHosts ?? {})) hosts.push(`${address}\t${host}`)
            //The hosts of the networks of CNI: the address of the container added by its hook
            await writeFile(path.join(stateDir, 'hosts.base'), hosts.join('\n') + '\n')
            await writeFile(path.join(stateDir, 'hosts'), hosts.join('\n') + '\n')
            await writeFile(path.join(stateDir, 'resolv.conf'), options.dns?.length ? options.dns.map((server: string): string => `nameserver ${server}`).join('\n') + '\n' : ResolvConf(await readFile('/etc/resolv.conf', 'utf8').catch((): string => ''), network !== 'host'))
            await writeFile(path.join(stateDir, 'hostname'), hostname + '\n')
            await writeFile(this.logFile(id), '')
            const specMounts: SpecMount[] = [
                {source: path.join(stateDir, 'hosts'), destination: '/etc/hosts', options: ['bind', 'rprivate']},
                {source: path.join(stateDir, 'resolv.conf'), destination: '/etc/resolv.conf', options: ['bind', 'rprivate']},
                {source: path.join(stateDir, 'hostname'), destination: '/etc/hostname', options: ['bind', 'rprivate']}
            ]
            for (const mount of options.mounts ?? []) {
                if (mount.type === 'tmpfs') {
                    specMounts.push({type: 'tmpfs', source: 'tmpfs', destination: mount.target, options: ['nosuid', 'nodev', 'noexec', ...mount.options ?? [], ...mount.readonly ? ['ro'] : []]})
                } else if (mount.type === 'volume') {
                    if (!mount.source) throw new Error(`The volume mounted on ${mount.target} has no name`)
                    const volume: Volume = await this.volumes.create(mount.source)
                    specMounts.push({type: 'bind', source: volume.mountpoint, destination: mount.target, options: ['rbind', 'rprivate', mount.readonly ? 'ro' : 'rw']})
                } else {
                    if (!mount.source) throw new Error(`The bind mount of ${mount.target} has no source`)
                    const source: string = path.resolve(mount.source)
                    await mkdir(source, {recursive: true}).catch((): undefined => undefined)
                    specMounts.push({type: 'bind', source: source, destination: mount.target, options: ['rbind', ...mount.options?.length ? mount.options : ['rprivate'], mount.readonly ? 'ro' : 'rw']})
                }
            }
            const devices: SpecDevice[] = []
            for (const device of options.devices ?? []) devices.push(...await this.devices(device))
            //The devices of the host in its /dev (its cgroup allows them all), the ones given kept
            if (options.privileged) devices.push(...(await this.hostDevices()).filter((device: SpecDevice): boolean => !devices.some((given: SpecDevice): boolean => given.containerPath === device.containerPath)))
            let hooks: Record<string, { path: string, args: string[], timeout: number }[]> | undefined
            if (network === 'cni') {
                if (!this.networks.pluginDirectories().length) throw new Error(`The plugins of CNI are not installed (${this.networks.cniPath.join(', ')}): install them (the package containernetworking-plugins, or the CNI plugins release in /opt/cni/bin), or give the container the network 'host'`)
                await this.networks.render(stateDir, id, cniNetworks, ports)
                const hook: string = path.join(stateDir, 'network', 'hook.sh')
                hooks = {
                    createRuntime: [{path: '/bin/sh', args: ['sh', hook, 'add', stateDir], timeout: 120}],
                    poststop: [{path: '/bin/sh', args: ['sh', hook, 'del', stateDir], timeout: 120}]
                }
            }
            const spec: Record<string, any> = GenerateSpec({
                id: id,
                namespace: this.client.namespace,
                args: this.args(resolved, options),
                env: [...env].map(([key, value]): string => `${key}=${value}`),
                cwd: options.workingDir ?? resolved.config.config?.WorkingDir ?? '/',
                uid: user.uid,
                gid: user.gid,
                additionalGids: user.additionalGids,
                hostname: hostname,
                terminal: options.terminal,
                privileged: options.privileged,
                readonlyRootfs: options.readonlyRootfs,
                capAdd: options.capAdd,
                capDrop: options.capDrop,
                seccomp: await this.seccomp(options),
                mounts: specMounts,
                devices: devices,
                deviceCgroupRules: (options.deviceCgroupRules ?? []).map(ParseDeviceCgroupRule),
                network: {mode: network},
                hooks: hooks,
                pidHost: options.pidHost,
                ipcHost: options.ipcHost,
                cgroupNamespace: (options.cgroupns ?? 'private') === 'private' && existsSync('/sys/fs/cgroup/cgroup.controllers'),
                cgroupsPath: this.options.cgroupManager === 'systemd' ? `system.slice:lakutata:${id}` : `/${this.client.namespace}/${id}`,
                memory: options.memory,
                memorySwap: SwapLimit(options.memory, options.memorySwap),
                cpuQuota: options.cpus ? Math.round(options.cpus * 100000) : undefined,
                cpuShares: options.cpuShares,
                cpuset: options.cpuset,
                pidsLimit: options.pidsLimit,
                oomKillDisable: options.oomKillDisable,
                sysctls: options.sysctls,
                shmSize: options.shmSize
            })
            const logUri: string = `file://${this.logFile(id)}`
            const labels: Record<string, string> = {
                ...resolved.config.config?.Labels ?? {},
                ...options.labels ?? {},
                [ContainerLabels.NAME]: name,
                [ContainerLabels.HOSTNAME]: hostname,
                [ContainerLabels.PLATFORM]: FormatPlatform(resolved.platform),
                [ContainerLabels.LOG_URI]: logUri,
                [ContainerLabels.STATE_DIR]: stateDir,
                [ContainerLabels.NETWORKS]: JSON.stringify(network === 'cni' ? cniNetworks.map((item): string => item.network.name) : [network]),
                [ContainerLabels.PORTS]: JSON.stringify(ports.map((port: PortMapping): object => ({HostPort: port.hostPort, ContainerPort: port.containerPort, Protocol: port.protocol, HostIP: port.hostIP || '0.0.0.0'}))),
                [ContainerLabels.MOUNTS]: JSON.stringify((options.mounts ?? []).map((mount: ContainerMount): object => mount.type === 'volume'
                    ? {Type: 'volume', Name: mount.source, Source: path.join(this.volumes.directory, mount.source!, '_data'), Destination: mount.target, RW: !mount.readonly}
                    : {Type: mount.type ?? 'bind', Source: mount.source ?? '', Destination: mount.target, RW: !mount.readonly}))
            }
            const stopSignal: string | undefined = options.stopSignal ?? resolved.config.config?.StopSignal
            if (stopSignal) labels[ContainerLabels.STOP_SIGNAL] = stopSignal
            if (options.restart && options.restart !== 'no') {
                labels[ContainerLabels.RESTART_POLICY] = options.restart
                labels[ContainerLabels.RESTART_LOG_URI] = logUri
                labels[ContainerLabels.RESTART_STATUS] = 'stopped'
            }
            const runtime: Message = {name: this.options.runtime}
            if (this.options.cgroupManager === 'systemd') runtime.options = {typeUrl: 'containerd.runc.v1.Options', value: Encode(M.RuncOptions, {systemdCgroup: true})}
            return await this.client.createContainer({
                id: id,
                labels: labels,
                image: resolved.name,
                runtime: runtime,
                spec: ContainerdClient.Json(SPEC_TYPE_URL, spec),
                snapshotter: this.options.snapshotter,
                snapshotKey: id
            }, lease)
        } catch (error: unknown) {
            await this.client.removeSnapshot(this.options.snapshotter, id).catch((): undefined => undefined)
            await rm(stateDir, {recursive: true, force: true})
            throw error
        } finally {
            await this.client.deleteLease(lease)
        }
    }

    /**
     * The state of a container: the one of its task, its last exit when it has none
     * @param container
     */
    public async state(container: Message): Promise<ContainerRuntimeState> {
        const stored: StoredState = await this.readState(container.id)
        const task: Message | undefined = await this.client.getTask(container.id)
        const restarting: boolean = container.labels?.[ContainerLabels.RESTART_STATUS] === 'running'
        const state: ContainerRuntimeState = {
            status: 'created',
            running: false,
            paused: false,
            pid: 0,
            exitCode: stored.exitCode ?? 0,
            startedAt: stored.startedAt ? new Date(stored.startedAt) : null,
            finishedAt: stored.finishedAt ? new Date(stored.finishedAt) : null
        }
        if (!task) {
            state.status = stored.startedAt ? 'exited' : 'created'
            //Its restart monitor recreates its task
            if (restarting && stored.startedAt) state.status = 'restarting'
            return state
        }
        state.pid = task.pid ?? 0
        switch (task.status) {
            case M.ProcessStatus.RUNNING:
                state.status = 'running'
                state.running = true
                break
            case M.ProcessStatus.PAUSED:
                state.status = 'paused'
                state.paused = true
                break
            case M.ProcessStatus.PAUSING:
                state.status = 'pausing'
                break
            case M.ProcessStatus.STOPPED:
                state.status = restarting ? 'restarting' : 'exited'
                state.exitCode = task.exitStatus ?? 0
                state.finishedAt = TimestampDate(task.exitedAt) ?? state.finishedAt
                break
            case M.ProcessStatus.CREATED:
                state.status = 'created'
                break
            default:
                state.status = 'unknown'
        }
        return state
    }

    /**
     * Rotate the logs of a container once they are larger than the size of the options: copied to the file .1, the
     * file truncated (the shim writes to its end)
     * @param id
     */
    public async rotateLogs(id: string): Promise<void> {
        if (!this.options.logMaxSize) return
        const file: string = this.logFile(id)
        const size: number = (await stat(file).catch((): undefined => undefined))?.size ?? 0
        if (size <= this.options.logMaxSize) return
        await copyFile(file, `${file}.1`)
        await truncate(file, 0)
    }

    /**
     * Delete the task of a container (stopped), its exit kept
     * @param id
     */
    protected async deleteTask(id: string): Promise<void> {
        const deleted: Message | undefined = await this.client.deleteTask(id).catch(async (error: unknown): Promise<Message | undefined> => {
            //A task still running (a stop of its restart monitor meanwhile): killed
            if (!IsGRPCError(error, GRPCStatus.FAILED_PRECONDITION)) throw error
            await this.client.kill(id, SignalNumber('SIGKILL'), {all: true}).catch((): undefined => undefined)
            await this.client.wait(id).catch((): undefined => undefined)
            return await this.client.deleteTask(id)
        })
        if (deleted) await this.writeState(id, {exitCode: deleted.exitStatus ?? 0, finishedAt: (TimestampDate(deleted.exitedAt) ?? new Date()).toISOString()})
    }

    /**
     * Set the labels of a container
     * @param container
     * @param labels
     */
    protected async label(container: Message, labels: Record<string, string>): Promise<void> {
        await this.client.updateContainer({id: container.id, labels: labels}, Object.keys(labels).map((key: string): string => `labels.${key}`))
    }

    /**
     * Start a container: a new task of its snapshot (the one of its previous run deleted), its output written to its
     * logs
     * @param container
     */
    public async start(container: Message): Promise<number> {
        const task: Message | undefined = await this.client.getTask(container.id)
        if (task?.status === M.ProcessStatus.RUNNING) return task.pid
        if (task?.status === M.ProcessStatus.PAUSED) throw Object.assign(new Error(`The container ${container.id} is paused: resume it`), {code: 'PAUSED'})
        if (task) await this.deleteTask(container.id)
        await this.rotateLogs(container.id)
        const logUri: string = container.labels?.[ContainerLabels.LOG_URI] ?? `file://${this.logFile(container.id)}`
        await mkdir(path.dirname(this.logFile(container.id)), {recursive: true})
        const rootfs: SnapshotMount[] = await this.client.snapshotMounts(container.snapshotter || this.options.snapshotter, container.snapshotKey || container.id)
        await this.client.createTask({containerId: container.id, rootfs: rootfs, stdout: logUri, stderr: logUri}).catch((error: unknown): never => {
            throw SeccompHint(error)
        })
        try {
            const pid: number = await this.client.startTask(container.id).catch((error: unknown): never => {
                throw SeccompHint(error)
            })
            await this.writeState(container.id, {startedAt: new Date().toISOString(), finishedAt: undefined, exitCode: undefined})
            if (container.labels?.[ContainerLabels.RESTART_POLICY]) await this.label(container, {[ContainerLabels.RESTART_STATUS]: 'running'})
            return pid
        } catch (error: unknown) {
            await this.client.deleteTask(container.id).catch((): undefined => undefined)
            throw error
        }
    }

    /**
     * Wait for the task of a container to exit, at most a time
     * @param id
     * @param timeout milliseconds
     */
    protected async waitExit(id: string, timeout: number): Promise<boolean> {
        const abort: AbortController = new AbortController()
        const timer: NodeJS.Timeout = setTimeout((): void => abort.abort(), timeout)
        try {
            await this.client.wait(id, '', abort.signal)
            return true
        } catch (error: unknown) {
            if (abort.signal.aborted) return false
            if (IsGRPCError(error, GRPCStatus.NOT_FOUND)) return true
            throw error
        } finally {
            clearTimeout(timer)
        }
    }

    /**
     * Stop a container: its stop signal (SIGTERM, the one of its image) sent, then SIGKILL to all its processes after a
     * time; its task deleted, its restart monitor told not to restart it
     * @param container
     * @param options
     */
    public async stop(container: Message, options: { timeout?: number, signal?: string | number } = {}): Promise<void> {
        if (container.labels?.[ContainerLabels.RESTART_POLICY]) await this.label(container, {[ContainerLabels.RESTART_STATUS]: 'stopped'})
        const task: Message | undefined = await this.client.getTask(container.id)
        if (!task) return
        if (task.status === M.ProcessStatus.PAUSED) await this.client.resume(container.id)
        if (task.status === M.ProcessStatus.RUNNING || task.status === M.ProcessStatus.PAUSED) {
            const signal: number = SignalNumber(options.signal ?? container.labels?.[ContainerLabels.STOP_SIGNAL] ?? 'SIGTERM')
            await this.client.kill(container.id, signal).catch((error: unknown): void => {
                if (!IsGRPCError(error, GRPCStatus.NOT_FOUND)) throw error
            })
            if (!(await this.waitExit(container.id, (options.timeout ?? 10) * 1000))) {
                await this.client.kill(container.id, SignalNumber('SIGKILL'), {all: true}).catch((): undefined => undefined)
                await this.waitExit(container.id, 10000)
            }
        }
        await this.deleteTask(container.id)
    }

    /**
     * Send a signal to a container (its main process, or all its processes)
     * @param container
     * @param signal
     * @param all
     */
    public async kill(container: Message, signal: string | number = 'SIGKILL', all: boolean = false): Promise<void> {
        if (SignalNumber(signal) === SignalNumber('SIGKILL') && container.labels?.[ContainerLabels.RESTART_POLICY]) await this.label(container, {[ContainerLabels.RESTART_STATUS]: 'stopped'})
        await this.client.kill(container.id, SignalNumber(signal), {all: all}).catch((error: unknown): never => {
            throw this.taskError(container, error)
        })
    }

    public async pause(container: Message): Promise<void> {
        await this.running(container)
        await this.client.pause(container.id).catch((error: unknown): never => {
            throw this.taskError(container, error)
        })
    }

    public async resume(container: Message): Promise<void> {
        await this.running(container)
        await this.client.resume(container.id).catch((error: unknown): never => {
            throw this.taskError(container, error)
        })
    }

    /**
     * Check that a container has a task which did not exit (the shim refuses to pause or resume a stopped one with an
     * error of no code)
     * @param container
     * @protected
     */
    protected async running(container: Message): Promise<void> {
        const task: Message | undefined = await this.client.getTask(container.id)
        if (!task || task.status === M.ProcessStatus.STOPPED) throw Object.assign(new Error(`The container ${ContainerStore.Name(container)} is not running`), {code: 'NOT_RUNNING'})
    }

    /**
     * The processes of a running container (their identifiers on the host)
     * @param container
     */
    public async processes(container: Message): Promise<number[]> {
        return await this.client.listPids(container.id).catch((error: unknown): never => {
            throw this.taskError(container, error)
        })
    }

    /**
     * Wait for the main process of a container to exit: its exit code; the last one at once when it has no task (never
     * started: 0, stopped: its task deleted, its exit kept by the store)
     * @param container
     * @param signal
     */
    public async wait(container: Message, signal?: AbortSignal): Promise<number> {
        try {
            return (await this.client.wait(container.id, '', signal)).exitStatus
        } catch (error: unknown) {
            if (!IsGRPCError(error, GRPCStatus.NOT_FOUND)) throw error
            return (await this.readState(container.id)).exitCode ?? 0
        }
    }

    /**
     * The error of an operation on the task of a container: the container is not running when it has no task (or its
     * process exited)
     * @param container
     * @param error
     * @protected
     */
    protected taskError(container: Message, error: unknown): unknown {
        if (!IsGRPCError(error, GRPCStatus.NOT_FOUND)) return error
        return Object.assign(new Error(`The container ${ContainerStore.Name(container)} is not running (${error.message})`, {cause: error}), {code: 'NOT_RUNNING'})
    }

    /**
     * Remove a container: its task (a running one only when forced), its snapshot, its state directory
     * @param container
     * @param force
     */
    public async remove(container: Message, force: boolean = false): Promise<void> {
        const task: Message | undefined = await this.client.getTask(container.id)
        if (task && task.status !== M.ProcessStatus.STOPPED && task.status !== M.ProcessStatus.CREATED) {
            if (!force) throw Object.assign(new Error(`The container ${ContainerStore.Name(container)} is running: stop it or remove it by force`), {code: 'RUNNING'})
            if (container.labels?.[ContainerLabels.RESTART_POLICY]) await this.label(container, {[ContainerLabels.RESTART_STATUS]: 'stopped'})
            if (task.status === M.ProcessStatus.PAUSED) await this.client.resume(container.id).catch((): undefined => undefined)
            await this.client.kill(container.id, SignalNumber('SIGKILL'), {all: true}).catch((): undefined => undefined)
            await this.waitExit(container.id, 10000)
        }
        if (task) await this.client.deleteTask(container.id).catch((): undefined => undefined)
        //The networks its hook did not delete
        await this.networks.teardown(this.stateDir(container.id))
        await this.client.deleteContainer(container.id)
        await this.client.removeSnapshot(container.snapshotter || this.options.snapshotter, container.snapshotKey || container.id)
        await rm(this.stateDir(container.id), {recursive: true, force: true})
    }

    /**
     * Execute a command in a running container, its output captured: its standard output and its error apart (FIFOs,
     * mkfifo of the system), or together in its standard output without mkfifo (the files of the shim)
     * @param container
     * @param options
     */
    public async exec(container: Message, options: { cmd: string[], env?: Record<string, string>, workingDir?: string, user?: string, stdin?: string | Buffer, timeout?: number }): Promise<ExecResult> {
        const task: Message | undefined = await this.client.getTask(container.id)
        if (task?.status !== M.ProcessStatus.RUNNING) throw Object.assign(new Error(`The container ${ContainerStore.Name(container)} is not running`), {code: 'NOT_RUNNING'})
        const spec: Record<string, any> = ContainerdClient.FromJson(container.spec) ?? {}
        let user: ProcessUser | undefined
        if (options.user) user = await ResolveUser(await this.client.snapshotMounts(container.snapshotter || this.options.snapshotter, container.snapshotKey || container.id), options.user)
        const process: Record<string, any> = ExecProcessSpec(spec, {
            args: options.cmd,
            env: Object.entries(options.env ?? {}).map(([key, value]): string => `${key}=${value}`),
            cwd: options.workingDir,
            uid: user?.uid,
            gid: user?.gid,
            additionalGids: user?.additionalGids
        })
        const execId: string = `exec-${randomBytes(8).toString('hex')}`
        const directory: string = path.join(this.stateDir(container.id), 'exec')
        await mkdir(directory, {recursive: true})
        const files: string[] = []
        const fifos: ProcessFifo[] = []
        const fifo: boolean = ProcessFifo.Supported()
        if (!fifo && options.stdin !== undefined) throw new Error('The standard input of an execution needs mkfifo')
        try {
            let stdout: ProcessFifo | undefined, stderr: ProcessFifo | undefined, stdin: ProcessFifo | undefined
            let request: Message
            if (fifo) {
                stdout = ProcessFifo.Create(path.join(directory, `${execId}-stdout`), 'read')
                stderr = ProcessFifo.Create(path.join(directory, `${execId}-stderr`), 'read')
                fifos.push(stdout, stderr)
                if (options.stdin !== undefined) fifos.push(stdin = ProcessFifo.Create(path.join(directory, `${execId}-stdin`), 'write'))
                request = {stdout: stdout.path, stderr: stderr.path, stdin: stdin?.path ?? ''}
            } else {
                const output: string = path.join(directory, `${execId}.log`)
                files.push(output)
                await writeFile(output, '')
                request = {stdout: `file://${output}`, stderr: `file://${output}`}
            }
            files.push(...fifos.map((item: ProcessFifo): string => item.path))
            await this.client.exec({containerId: container.id, execId: execId, ...request, spec: ContainerdClient.Json(PROCESS_TYPE_URL, process)})
            const waiting: Promise<{ exitStatus: number }> = this.client.wait(container.id, execId)
            waiting.catch((): undefined => undefined)
            await this.client.startTask(container.id, execId)
            const read = (item: ProcessFifo | undefined): Promise<string> => {
                if (!item) return Promise.resolve('')
                const socket = item.open()
                const chunks: Buffer[] = []
                return new Promise((resolve: (value: string) => void): void => {
                    socket.on('data', (chunk: Buffer): unknown => chunks.push(chunk))
                    socket.on('error', (): void => resolve(Buffer.concat(chunks).toString('utf8')))
                    socket.on('end', (): void => resolve(Buffer.concat(chunks).toString('utf8')))
                })
            }
            const outputs: Promise<[string, string]> = Promise.all([read(stdout), read(stderr)])
            if (stdin) {
                //Written and closed, then the writer of the shim closed (CloseIO): the end of the input once read
                const writer = stdin.open()
                await new Promise<void>((resolve: () => void): void => void writer.end(options.stdin ?? '', (): void => resolve()))
                await this.client.closeIO(container.id, execId).catch((): undefined => undefined)
            }
            const timer: NodeJS.Timeout | undefined = options.timeout ? setTimeout((): void => {
                this.client.kill(container.id, SignalNumber('SIGKILL'), {execId: execId}).catch((): undefined => undefined)
            }, options.timeout) : undefined
            try {
                const {exitStatus} = await waiting
                if (!fifo) return {exitCode: exitStatus, stdout: await readFile(files[0], 'utf8'), stderr: ''}
                const [out, err] = await outputs
                return {exitCode: exitStatus, stdout: out, stderr: err}
            } finally {
                clearTimeout(timer)
            }
        } finally {
            fifos.forEach((item: ProcessFifo): void => item.close())
            await this.client.deleteProcess(container.id, execId).catch((): undefined => undefined)
            for (const file of files) await rm(file, {force: true})
        }
    }

    /**
     * The logs of a container: its last lines, followed while it runs (until the signal aborts)
     * @param container
     * @param options
     */
    public logs(container: Message, options: { tail?: number, follow?: boolean, signal?: AbortSignal } = {}): Readable {
        const file: string = this.logFile(container.id)
        const store: ContainerStore = this
        return Readable.from((async function* (): AsyncGenerator<Buffer> {
            let content: Buffer = Buffer.concat([await readFile(`${file}.1`).catch((): Buffer => Buffer.alloc(0)), await readFile(file).catch((): Buffer => Buffer.alloc(0))])
            let offset: number = (await stat(file).catch((): undefined => undefined))?.size ?? 0
            if (options.tail !== undefined && options.tail >= 0) {
                let end: number = content.length
                if (content[end - 1] === 0x0a) end--
                let start: number = end
                for (let lines = 0; start > 0; start--) {
                    if (content[start - 1] === 0x0a && ++lines >= options.tail) break
                }
                content = options.tail === 0 ? Buffer.alloc(0) : content.subarray(start)
            }
            if (content.length) yield content
            if (!options.follow) return
            let idle: number = 0
            while (!options.signal?.aborted) {
                const size: number = (await stat(file).catch((): undefined => undefined))?.size ?? 0
                //Rotated: read from its start
                if (size < offset) offset = 0
                if (size > offset) {
                    const handle = await open(file, 'r')
                    try {
                        const buffer: Buffer = Buffer.alloc(size - offset)
                        await handle.read(buffer, 0, buffer.length, offset)
                        offset = size
                        yield buffer
                    } finally {
                        await handle.close()
                    }
                    continue
                }
                //Every second, whether it still runs
                if (++idle % 4 === 0) {
                    const task: Message | undefined = await store.client.getTask(container.id)
                    //Stopped, and not restarted by its restart monitor
                    if ((!task || task.status === M.ProcessStatus.STOPPED) && (await store.client.getContainer(container.id))?.labels?.[ContainerLabels.RESTART_STATUS] !== 'running') break
                }
                await sleep(250, undefined, {signal: options.signal}).catch((): undefined => undefined)
            }
        })())
    }

    /**
     * A sample of the resources a running container uses
     * @param container
     * @protected
     */
    protected async sample(container: Message): Promise<Omit<ContainerResourceStats, 'cpu'> & { cpu: Omit<ContainerResourceStats['cpu'], 'percent'> }> {
        const task: Message | undefined = await this.client.getTask(container.id)
        if (task?.status !== M.ProcessStatus.RUNNING && task?.status !== M.ProcessStatus.PAUSED) throw Object.assign(new Error(`The container ${ContainerStore.Name(container)} is not running`), {code: 'NOT_RUNNING'})
        const metric: Message | undefined = await this.client.metrics(container.id)
        const type: string = String(metric?.data?.typeUrl ?? '')
        const data: Uint8Array = metric?.data?.value ?? new Uint8Array()
        const unlimited = (value: number): number => !value || value >= 2 ** 62 ? totalmem() : value
        const onlineCpus: number = availableParallelism()
        const stats: Omit<ContainerResourceStats, 'cpu'> & { cpu: Omit<ContainerResourceStats['cpu'], 'percent'> } = {
            read: TimestampDate(metric?.timestamp) ?? new Date(),
            pids: {current: 0, limit: 0},
            cpu: {usage: 0, user: 0, system: 0, throttledPeriods: 0, throttledTime: 0, onlineCpus: onlineCpus},
            memory: {usage: 0, workingSet: 0, limit: totalmem(), cache: 0, swap: 0, oomKills: 0},
            blkio: {readBytes: 0, writeBytes: 0, readOps: 0, writeOps: 0},
            networks: {}
        }
        if (type.endsWith('cgroups.v2.Metrics')) {
            const metrics: Message = Counters(Decode(M.CgroupV2Metrics, data))
            stats.pids = {current: metrics.pids?.current ?? 0, limit: metrics.pids?.limit ?? 0}
            stats.cpu = {
                usage: (metrics.cpu?.usageUsec ?? 0) * 1000,
                user: (metrics.cpu?.userUsec ?? 0) * 1000,
                system: (metrics.cpu?.systemUsec ?? 0) * 1000,
                throttledPeriods: metrics.cpu?.nrThrottled ?? 0,
                throttledTime: (metrics.cpu?.throttledUsec ?? 0) * 1000,
                onlineCpus: onlineCpus
            }
            const usage: number = metrics.memory?.usage ?? 0
            stats.memory = {
                usage: usage,
                workingSet: Math.max(0, usage - (metrics.memory?.inactiveFile ?? 0)),
                limit: unlimited(metrics.memory?.usageLimit ?? 0),
                cache: metrics.memory?.file ?? 0,
                swap: metrics.memory?.swapUsage ?? 0,
                oomKills: metrics.memoryEvents?.oomKill ?? 0
            }
            for (const entry of metrics.io?.usage ?? []) {
                stats.blkio.readBytes += entry.rbytes ?? 0
                stats.blkio.writeBytes += entry.wbytes ?? 0
                stats.blkio.readOps += entry.rios ?? 0
                stats.blkio.writeOps += entry.wios ?? 0
            }
        } else if (type.endsWith('cgroups.v1.Metrics')) {
            const metrics: Message = Counters(Decode(M.CgroupV1Metrics, data))
            stats.pids = {current: metrics.pids?.current ?? 0, limit: metrics.pids?.limit ?? 0}
            stats.cpu = {
                usage: metrics.cpu?.usage?.total ?? 0,
                user: metrics.cpu?.usage?.user ?? 0,
                system: metrics.cpu?.usage?.kernel ?? 0,
                throttledPeriods: metrics.cpu?.throttling?.throttledPeriods ?? 0,
                throttledTime: metrics.cpu?.throttling?.throttledTime ?? 0,
                onlineCpus: metrics.cpu?.usage?.perCpu?.length || onlineCpus
            }
            const usage: number = metrics.memory?.usage?.usage ?? 0
            stats.memory = {
                usage: usage,
                workingSet: Math.max(0, usage - (metrics.memory?.totalInactiveFile ?? 0)),
                limit: unlimited(metrics.memory?.usage?.limit ?? 0),
                cache: metrics.memory?.cache ?? 0,
                swap: Math.max(0, (metrics.memory?.swap?.usage ?? 0) - usage),
                oomKills: metrics.memoryOomControl?.oomKill ?? 0
            }
            for (const entry of metrics.blkio?.ioServiceBytesRecursive ?? []) {
                if (/^read$/i.test(entry.op)) stats.blkio.readBytes += entry.value ?? 0
                if (/^write$/i.test(entry.op)) stats.blkio.writeBytes += entry.value ?? 0
            }
            for (const entry of metrics.blkio?.ioServicedRecursive ?? []) {
                if (/^read$/i.test(entry.op)) stats.blkio.readOps += entry.value ?? 0
                if (/^write$/i.test(entry.op)) stats.blkio.writeOps += entry.value ?? 0
            }
        }
        //The interfaces of its namespace of network (without its loopback)
        try {
            for (const line of (await readFile(`/proc/${task.pid}/net/dev`, 'utf8')).split('\n').slice(2)) {
                const [name, counters] = line.split(':')
                if (!counters || name.trim() === 'lo') continue
                const values: number[] = counters.trim().split(/\s+/).map(Number)
                stats.networks[name.trim()] = {
                    rxBytes: values[0], rxPackets: values[1], rxErrors: values[2], rxDropped: values[3],
                    txBytes: values[8], txPackets: values[9], txErrors: values[10], txDropped: values[11]
                }
            }
        } catch {
            //Its process is gone
        }
        return stats
    }

    /**
     * The resources a running container uses: two samples, its use of the CPUs between them
     * @param container
     * @param interval milliseconds between the samples
     */
    public async stats(container: Message, interval: number = 1000): Promise<ContainerResourceStats> {
        const first = await this.sample(container)
        if (interval <= 0) return {...first, cpu: {...first.cpu, percent: 0}}
        await sleep(interval)
        const second = await this.sample(container)
        const elapsed: number = (second.read.getTime() - first.read.getTime()) * 1e6 || interval * 1e6
        return {...second, cpu: {...second.cpu, percent: Math.max(0, (second.cpu.usage - first.cpu.usage) / elapsed * 100)}}
    }

    /**
     * Open a terminal in a running container: a process executed with its pseudo terminal, its input and its output by
     * FIFOs (mkfifo of the system)
     * @param container
     * @param options
     */
    public async terminal(container: Message, options: { cmd: string[], cols?: number, rows?: number, env?: Record<string, string>, workingDir?: string, user?: string }): Promise<ContainerTerminal> {
        const task: Message | undefined = await this.client.getTask(container.id)
        if (task?.status !== M.ProcessStatus.RUNNING) throw Object.assign(new Error(`The container ${ContainerStore.Name(container)} is not running`), {code: 'NOT_RUNNING'})
        if (!ProcessFifo.Supported()) throw new Error('The terminals of the containers need mkfifo')
        const spec: Record<string, any> = ContainerdClient.FromJson(container.spec) ?? {}
        let user: ProcessUser | undefined
        if (options.user) user = await ResolveUser(await this.client.snapshotMounts(container.snapshotter || this.options.snapshotter, container.snapshotKey || container.id), options.user)
        const env: Record<string, string> = {TERM: 'xterm', ...options.env ?? {}}
        const process: Record<string, any> = ExecProcessSpec(spec, {
            args: options.cmd,
            env: Object.entries(env).map(([key, value]): string => `${key}=${value}`),
            cwd: options.workingDir,
            uid: user?.uid,
            gid: user?.gid,
            additionalGids: user?.additionalGids,
            terminal: true
        })
        if (options.cols && options.rows) process.consoleSize = {height: options.rows, width: options.cols}
        const execId: string = `tty-${randomBytes(8).toString('hex')}`
        const directory: string = path.join(this.stateDir(container.id), 'exec')
        await mkdir(directory, {recursive: true})
        const stdin: ProcessFifo = ProcessFifo.Create(path.join(directory, `${execId}-stdin`), 'write')
        const stdout: ProcessFifo = ProcessFifo.Create(path.join(directory, `${execId}-stdout`), 'read')
        let cleaned: boolean = false
        const cleanup = async (): Promise<void> => {
            if (cleaned) return
            cleaned = true
            stdin.close()
            stdout.close()
            await this.client.deleteProcess(container.id, execId).catch((): undefined => undefined)
            await rm(stdin.path, {force: true})
            await rm(stdout.path, {force: true})
        }
        try {
            await this.client.exec({containerId: container.id, execId: execId, stdin: stdin.path, stdout: stdout.path, terminal: true, spec: ContainerdClient.Json(PROCESS_TYPE_URL, process)})
            const waiting: Promise<{ exitStatus: number }> = this.client.wait(container.id, execId)
            await this.client.startTask(container.id, execId)
            const input = stdin.open()
            const output = stdout.open()
            input.on('error', (): void => undefined)
            const exited: Promise<number> = (async (): Promise<number> => {
                try {
                    return (await waiting).exitStatus
                } finally {
                    //Its output read before the FIFOs are closed
                    if (!output.readableEnded) await new Promise<void>((resolve: () => void): void => {
                        const timer: NodeJS.Timeout = setTimeout(resolve, 1000)
                        output.once('end', (): void => {
                            clearTimeout(timer)
                            resolve()
                        })
                    })
                    await cleanup()
                }
            })()
            exited.catch((): undefined => undefined)
            return {
                execId: execId,
                input: input,
                output: output,
                resize: async (cols: number, rows: number): Promise<void> => this.client.resizePty(container.id, execId, cols, rows),
                exited: exited,
                close: async (): Promise<void> => {
                    if (cleaned) return
                    await this.client.kill(container.id, SignalNumber('SIGKILL'), {execId: execId}).catch((): undefined => undefined)
                    await exited.catch((): undefined => undefined)
                }
            }
        } catch (error: unknown) {
            await cleanup()
            throw error
        }
    }

    /**
     * Update the resources of a container (its specification, the cgroup of its running task) and its restart policy,
     * without restarting it (docker update)
     * @param container
     * @param update
     */
    public async updateResources(container: Message, update: ContainerResourceUpdate): Promise<void> {
        const spec: Record<string, any> = ContainerdClient.FromJson(container.spec) ?? {}
        const resources: Record<string, any> = spec.linux.resources ??= {}
        //The limits removed: absent from the specification, given to the task as the values of no limit (the update of
        //runc leaves a 0 or an empty value as it is)
        const removed: { memory?: true, swap?: true, shares?: true, cpus?: true } = {}
        if (update.memory !== undefined || update.memorySwap !== undefined || update.oomKillDisable !== undefined) {
            resources.memory ??= {}
            if (update.memory === 0) {
                //No swap limit without a memory limit
                delete resources.memory.limit
                delete resources.memory.swap
                removed.memory = removed.swap = true
            } else if (update.memory !== undefined) {
                //A swap limit of twice the memory (the default one) follows the memory
                if (update.memorySwap === undefined && resources.memory.limit > 0 && resources.memory.swap === resources.memory.limit * 2) resources.memory.swap = update.memory * 2
                resources.memory.limit = update.memory
            }
            if (update.memorySwap !== undefined) {
                if (update.memorySwap > 0 && !(resources.memory.limit > 0)) throw Object.assign(new Error('The swap limit of a container (memorySwap) needs its memory limit (memoryLimit)'), {code: 'INVALID_VALUE'})
                //0: no swap limit; discarded when the kernel does not limit the swap
                if (!removed.swap && SwapLimitSupported()) resources.memory.swap = update.memorySwap || -1
            }
            if (update.oomKillDisable !== undefined) resources.memory.disableOOMKiller = update.oomKillDisable
            if (resources.memory.swap > 0 && resources.memory.swap < resources.memory.limit) throw Object.assign(new Error('The swap limit of a container (memorySwap, its memory and its swap) is less than its memory limit (memoryLimit)'), {code: 'INVALID_VALUE'})
        }
        if (update.cpus !== undefined || update.cpuShares !== undefined || update.cpuset !== undefined) {
            resources.cpu ??= {}
            if (update.cpus !== undefined) {
                resources.cpu.quota = update.cpus ? Math.round(update.cpus * 100000) : -1
                resources.cpu.period = 100000
            }
            if (update.cpuShares === 0) {
                delete resources.cpu.shares
                removed.shares = true
            } else if (update.cpuShares !== undefined) {
                resources.cpu.shares = update.cpuShares
            }
            if (update.cpuset === '') {
                delete resources.cpu.cpus
                removed.cpus = true
            } else if (update.cpuset !== undefined) {
                resources.cpu.cpus = update.cpuset
            }
        }
        if (update.pidsLimit !== undefined) resources.pids = {limit: update.pidsLimit || -1}
        const labels: Record<string, string> = {}
        if (update.restart !== undefined) {
            const restart: string = update.restart === 'no' ? '' : update.restart
            labels[ContainerLabels.RESTART_POLICY] = restart
            labels[ContainerLabels.RESTART_LOG_URI] = restart ? container.labels?.[ContainerLabels.LOG_URI] ?? `file://${this.logFile(container.id)}` : ''
            const task: Message | undefined = await this.client.getTask(container.id)
            labels[ContainerLabels.RESTART_STATUS] = restart && task?.status === M.ProcessStatus.RUNNING ? 'running' : restart ? 'stopped' : ''
        }
        //The labels emptied are deleted
        await this.client.updateContainer({id: container.id, spec: ContainerdClient.Json(SPEC_TYPE_URL, spec), labels: Object.fromEntries(Object.entries(labels).filter(([, value]): boolean => !!value))}, ['spec', ...Object.keys(labels).map((key: string): string => `labels.${key}`)])
        const task: Message | undefined = await this.client.getTask(container.id)
        if (!task || task.status === M.ProcessStatus.STOPPED) return
        const taskResources: Record<string, any> = structuredClone(resources)
        if (removed.memory) taskResources.memory.limit = -1
        if (removed.swap) taskResources.memory.swap = -1
        //The default weight of the kernel
        if (removed.shares) taskResources.cpu.shares = 1024
        if (removed.cpus) taskResources.cpu.cpus = await OnlineCpus()
        await this.client.updateTask(container.id, taskResources)
    }

    /**
     * Commit a container: the changes of its file system as a layer on its image, a new image (its container paused
     * meanwhile when it runs, by default)
     * @param container
     * @param options
     */
    public async commit(container: Message, options: { name: string, pause?: boolean, changes?: ImageConfigChanges, comment?: string, author?: string }): Promise<string> {
        const task: Message | undefined = await this.client.getTask(container.id)
        const pause: boolean = (options.pause ?? true) && task?.status === M.ProcessStatus.RUNNING
        if (pause) await this.client.pause(container.id)
        try {
            return await this.images.commit({
                image: container.image,
                platform: container.labels?.[ContainerLabels.PLATFORM] ? ParsePlatform(container.labels[ContainerLabels.PLATFORM]) : HostPlatform(),
                snapshotKey: container.snapshotKey || container.id,
                name: options.name,
                changes: options.changes,
                comment: options.comment,
                author: options.author
            })
        } finally {
            if (pause) await this.client.resume(container.id).catch((): undefined => undefined)
        }
    }

    /**
     * Archive a path of the file system of a container (tar): the one of its running process (its mounts with it), or
     * the one of its snapshot when it is not running; its symbolic links resolved in it
     * @param container
     * @param file an absolute path in the container
     * @param destination
     */
    public async archive(container: Message, file: string, destination: NodeJS.WritableStream): Promise<void> {
        const task: Message | undefined = await this.client.getTask(container.id)
        const running: boolean = !!task && task.status !== M.ProcessStatus.STOPPED && !!task.pid
        const tree: FileTree = running
            ? new DirectoryTree(`/proc/${task!.pid}/root`)
            : new LayersTree(LayerDirectories(await this.client.snapshotMounts(container.snapshotter || this.options.snapshotter, container.snapshotKey || container.id)))
        const resolved: string = await tree.resolve(file)
        const root: { stats: Stats, path: string } | undefined = await tree.lstat(resolved)
        if (!root) throw Object.assign(new Error(`The path ${file} does not exist in the container ${ContainerStore.Name(container)}`), {code: 'PATH_NOT_FOUND'})
        const archive: Pack = tarPack()
        const output: Promise<void> = pipeline(archive, destination)
        const entry = (header: Partial<Header>): Promise<void> => new Promise((resolve: () => void, reject: (error: Error) => void): void => void archive.entry(header as Header, (error?: Error | null): void => error ? reject(error) : resolve()))
        const add = async (name: string, inner: string, stats: Stats, real: string): Promise<void> => {
            const header: Partial<Header> = {name: name, mode: stats.mode & 0o7777, mtime: stats.mtime, uid: stats.uid, gid: stats.gid}
            if (stats.isDirectory()) {
                await entry({...header, type: 'directory'})
                for (const child of await tree.readdir(inner)) {
                    const childInner: string = path.posix.join(inner, child)
                    const found = await tree.lstat(childInner)
                    if (found) await add(`${name}/${child}`, childInner, found.stats, found.path)
                }
            } else if (stats.isSymbolicLink()) {
                await entry({...header, type: 'symlink', linkname: await readlink(real)})
            } else if (stats.isFile()) {
                await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
                    const writer = archive.entry({...header, type: 'file', size: stats.size} as Header, (error?: Error | null): void => error ? reject(error) : resolve())
                    pipeline(createReadStream(real), writer).catch(reject)
                })
            }
            //The devices, the sockets and the pipes are not archived
        }
        try {
            await add(path.posix.basename(resolved) || '.', resolved, root.stats, root.path)
            archive.finalize()
        } catch (error: unknown) {
            archive.destroy(error as Error)
        }
        await output
    }

    /**
     * The name of a container
     * @param container
     */
    public static Name(container: Message): string {
        return container.labels?.[ContainerLabels.NAME] ?? container.id
    }
}
