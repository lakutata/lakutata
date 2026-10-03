/**
 * The capabilities of the containers by default (the ones of containerd, Docker and nerdctl)
 */
export const DEFAULT_CAPABILITIES: readonly string[] = [
    'CAP_CHOWN',
    'CAP_DAC_OVERRIDE',
    'CAP_FSETID',
    'CAP_FOWNER',
    'CAP_MKNOD',
    'CAP_NET_RAW',
    'CAP_SETGID',
    'CAP_SETUID',
    'CAP_SETFCAP',
    'CAP_SETPCAP',
    'CAP_NET_BIND_SERVICE',
    'CAP_SYS_CHROOT',
    'CAP_KILL',
    'CAP_AUDIT_WRITE'
]

/**
 * All the capabilities of Linux (the privileged containers)
 */
export const ALL_CAPABILITIES: readonly string[] = [
    'CAP_CHOWN', 'CAP_DAC_OVERRIDE', 'CAP_DAC_READ_SEARCH', 'CAP_FOWNER', 'CAP_FSETID', 'CAP_KILL', 'CAP_SETGID',
    'CAP_SETUID', 'CAP_SETPCAP', 'CAP_LINUX_IMMUTABLE', 'CAP_NET_BIND_SERVICE', 'CAP_NET_BROADCAST', 'CAP_NET_ADMIN',
    'CAP_NET_RAW', 'CAP_IPC_LOCK', 'CAP_IPC_OWNER', 'CAP_SYS_MODULE', 'CAP_SYS_RAWIO', 'CAP_SYS_CHROOT', 'CAP_SYS_PTRACE',
    'CAP_SYS_PACCT', 'CAP_SYS_ADMIN', 'CAP_SYS_BOOT', 'CAP_SYS_NICE', 'CAP_SYS_RESOURCE', 'CAP_SYS_TIME',
    'CAP_SYS_TTY_CONFIG', 'CAP_MKNOD', 'CAP_LEASE', 'CAP_AUDIT_WRITE', 'CAP_AUDIT_CONTROL', 'CAP_SETFCAP',
    'CAP_MAC_OVERRIDE', 'CAP_MAC_ADMIN', 'CAP_SYSLOG', 'CAP_WAKE_ALARM', 'CAP_BLOCK_SUSPEND', 'CAP_AUDIT_READ',
    'CAP_PERFMON', 'CAP_BPF', 'CAP_CHECKPOINT_RESTORE'
]

/**
 * The paths masked in the containers (not privileged)
 */
const MASKED_PATHS: readonly string[] = [
    '/proc/acpi', '/proc/asound', '/proc/kcore', '/proc/keys', '/proc/latency_stats', '/proc/timer_list',
    '/proc/timer_stats', '/proc/sched_debug', '/proc/scsi', '/sys/firmware', '/sys/devices/virtual/powercap'
]

/**
 * The paths read only in the containers (not privileged)
 */
const READONLY_PATHS: readonly string[] = ['/proc/bus', '/proc/fs', '/proc/irq', '/proc/sys', '/proc/sysrq-trigger']

/**
 * The devices of the containers allowed by default (the ones of runc: null, zero, full, tty, random, urandom, the
 * pseudo terminals)
 */
const DEFAULT_DEVICE_RULES: readonly object[] = [
    {allow: false, access: 'rwm'},
    {allow: true, type: 'c', major: 1, minor: 3, access: 'rwm'},
    {allow: true, type: 'c', major: 1, minor: 8, access: 'rwm'},
    {allow: true, type: 'c', major: 1, minor: 7, access: 'rwm'},
    {allow: true, type: 'c', major: 5, minor: 0, access: 'rwm'},
    {allow: true, type: 'c', major: 1, minor: 5, access: 'rwm'},
    {allow: true, type: 'c', major: 1, minor: 9, access: 'rwm'},
    {allow: true, type: 'c', major: 5, minor: 2, access: 'rwm'},
    {allow: true, type: 'c', major: 136, access: 'rwm'}
]

/**
 * A bind mount of a container
 */
export type SpecMount = {
    type?: string
    source: string
    destination: string
    options?: string[]
}

/**
 * A device of the host given to a container
 */
export type SpecDevice = {
    path: string
    containerPath: string
    type: 'c' | 'b'
    major: number
    minor: number
    fileMode?: number
    uid?: number
    gid?: number
    permissions: string
}

