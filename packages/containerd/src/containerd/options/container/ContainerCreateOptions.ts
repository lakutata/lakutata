import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import type {ContainerdRestartPolicy} from '../../types/ContainerdRestartPolicy.js'
import type {ContainerdBind} from '../../types/ContainerdBind.js'
import type {ContainerdDevice} from '../../types/ContainerdDevice.js'
import type {ContainerdTmpfs} from '../../types/ContainerdTmpfs.js'

export class ContainerCreateOptions extends DTO {
    /**
     * The image of the container (its name, or a reference: alpine:3.20)
     */
    @Expect(DTO.String().required())
    public image: string

    /**
     * The platform of the image run (linux/amd64 on an arm64 machine with the emulators of QEMU), the one of the
     * machine by default
     */
    @Expect(DTO.String().optional())
    public platform?: string

    /**
     * Container name ([a-zA-Z0-9][a-zA-Z0-9_.-]*), the one of its image and of its identifier by default
     */
    @Expect(DTO.String().pattern(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/).optional())
    public name?: string

    /**
     * Container hostname, the one of the machine on its network by default
     */
    @Expect(DTO.String().optional())
    public hostname?: string

    /**
     * Command to run, the one of the image by default
     */
    @Expect(DTO.Array(DTO.String()).optional())
    public cmd?: string[]

    /**
     * The entry point of the container, the one of the image by default ([''] resets it)
     */
    @Expect(DTO.Array(DTO.String()).optional())
    public entrypoint?: string[]

    /**
     * Container environment variables
     */
    @Expect(DTO.Object().pattern(DTO.String(), DTO.String().allow('')).optional())
    public env?: Record<string, string>

    /**
     * The working directory of the process, the one of the image by default
     */
    @Expect(DTO.String().optional())
    public workingDir?: string

    /**
     * The user of the process (user, user:group, uid, uid:gid), the one of the image by default
     */
    @Expect(DTO.String().optional())
    public user?: string

    /**
     * Container labels
     */
    @Expect(DTO.Object().pattern(DTO.String(), DTO.String().allow('')).optional())
    public labels?: Record<string, string>

    /**
     * Gives the container full access to the host
     */
    @Expect(DTO.Boolean().optional())
    public privileged?: boolean

    /**
     * Mount the root file system of the container read only
     */
    @Expect(DTO.Boolean().optional())
    public readonlyRootfs?: boolean

    /**
     * Kernel capabilities added (NET_ADMIN, SYS_TIME, ALL)
     */
    @Expect(DTO.Array(DTO.String()).optional())
    public capabilities?: string[]

    /**
     * Kernel capabilities dropped (NET_RAW, ALL)
     */
    @Expect(DTO.Array(DTO.String()).optional())
    public capabilitiesDrop?: string[]

    /**
     * Container binds
     */
    @Expect(DTO.Array(DTO.Object({
        hostPath: DTO.String().required(),
        containerPath: DTO.String().required(),
        rw: DTO.Boolean().optional().default(true),
        propagation: DTO.String().valid('private', 'rprivate', 'shared', 'rshared', 'slave', 'rslave').optional()
    })).optional())
    public binds?: ContainerdBind[]

    /**
     * The tmpfs of the container
     */
    @Expect(DTO.Array(DTO.Object({
        containerPath: DTO.String().required(),
        size: DTO.Number().integer().positive().optional(),
        mode: DTO.String().pattern(/^[0-7]{3,4}$/).optional()
    })).optional())
    public tmpfs?: ContainerdTmpfs[]

    /**
     * The devices of the host given to the container (a directory gives the ones it has)
     */
    @Expect(DTO.Array(DTO.Object({
        hostPath: DTO.String().required(),
        containerPath: DTO.String().optional(),
        cgroupPermissions: DTO.String().pattern(/^[rwm]{1,3}$/).optional().default('rwm')
    })).optional())
    public devices?: ContainerdDevice[]

    /**
     * The network of the container: the one of the host, or none (its loopback only)
     * @default 'host'
     */
    @Expect(DTO.String().valid('host', 'none').optional().default('host'))
    public network?: 'host' | 'none'

    /**
     * The PID namespace of the host
     */
    @Expect(DTO.String().valid('host').optional())
    public pidMode?: 'host'

    /**
     * The IPC namespace of the host
     */
    @Expect(DTO.String().valid('host').optional())
    public ipcMode?: 'host'

    /**
     * The cgroup namespace: a private one (on cgroup v2), or the one of the host
     * @default 'private'
     */
    @Expect(DTO.String().valid('private', 'host').optional().default('private'))
    public cgroupns?: 'private' | 'host'

    /**
     * Memory limit in bytes (0: no limit)
     */
    @Expect(DTO.Number().integer().min(0).optional())
    public memoryLimit?: number

    /**
     * The limit of the memory and of the swap in bytes (-1: unlimited swap)
     */
    @Expect(DTO.Number().integer().min(-1).optional())
    public memorySwap?: number

    /**
     * The CPUs the container uses at most (1.5)
     */
    @Expect(DTO.Number().positive().optional())
    public cpus?: number

    /**
     * The relative weight of the CPU of the container
     */
    @Expect(DTO.Number().integer().positive().optional())
    public cpuShares?: number

    /**
     * CPUs in which to allow execution (e.g., [0,1]).
     */
    @Expect(DTO.Array(DTO.Number().integer().min(0)).optional())
    public cpuSet?: number[]

    /**
     * The processes the container has at most
     */
    @Expect(DTO.Number().integer().positive().optional())
    public pidsLimit?: number

    /**
     * Disable OOM Killer for the container.
     */
    @Expect(DTO.Boolean().optional())
    public OOMKillDisable?: boolean

    /**
     * The kernel parameters of the namespaces of the container (net.ipv4.ip_forward)
     */
    @Expect(DTO.Object().pattern(DTO.String(), DTO.String()).optional())
    public sysctls?: Record<string, string>

    /**
     * The size of /dev/shm in bytes
     */
    @Expect(DTO.Number().integer().positive().optional())
    public shmSize?: number

    /**
     * Container restart policy (kept by the restart monitor of containerd): no, always, unless-stopped, on-failure,
     * on-failure:N
     */
    @Expect(DTO.String().allow('').pattern(/^(no|always|unless-stopped|on-failure(:\d+)?)$/).optional())
    public restartPolicy?: ContainerdRestartPolicy

    /**
     * The signal stopping the container, the one of the image (SIGTERM) by default
     */
    @Expect(DTO.String().optional())
    public stopSignal?: string

    /**
     * The hosts added to its /etc/hosts (name: address)
     */
    @Expect(DTO.Object().pattern(DTO.String(), DTO.String().ip()).optional())
    public extraHosts?: Record<string, string>

    /**
     * The name servers of its /etc/resolv.conf, the ones of the host by default
     */
    @Expect(DTO.Array(DTO.String().ip()).optional())
    public dns?: string[]
}
