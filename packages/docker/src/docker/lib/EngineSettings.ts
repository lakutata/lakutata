import {type ContainerSettingOptions} from '../options/container/ContainerSettingOptions.js'
import {type ContainerRestartPolicy} from '../types/ContainerRestartPolicy.js'
import {type DeviceMapping} from '../../client/types/DeviceMapping.js'
import {type PortBinding} from '../../client/types/PortBinding.js'

/**
 * The networks Docker creates itself: the addresses of their endpoints cannot be set
 */
const RESERVED_NETWORKS: string[] = ['bridge', 'host', 'none']

/**
 * The restart policy of the Engine API: "on-failure:3" is the policy on-failure with 3 retries at most
 * @param restartPolicy
 */
export function EngineRestartPolicy(restartPolicy: ContainerRestartPolicy): { Name: string, MaximumRetryCount?: number } {
    const [name, retries] = restartPolicy.split(':')
    return retries === undefined ? {Name: name} : {Name: name, MaximumRetryCount: Number.parseInt(retries, 10)}
}

/**
 * The restart policy of a container, from the one of the Engine API
 * @param restartPolicy
 */
export function ParseRestartPolicy(restartPolicy?: { Name?: string, MaximumRetryCount?: number } | null): ContainerRestartPolicy {
    if (!restartPolicy?.Name) return ''
    if (restartPolicy.Name === 'on-failure' && restartPolicy.MaximumRetryCount) return `on-failure:${restartPolicy.MaximumRetryCount}`
    return restartPolicy.Name as ContainerRestartPolicy
}

/**
 * The port bindings of the Engine API ("80/tcp": [{HostPort: "8080"}]): each host port once, null for a port published
 * on no host port
 * @param ports
 */
export function EnginePortBindings(ports: NonNullable<ContainerSettingOptions['ports']>): Record<string, PortBinding[] | null> {
    const hostPortsMap: Map<string, Set<number>> = new Map()
    for (const port of ports) {
        const key: string = `${port.port}/${port.type}`
        const hostPorts: Set<number> = hostPortsMap.get(key) ?? new Set()
        port.hostPorts?.forEach((hostPort: number): unknown => hostPorts.add(hostPort))
        hostPortsMap.set(key, hostPorts)
    }
    const portBindings: Record<string, PortBinding[] | null> = {}
    hostPortsMap.forEach((hostPorts: Set<number>, key: string): void => {
        portBindings[key] = hostPorts.size ? [...hostPorts].map((hostPort: number): PortBinding => ({HostPort: hostPort.toString()})) : null
    })
    return portBindings
}

/**
 * The bind mounts of the Engine API ("hostPath:containerPath:rw")
 * @param binds
 */
export function EngineBinds(binds: NonNullable<ContainerSettingOptions['binds']>): string[] {
    return binds.map((bind): string => `${bind.hostPath}:${bind.containerPath}:${bind.rw ? 'rw' : 'ro'}`)
}

/**
 * The devices of the Engine API
 * @param devices
 */
export function EngineDevices(devices: NonNullable<ContainerSettingOptions['devices']>): DeviceMapping[] {
    return devices.map((device): DeviceMapping => ({
        PathOnHost: device.hostPath,
        PathInContainer: device.containerPath,
        CgroupPermissions: device.cgroupPermissions!
    }))
}

/**
 * The endpoints of the Engine API, by network: the static addresses given, none on the reserved networks
 * @param networks
 */
export function EngineEndpoints(networks: NonNullable<ContainerSettingOptions['networks']>): Record<string, Record<string, unknown>> {
    const endpoints: Record<string, Record<string, unknown>> = {}
    for (const network of networks) {
        endpoints[network.networkName] = RESERVED_NETWORKS.includes(network.networkName)
            ? {}
            : {
                IPAMConfig: {
                    IPv4Address: network.ip ? network.ip : undefined,
                    IPv6Address: network.ipv6 ? network.ipv6 : undefined
                }
            }
    }
    return endpoints
}