/**
 * The options of the specification of a container
 */
export type SpecOptions = {
    id: string
    namespace: string
    args: string[]
    env: string[]
    cwd: string
    uid: number
    gid: number
    additionalGids: number[]
    hostname: string
    terminal?: boolean
    privileged?: boolean
    readonlyRootfs?: boolean
    capAdd?: string[]
    capDrop?: string[]
    mounts?: SpecMount[]
    devices?: SpecDevice[]
    /**
     * The network: the one of the host, or a namespace of its own (only its loopback, or the path of the one prepared)
     */
    network: { mode: 'host' } | { mode: 'none' } | { mode: 'path', path: string }
    pidHost?: boolean
    ipcHost?: boolean
    /**
     * A cgroup namespace of its own (the private one of Docker and nerdctl on cgroup v2): its cgroup is the root of its
     * /sys/fs/cgroup
     */
    cgroupNamespace?: boolean
    /**
     * The path of the cgroup (/default/id with cgroupfs, system.slice:lakutata:id with systemd)
     */
    cgroupsPath: string
    memory?: number
    memorySwap?: number
    cpuQuota?: number
    cpuPeriod?: number
    cpuShares?: number
    cpuset?: string
    pidsLimit?: number
    oomKillDisable?: boolean
    sysctls?: Record<string, string>
    shmSize?: number
    rlimits?: { type: string, hard: number, soft: number }[]
    annotations?: Record<string, string>
}

/**
 * The capability of a name (NET_ADMIN, CAP_NET_ADMIN)
 * @param name
 */
function Capability(name: string): string {
    const upper: string = name.trim().toUpperCase()
    return upper.startsWith('CAP_') ? upper : `CAP_${upper}`
}

/**
 * The capabilities of a container: the ones by default (all for the privileged containers), the ones added, without
 * the ones dropped (ALL drops all)
 * @param options
 */
export function Capabilities(options: Pick<SpecOptions, 'privileged' | 'capAdd' | 'capDrop'>): string[] {
    let capabilities: Set<string> = new Set(options.privileged ? ALL_CAPABILITIES : DEFAULT_CAPABILITIES)
    const drop: string[] = (options.capDrop ?? []).map(Capability)
    if (drop.includes('CAP_ALL')) capabilities = new Set()
    else drop.forEach((capability: string): unknown => capabilities.delete(capability))
    const add: string[] = (options.capAdd ?? []).map(Capability)
    if (add.includes('CAP_ALL')) ALL_CAPABILITIES.forEach((capability: string): unknown => capabilities.add(capability))
    else add.forEach((capability: string): unknown => capabilities.add(capability))
    return [...capabilities]
}

/**
 * The specification of the runtime (OCI) of a container on Linux, as containerd and nerdctl generate it
 * @param options
 */
