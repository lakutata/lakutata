import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {ContainerDevice} from '../../types/ContainerDevice.js'
import {type ContainerRestartPolicy} from '../../types/ContainerRestartPolicy.js'
import {ContainerPort} from '../../types/ContainerPort.js'
import {ContainerBind} from '../../types/ContainerBind.js'
import {ContainerNetwork} from '../../types/ContainerNetwork.js'
import {ContainerCapability} from '../../types/ContainerCapability.js'

/**
 * The settings of a container: given to {@link Docker.createContainer} and `DockerImage.run()` (create, then start),
 * which use the image's defaults (command, environment…) for the settings absent, and to `DockerContainer.update()`,
 * which changes the settings given and keeps the others: the limits and the restart policy live, the others by
 * recreating the container. Every option is optional.
 * @example
 * ```typescript
 * import {Docker, ContainerCapability} from 'lakutata/com/docker'
 *
 * declare const docker: Docker
 *
 * const image = await docker.pullImage({repo: 'nginx', tag: '1.27'})
 * const container = await image.run({
 *     name: 'web',
 *     env: {TZ: 'UTC'},
 *     memoryLimit: 256 * 1024 * 1024,
 *     restartPolicy: 'unless-stopped',
 *     ports: [{port: 80, type: 'tcp', hostPorts: [8080]}],
 *     binds: [{hostPath: '/srv/web/html', containerPath: '/usr/share/nginx/html', rw: false}],
 *     networks: [{networkName: 'front'}],
 *     capabilities: [ContainerCapability.NET_ADMIN]
 * })
 * //The same container, with 512 MiB of memory, restarted 3 times at most when it fails
 * await container.update({memoryLimit: 512 * 1024 * 1024, restartPolicy: 'on-failure:3'})
 * ```
 */
export class ContainerSettingOptions extends DTO {

    /**
     * The container name, unique on the Docker host: letters, digits, `_`, `.` and `-`, starting with a letter or a
     * digit. Docker generates one (`happy_turing`) when absent.
     */
    @Expect(DTO.String().optional())
    public name?: string

    /**
     * The host name seen in the container; Docker uses the first 12 characters of the container ID when absent.
     */
    @Expect(DTO.String().optional())
    public hostname?: string

    /**
     * Run the container privileged (`docker run --privileged`): every capability and every host device, without the
     * security restrictions. It gives the container full access to the host.
     */
    @Expect(DTO.Boolean().optional())
    public privileged?: boolean

    /**
     * Give the container's main process a terminal (`docker run -t`): its output is then not multiplexed, and
     * `DockerContainer.logs()` gives it as written.
     */
    @Expect(DTO.Boolean().optional())
    public tty?: boolean

    /**
     * The environment variables, by name (`{NODE_ENV: 'production'}`), added to the image's ones; the values are
     * strings.
     */
    @Expect(DTO.Object().optional())
    public env?: Record<string, string>

    /**
     * The memory limit, in bytes (`256 * 1024 * 1024` for 256 MiB); Docker requires at least 6 MiB. `0` or absent for
     * no limit. The swap limit is Docker's default: as much swap as memory.
     * @default 0
     */
    @Expect(DTO.Number().optional())
    public memoryLimit?: number

    /**
     * The indexes of the host CPUs the container may run on (`[0, 1]`, sent to Docker as `"0,1"`); all of them when
     * absent. Each one is an integer.
     */
    @Expect(DTO.Array(DTO.Number().integer()).optional())
    public cpuSet?: number[]

    /**
     * When Docker restarts the container after it exits: `''`, `'no'`, `'always'`, `'unless-stopped'`,
     * `'on-failure'` (with no limit on the retries) or `'on-failure:N'` (`N` retries at most, `'on-failure:3'`); another
     * value fails the validation. `''` or absent for no restart.
     */
    @Expect(DTO.Alternatives(
        DTO.String().allow('').valid('', 'no', 'always', 'unless-stopped', 'on-failure'),
        DTO.String().pattern(/^on-failure:\d+$/)
    ).optional())
    public restartPolicy?: ContainerRestartPolicy