export function GenerateSpec(options: SpecOptions): Record<string, any> {
    const capabilities: string[] = Capabilities(options)
    const namespaces: { type: string, path?: string }[] = [{type: 'mount'}, {type: 'uts'}]
    if (!options.pidHost) namespaces.push({type: 'pid'})
    if (!options.ipcHost) namespaces.push({type: 'ipc'})
    if (options.cgroupNamespace) namespaces.push({type: 'cgroup'})
    if (options.network.mode === 'none') namespaces.push({type: 'network'})
    if (options.network.mode === 'path') namespaces.push({type: 'network', path: options.network.path})
    const mounts: SpecMount[] = [
        {destination: '/proc', type: 'proc', source: 'proc', options: ['nosuid', 'noexec', 'nodev']},
        {destination: '/dev', type: 'tmpfs', source: 'tmpfs', options: ['nosuid', 'strictatime', 'mode=755', 'size=65536k']},
        {destination: '/dev/pts', type: 'devpts', source: 'devpts', options: ['nosuid', 'noexec', 'newinstance', 'ptmxmode=0666', 'mode=0620', 'gid=5']},
        {destination: '/dev/shm', type: 'tmpfs', source: 'shm', options: ['nosuid', 'noexec', 'nodev', 'mode=1777', `size=${options.shmSize ?? 64 * 1024 * 1024}`]},
        {destination: '/dev/mqueue', type: 'mqueue', source: 'mqueue', options: ['nosuid', 'noexec', 'nodev']},
        {destination: '/sys', type: 'sysfs', source: 'sysfs', options: ['nosuid', 'noexec', 'nodev', options.privileged ? 'rw' : 'ro']},
        {destination: '/sys/fs/cgroup', type: 'cgroup', source: 'cgroup', options: ['nosuid', 'noexec', 'nodev', 'relatime', options.privileged ? 'rw' : 'ro']}
    ]
    for (const mount of options.mounts ?? []) {
        //A mount given replaces the one of its destination
        const index: number = mounts.findIndex((existing: SpecMount): boolean => existing.destination === mount.destination)
        if (index >= 0) mounts.splice(index, 1)
        mounts.push({type: mount.type ?? 'bind', source: mount.source, destination: mount.destination, options: mount.options ?? ['rbind', 'rprivate']})
    }
    const devices: SpecDevice[] = options.devices ?? []
    const resources: Record<string, any> = {
        devices: options.privileged ? [{allow: true, access: 'rwm'}] : [
            ...DEFAULT_DEVICE_RULES,
            ...devices.map((device: SpecDevice): object => ({allow: true, type: device.type, major: device.major, minor: device.minor, access: device.permissions}))
        ]
    }
    if (options.memory || options.oomKillDisable) {
        resources.memory = {}
        if (options.memory) resources.memory.limit = options.memory
        if (options.memorySwap) resources.memory.swap = options.memorySwap
        if (options.oomKillDisable) resources.memory.disableOOMKiller = true
    }
    if (options.cpuQuota || options.cpuShares || options.cpuset) {
        resources.cpu = {}
        if (options.cpuQuota) {
            resources.cpu.quota = options.cpuQuota
            resources.cpu.period = options.cpuPeriod ?? 100000
        }
        if (options.cpuShares) resources.cpu.shares = options.cpuShares
        if (options.cpuset) resources.cpu.cpus = options.cpuset
    }
    if (options.pidsLimit) resources.pids = {limit: options.pidsLimit}
    return {
        ociVersion: '1.0.2-dev',
        process: {
            terminal: !!options.terminal,
            user: {uid: options.uid, gid: options.gid, ...options.additionalGids.length ? {additionalGids: options.additionalGids} : {}},
            args: options.args,
            env: options.env,
            cwd: options.cwd || '/',
            capabilities: {bounding: capabilities, effective: capabilities, permitted: capabilities},
            rlimits: options.rlimits ?? [{type: 'RLIMIT_NOFILE', hard: 1024, soft: 1024}],
            noNewPrivileges: !options.privileged
        },
        root: {path: 'rootfs', readonly: !!options.readonlyRootfs},
        hostname: options.hostname,
        mounts: mounts,
        annotations: options.annotations ?? {},
        linux: {
            resources: resources,
            cgroupsPath: options.cgroupsPath,
            namespaces: namespaces,
            devices: devices.map((device: SpecDevice): object => ({
                path: device.containerPath,
                type: device.type,
                major: device.major,
                minor: device.minor,
                fileMode: device.fileMode ?? 0o666,
                uid: device.uid ?? 0,
                gid: device.gid ?? 0
            })),
            ...options.sysctls && Object.keys(options.sysctls).length ? {sysctl: options.sysctls} : {},
            ...options.privileged ? {} : {maskedPaths: [...MASKED_PATHS], readonlyPaths: [...READONLY_PATHS]}
        }
    }
}

/**
 * The specification of a process executed in a container (exec): the one of the container, its arguments, its
 * environment, its directory, its user and its terminal changed
 * @param spec the specification of the container
 * @param options
 */
export function ExecProcessSpec(spec: Record<string, any>, options: { args: string[], env?: string[], cwd?: string, uid?: number, gid?: number, additionalGids?: number[], terminal?: boolean }): Record<string, any> {
    const process: Record<string, any> = structuredClone(spec.process ?? {})
    process.args = options.args
    process.terminal = !!options.terminal
    if (options.env?.length) {
        const env: Map<string, string> = new Map((process.env ?? []).map((entry: string): [string, string] => [entry.split('=')[0], entry]))
        for (const entry of options.env) env.set(entry.split('=')[0], entry)
        process.env = [...env.values()]
    }
    if (options.cwd) process.cwd = options.cwd
    if (options.uid !== undefined) process.user = {uid: options.uid, gid: options.gid ?? 0, ...options.additionalGids?.length ? {additionalGids: options.additionalGids} : {}}
    return process
}