    /**
     * The container ports published on the host (`docker run -p`), each one required to have a `port` (a valid port
     * number) and a `type` (`'tcp'` or `'udp'`), sent to Docker as `"80/tcp"`. Its `hostPorts` are the host ports
     * forwarded to it, bound on every host address (`[8080]`, each one once); empty, or absent, it is published on no
     * host port.
     */
    @Expect(DTO.Array(DTO.Object({
        port: DTO.Number().port().required(),
        type: DTO.String().valid('tcp', 'udp').required(),
        hostPorts: DTO.Array(DTO.Number().port()).optional().default([])
    })).optional())
    ports?: (Pick<ContainerPort, 'port' | 'type'> & Partial<Pick<ContainerPort, 'hostPorts'>>)[]

    /**
     * The host files and directories mounted into the container (`docker run -v`), each one required to have its
     * `hostPath`, its `containerPath` and `rw` (`false` for read-only); sent to Docker as
     * `"hostPath:containerPath:rw"` or `"hostPath:containerPath:ro"`.
     */
    @Expect(DTO.Array(DTO.Object({
        hostPath: DTO.String().required(),
        containerPath: DTO.String().required(),
        rw: DTO.Boolean().required()
    })).optional())
    public binds?: ContainerBind[]

    /**
     * The host devices made available in the container (`docker run --device`), each one required to have its
     * `hostPath` and its `containerPath`; its `cgroupPermissions`, a combination of `r`, `w` and `m`, is `'rwm'` by
     * default.
     */
    @Expect(DTO.Array(DTO.Object({
        hostPath: DTO.String().required(),
        containerPath: DTO.String().required(),
        cgroupPermissions: DTO.String().optional().default('rwm')
    })).optional())
    public devices?: (Pick<ContainerDevice, 'hostPath' | 'containerPath'> & Partial<Pick<ContainerDevice, 'cgroupPermissions'>>)[]

    /**
     * The networks the container is connected to, each one required to have its `networkName`; the default `bridge`
     * network when absent. On a user-defined network, `ip` (an IPv4 address) and `ipv6` (an IPv6 address) set the
     * container's static addresses, within the network's range; empty or absent, Docker allocates them. They are
     * ignored on `bridge`, `host` and `none`.
     */
    @Expect(DTO.Array(DTO.Object({
        networkName: DTO.String().required(),
        ip: DTO.String().allow('').ip({version: 'ipv4'}).optional(),
        ipv6: DTO.String().allow('').ip({version: 'ipv6'}).optional()
    })).optional())
    public networks?: (Pick<ContainerNetwork, 'networkName'> & Partial<Pick<ContainerNetwork, 'ip' | 'ipv6'>>)[]

    /**
     * Keep the kernel's OOM killer from killing the container's processes when it runs out of memory; set it with a
     * memory limit only, or the host may kill its own processes instead.
     */
    @Expect(DTO.Boolean().optional())
    public OOMKillDisable?: boolean

    /**
     * The Linux capabilities added to Docker's default set (`docker run --cap-add`); a value outside
     * {@link ContainerCapability} fails the validation. None added when absent (`update()` keeps the container's).
     */
    @Expect(DTO.Array(DTO.String().valid(...Object.values(ContainerCapability))).optional())
    public capabilities?: ContainerCapability[]

    /**
     * The cgroup the container runs in (the Docker Engine's `HostConfig.Cgroup`): `'container:<name|id>'` shares
     * another container's cgroup; its own when absent.
     */
    @Expect(DTO.String().optional())
    public cgroup?: string

    /**
     * The parent cgroup the container's cgroup is created under (`docker run --cgroup-parent`); a relative path is
     * relative to the cgroup of the init process. The cgroups are created when missing.
     */
    @Expect(DTO.String().optional())
    public cgroupParent?: string

    /**
     * The PID namespace of the container (`docker run --pid`): `'container:<name|id>'` joins another container's,
     * `'host'` uses the host's; its own when absent.
     */
    @Expect(DTO.String().optional())
    public pidMode?: string

    /**
     * The command, replacing the image's `CMD`: the executable followed by its arguments (`['node', 'server.js']`), an
     * array only.
     */
    @Expect(DTO.Array(DTO.String()).optional())
    public cmd?: string[]

    /**
     * The entry point, replacing the image's `ENTRYPOINT`: the executable followed by its arguments, an array only.
     * `['']` removes the image's entry point: the command runs alone.
     */
    @Expect(DTO.Array(DTO.String()).optional())
    public entrypoint?: string[]
}
