import {createHash, randomBytes} from 'node:crypto'
import {spawn, spawnSync} from 'node:child_process'
import {accessSync, constants as fsConstants, existsSync} from 'node:fs'
import {mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'

/**
 * A network of CNI (a configuration list of /etc/cni/net.d): the ones of nerdctl, the others of the machine
 */
export type CNINetwork = {
    name: string
    /**
     * Its identifier (the one of nerdctl, or the digest of its name)
     */
    id: string
    /**
     * Its configuration list
     */
    file: string
    labels: Record<string, string>
    cniVersion: string
    /**
     * The type of its first plugin (bridge, macvlan, ipvlan…)
     */
    driver: string
    subnets: string[]
    gateways: string[]
    plugins: Record<string, any>[]
    /**
     * Created by nerdctl (or by this package): removable
     */
    managed: boolean
}

/**
 * The options of the creation of a network
 */
export type CNINetworkCreateOptions = {
    name: string
    driver?: 'bridge' | 'macvlan' | 'ipvlan'
    /**
     * Its subnet (CIDR of IPv4), a free one of 10.4.0.0/16 by default
     */
    subnet?: string
    gateway?: string
    /**
     * The range of its addresses given to the containers (CIDR in its subnet)
     */
    ipRange?: string
    /**
     * The interface of the host of a macvlan or ipvlan network
     */
    parent?: string
    /**
     * Without the gateway and the masquerade of the host (bridge)
     */
    internal?: boolean
    mtu?: number
    labels?: Record<string, string>
}

/**
 * A port of a container published on the host
 */
export type PortMapping = {
    hostPort: number
    containerPort: number
    protocol: 'tcp' | 'udp' | 'sctp'
    hostIP?: string
}

/**
 * An interface of a container on a network (its result of CNI)
 */
export type ContainerNetworkInterface = {
    network: string
    interface: string
    mac?: string
    ip?: string
    prefixLength?: number
    gateway?: string
    ipv6?: string
    ipv6Gateway?: string
}

/**
 * A network of a container asked: its name, its address
 */
export type ContainerNetworkRequest = {
    name: string
    ip?: string
}

/**
 * The default network of nerdctl
 */
export const DEFAULT_NETWORK: string = 'bridge'

const DEFAULT_SUBNET: string = '10.4.0.0/24'

const DEFAULT_BRIDGE: string = 'nerdctl0'

/**
 * The directory of the leases of the addresses of the networks created (in /run: released at the boots, when the
 * containers of the last one did not stop)
 */
const IPAM_DATA_DIR: string = '/run/lakutata/cni/ipam'

/**
 * The script of the networks of the containers, run by runc as their hooks: add (createRuntime, the networks of CNI
 * added to the namespace of the container, its /etc/hosts given its address), del (poststop, the networks deleted, their
 * addresses released). The plugins of each network are chained as libcni chains them (the result of each one is the
 * previous result of the next one); their configurations are the files written for the container
 */
export const HOOK_SCRIPT: string = `#!/bin/sh
# The networks of a container (CNI), run by runc: add (createRuntime), del (poststop); the state of the container on the
# standard input
command="$1"
dir="$2"
state=$(cat)
. "$dir/network/env"
pid=$(printf '%s' "$state" | tr -d '\\n' | sed -n 's/.*"pid": *\\([0-9][0-9]*\\).*/\\1/p')
# The namespace of the network of the container, kept by a bind mount until its networks are deleted (the plugins delete
# their rules from the namespace, gone with the container otherwise)
netns="$dir/network/netns"

mounted() {
    awk -v target="$netns" '$5 == target { found = 1 } END { exit !found }' /proc/self/mountinfo
}

plugin() {
    old_ifs=$IFS
    IFS=:
    for directory in $CNI_PATH; do
        if [ -x "$directory/$1" ]; then
            IFS=$old_ifs
            printf '%s' "$directory/$1"
            return 0
        fi
    done
    IFS=$old_ifs
    return 1
}

# The input of a plugin: its configuration, the previous result
input() {
    if [ -n "$2" ]; then printf '%s,"prevResult":%s}' "$(cat "$1")" "$2"; else printf '%s}' "$(cat "$1")"; fi
}

add() {
    net="$1"
    export CNI_COMMAND=ADD CNI_CONTAINERID CNI_NETNS="$netns" CNI_IFNAME="$(cat "$net/ifname")" CNI_ARGS="$(cat "$net/args")" CNI_PATH
    count=$(cat "$net/count")
    previous=""
    i=1
    while [ "$i" -le "$count" ]; do
        type=$(cat "$net/$i.type")
        binary=$(plugin "$type") || { echo "the CNI plugin $type is not in $CNI_PATH" >&2; return 1; }
        if ! previous=$(input "$net/$i.conf" "$previous" | "$binary"); then
            echo "the CNI plugin $type of the network $(cat "$net/name") failed: $previous" >&2
            return 1
        fi
        i=$((i + 1))
    done
    printf '%s' "$previous" > "$net/result.json"
}

del() {
    net="$1"
    export CNI_COMMAND=DEL CNI_CONTAINERID CNI_NETNS="$netns" CNI_IFNAME="$(cat "$net/ifname")" CNI_ARGS="$(cat "$net/args")" CNI_PATH
    count=$(cat "$net/count")
    previous=$(cat "$net/result.json" 2>/dev/null)
    i=$count
    while [ "$i" -ge 1 ]; do
        type=$(cat "$net/$i.type")
        if binary=$(plugin "$type"); then
            input "$net/$i.conf" "$previous" | "$binary" > /dev/null 2>&1 || echo "the CNI plugin $type of the network $(cat "$net/name") failed to delete" >&2
        fi
        i=$((i - 1))
    done
    rm -f "$net/result.json"
}

networks=$(ls -d "$dir"/network/[0-9]* 2>/dev/null)
case "$command" in
    add)
        if ! mounted; then
            if [ -z "$pid" ] || [ ! -e "/proc/$pid/ns/net" ]; then echo "the container has no process (its state: $state)" >&2; exit 1; fi
            : > "$netns"
            mount --bind "/proc/$pid/ns/net" "$netns" || exit 1
        fi
        for net in $networks; do
            if ! add "$net"; then
                for added in $networks; do del "$added"; done
                umount "$netns" 2>/dev/null
                rm -f "$netns"
                exit 1
            fi
        done
        first=$(printf '%s\\n' $networks | head -n 1)
        address=$(sed -n 's/.*"address": *"\\([0-9a-fA-F.:]*\\)\\/.*/\\1/p' "$first/result.json" | head -n 1)
        { cat "$dir/hosts.base"; if [ -n "$address" ]; then printf '%s\\t%s\\n' "$address" "$(cat "$dir/hostname")"; fi; } > "$dir/hosts"
        ;;
    del)
        mounted || netns=""
        for net in $(printf '%s\\n' $networks | sort -r); do del "$net"; done
        if [ -n "$netns" ]; then umount "$netns" 2>/dev/null || umount -l "$netns" 2>/dev/null; fi
        rm -f "$dir/network/netns"
        ;;
esac
exit 0
`

/**
 * The integer of an address of IPv4
 * @param address
 */
function IPv4ToNumber(address: string): number {
    const parts: number[] = address.split('.').map(Number)
    if (parts.length !== 4 || parts.some((part: number): boolean => !Number.isInteger(part) || part < 0 || part > 255)) throw new Error(`The address ${address} is not an address of IPv4`)
    return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
}

function NumberToIPv4(value: number): string {
    return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.')
}

/**
 * The first and the last addresses of a subnet (CIDR of IPv4)
 * @param cidr
 */
export function ParseSubnet(cidr: string): { network: number, broadcast: number, prefix: number, cidr: string } {
    const [address, prefixText] = cidr.split('/')
    const prefix: number = Number(prefixText)
    if (!Number.isInteger(prefix) || prefix < 8 || prefix > 30) throw new Error(`The subnet ${cidr} is not a CIDR of IPv4 (/8 to /30)`)
    const mask: number = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
    const network: number = (IPv4ToNumber(address) & mask) >>> 0
    return {network: network, broadcast: (network | (~mask >>> 0)) >>> 0, prefix: prefix, cidr: `${NumberToIPv4(network)}/${prefix}`}
}

/**
 * Whether two subnets overlap
 * @param a
 * @param b
 */
function Overlap(a: string, b: string): boolean {
    try {
        const [x, y] = [ParseSubnet(a), ParseSubnet(b)]
        return x.network <= y.broadcast && y.network <= x.broadcast
    } catch {
        return false
    }
}

/**
 * Remove a bridge of the host: the rules of the firewall plugin isolating it (iptables), its interface (ip of iproute2,
 * or of busybox); what the system cannot remove is left
 * @param bridge
 */
function RemoveBridge(bridge: string): void {
    for (const chain of ['CNI-ISOLATION-STAGE-1', 'CNI-ISOLATION-STAGE-2']) {
        const rules = spawnSync('iptables', ['-w', '-S', chain], {encoding: 'utf8'})
        if (rules.error || rules.status !== 0) continue
        for (const rule of rules.stdout.split('\n')) {
            //The rules naming the bridge: deleted as iptables writes them (their comments quoted)
            if (!rule.startsWith('-A ') || !new RegExp(`(^| )-[io] ${bridge.replace(/\./g, '\\.')}( |$)`).test(rule)) continue
            spawnSync('/bin/sh', ['-c', `iptables -w -D ${rule.slice(3)}`], {stdio: 'ignore'})
        }
    }
    if (existsSync(`/sys/class/net/${bridge}`)) spawnSync('ip', ['link', 'delete', bridge], {stdio: 'ignore'})
}

/**
 * The networks of CNI of the machine (the configuration lists of its directory), the ones of nerdctl created and
 * removed, the configurations of the networks of the containers written for their hooks
 */
export class NetworkStore {

    #cniVersion: string | undefined

    constructor(public readonly confDir: string, public readonly cniPath: string[]) {
    }

    /**
     * The directories of the plugins which exist
     */
    public pluginDirectories(): string[] {
        return this.cniPath.filter((directory: string): boolean => existsSync(directory))
    }

    /**
     * The path of a plugin, undefined when it is not installed
     * @param type
     */
    public plugin(type: string): string | undefined {
        for (const directory of this.pluginDirectories()) {
            const file: string = path.join(directory, type)
            try {
                accessSync(file, fsConstants.X_OK)
                return file
            } catch {
                //Not there
            }
        }
        return undefined
    }

    /**
     * The version of CNI of the configurations written: the newest one of the plugins (1.0.0, or 0.4.0)
     */
    protected cniVersion(): string {
        if (this.#cniVersion) return this.#cniVersion
        const bridge: string | undefined = this.plugin('bridge') ?? this.plugin('macvlan')
        let versions: string[] = []
        if (bridge) {
            try {
                const result = spawnSync(bridge, [], {input: '', env: {...process.env, CNI_COMMAND: 'VERSION'}, encoding: 'utf8', timeout: 10000})
                versions = (JSON.parse(result.stdout) as { supportedVersions?: string[] }).supportedVersions ?? []
            } catch {
                //An older plugin
            }
        }
        this.#cniVersion = versions.includes('1.0.0') ? '1.0.0' : '0.4.0'
        return this.#cniVersion
    }

    /**
     * A network of a configuration list
     * @param file
     * @param content
     */
    protected parse(file: string, content: string): CNINetwork | undefined {
        let list: Record<string, any>
        try {
            list = JSON.parse(content)
        } catch {
            return undefined
        }
        if (typeof list.name !== 'string') return undefined
        const plugins: Record<string, any>[] = Array.isArray(list.plugins) ? list.plugins : [list]
        const subnets: string[] = []
        const gateways: string[] = []
        for (const plugin of plugins) {
            for (const range of plugin.ipam?.ranges ?? []) {
                for (const item of range) {
                    if (item.subnet) subnets.push(item.subnet)
                    if (item.gateway) gateways.push(item.gateway)
                }
            }
            if (plugin.ipam?.subnet) subnets.push(plugin.ipam.subnet)
            if (plugin.ipam?.gateway) gateways.push(plugin.ipam.gateway)
        }
        return {
            name: list.name,
            id: typeof list.nerdctlID === 'string' ? list.nerdctlID : createHash('sha256').update(list.name).digest('hex'),
            file: file,
            labels: list.nerdctlLabels ?? {},
            cniVersion: list.cniVersion ?? '0.4.0',
            driver: plugins[0]?.type ?? '',
            subnets: subnets,
            gateways: gateways,
            plugins: plugins,
            managed: path.basename(file).startsWith('nerdctl-')
        }
    }

    /**
     * The networks of CNI of the machine
     */
    public async list(): Promise<CNINetwork[]> {
        let files: string[]
        try {
            files = (await readdir(this.confDir)).filter((file: string): boolean => file.endsWith('.conflist') || file.endsWith('.conf')).sort()
        } catch {
            return []
        }
        const networks: CNINetwork[] = []
        for (const file of files) {
            const network: CNINetwork | undefined = this.parse(path.join(this.confDir, file), await readFile(path.join(this.confDir, file), 'utf8').catch((): string => ''))
            if (network && !networks.some((known: CNINetwork): boolean => known.name === network.name)) networks.push(network)
        }
        return networks
    }

    /**
     * A network, by its name or its identifier (or a prefix of it); the default one of nerdctl created when it is asked
     * @param nameOrId
     */
    public async get(nameOrId: string): Promise<CNINetwork | undefined> {
        const networks: CNINetwork[] = await this.list()
        const found: CNINetwork | undefined = networks.find((network: CNINetwork): boolean => network.name === nameOrId)
            ?? networks.find((network: CNINetwork): boolean => network.id === nameOrId)
            ?? (nameOrId.length >= 3 ? networks.find((network: CNINetwork): boolean => network.id.startsWith(nameOrId)) : undefined)
        if (found || nameOrId !== DEFAULT_NETWORK) return found
        return await this.createDefault()
    }

    /**
     * The plugins added after the main one, as nerdctl adds them (the ones installed)
     * @param driver
     * @protected
     */
    protected chainedPlugins(driver: string): Record<string, any>[] {
        const plugins: Record<string, any>[] = [{type: 'portmap', capabilities: {portMappings: true}}]
        if (driver === 'bridge' && this.plugin('firewall')) plugins.push({type: 'firewall', ingressPolicy: 'same-bridge'})
        if (this.plugin('tuning')) plugins.push({type: 'tuning'})
        return plugins
    }

    /**
     * Write a configuration list
     * @param name
     * @param id
     * @param labels
     * @param plugins
     * @protected
     */
    protected async write(name: string, id: string, labels: Record<string, string>, plugins: Record<string, any>[]): Promise<CNINetwork> {
        const file: string = path.join(this.confDir, `nerdctl-${name}.conflist`)
        const content: string = JSON.stringify({cniVersion: this.cniVersion(), name: name, nerdctlID: id, nerdctlLabels: labels, plugins: plugins}, null, 2)
        await mkdir(this.confDir, {recursive: true})
        await writeFile(file, content + '\n', {flag: 'wx'})
        return this.parse(file, content)!
    }

    /**
     * Create the default network of nerdctl (bridge, nerdctl0, 10.4.0.0/24)
     * @protected
     */
    protected async createDefault(): Promise<CNINetwork> {
        try {
            return await this.write(DEFAULT_NETWORK, createHash('sha256').update(DEFAULT_NETWORK).digest('hex'), {'nerdctl/default-network': 'true'}, [
                {
                    type: 'bridge',
                    bridge: DEFAULT_BRIDGE,
                    isGateway: true,
                    ipMasq: true,
                    hairpinMode: true,
                    ipam: {ranges: [[{gateway: '10.4.0.1', subnet: DEFAULT_SUBNET}]], routes: [{dst: '0.0.0.0/0'}], type: 'host-local', dataDir: IPAM_DATA_DIR}
                },
                ...this.chainedPlugins('bridge')
            ])
        } catch (error: unknown) {
            //Created meanwhile
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') return (await this.list()).find((network: CNINetwork): boolean => network.name === DEFAULT_NETWORK)!
            throw error
        }
    }

    /**
     * A free subnet of 10.4.0.0/16 (the ones of nerdctl)
     * @param used
     * @protected
     */
    protected freeSubnet(used: string[]): string {
        for (let third = 1; third < 256; third++) {
            const subnet: string = `10.4.${third}.0/24`
            if (!used.some((other: string): boolean => Overlap(subnet, other))) return subnet
        }
        throw new Error('No subnet of 10.4.0.0/16 is free: give the subnet of the network')
    }

    /**
     * Create a network (bridge, macvlan, ipvlan), as nerdctl network create does
     * @param options
     */
    public async create(options: CNINetworkCreateOptions): Promise<CNINetwork> {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(options.name)) throw new Error(`The name of a network "${options.name}" is not valid ([a-zA-Z0-9][a-zA-Z0-9_.-]*)`)
        if (['host', 'none', DEFAULT_NETWORK].includes(options.name)) throw Object.assign(new Error(`The network ${options.name} is the one of the system`), {code: 'CONFLICT'})
        const networks: CNINetwork[] = await this.list()
        if (networks.some((network: CNINetwork): boolean => network.name === options.name)) throw Object.assign(new Error(`The network ${options.name} exists`), {code: 'CONFLICT'})
        const driver: string = options.driver ?? 'bridge'
        if (!this.plugin(driver)) throw new Error(`The CNI plugin ${driver} is not installed (${this.cniPath.join(', ')})`)
        const used: string[] = [DEFAULT_SUBNET, ...networks.flatMap((network: CNINetwork): string[] => network.subnets)]
        const subnet = ParseSubnet(options.subnet ?? this.freeSubnet(used))
        const overlapping: string | undefined = used.find((other: string): boolean => Overlap(subnet.cidr, other))
        if (options.subnet && overlapping) throw Object.assign(new Error(`The subnet ${subnet.cidr} overlaps the one of another network (${overlapping})`), {code: 'CONFLICT'})
        const gateway: string = options.gateway ?? NumberToIPv4(subnet.network + 1)
        const gatewayNumber: number = IPv4ToNumber(gateway)
        if (gatewayNumber <= subnet.network || gatewayNumber >= subnet.broadcast) throw new Error(`The gateway ${gateway} is not in the subnet ${subnet.cidr}`)
        const range: Record<string, string> = {gateway: gateway, subnet: subnet.cidr}
        if (options.ipRange) {
            const ipRange = ParseSubnet(options.ipRange)
            if (ipRange.network < subnet.network || ipRange.broadcast > subnet.broadcast) throw new Error(`The range ${options.ipRange} is not in the subnet ${subnet.cidr}`)
            range.rangeStart = NumberToIPv4(Math.max(ipRange.network + 1, subnet.network + 1))
            range.rangeEnd = NumberToIPv4(Math.min(ipRange.broadcast - 1, subnet.broadcast - 1))
        }
        const ipam: Record<string, any> = {ranges: [[range]], routes: options.internal ? [] : [{dst: '0.0.0.0/0'}], type: 'host-local', dataDir: IPAM_DATA_DIR}
        const id: string = randomBytes(32).toString('hex')
        let main: Record<string, any>
        if (driver === 'bridge') {
            main = {type: 'bridge', bridge: `br-${id.slice(0, 12)}`, isGateway: !options.internal, ipMasq: !options.internal, hairpinMode: true, ipam: ipam}
        } else {
            if (!options.parent) throw new Error(`The ${driver} network ${options.name} needs the interface of the host (parent)`)
            main = driver === 'macvlan' ? {type: 'macvlan', master: options.parent, mode: 'bridge', ipam: ipam} : {type: 'ipvlan', master: options.parent, mode: 'l2', ipam: ipam}
        }
        if (options.mtu) main.mtu = options.mtu
        try {
            return await this.write(options.name, id, options.labels ?? {}, [main, ...this.chainedPlugins(driver)])
        } catch (error: unknown) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw Object.assign(new Error(`The network ${options.name} exists`), {code: 'CONFLICT'})
            throw error
        }
    }

    /**
     * Remove a network (one of nerdctl): its configuration, its bridge and the rules of its firewall, the leases of its
     * addresses, as nerdctl network rm does
     * @param network
     */
    public async remove(network: CNINetwork): Promise<void> {
        if (!network.managed) throw new Error(`The network ${network.name} is not one of nerdctl (${network.file}): remove its configuration`)
        if (network.labels['nerdctl/default-network'] === 'true') throw Object.assign(new Error(`The network ${network.name} is the default one`), {code: 'CONFLICT'})
        await rm(network.file, {force: true})
        const main: Record<string, any> = network.plugins[0] ?? {}
        if (main.type === 'bridge' && typeof main.bridge === 'string' && /^[\w.-]+$/.test(main.bridge)) RemoveBridge(main.bridge)
        if (main.ipam?.dataDir === IPAM_DATA_DIR) await rm(path.join(IPAM_DATA_DIR, network.name), {recursive: true, force: true})
    }

    /**
     * Write the configurations of the networks of a container for its hooks (the configurations of their plugins, their
     * runtime configurations: the ports published on the first one)
     * @param stateDir
     * @param containerId
     * @param networks
     * @param ports
     */
    public async render(stateDir: string, containerId: string, networks: { network: CNINetwork, ip?: string }[], ports: PortMapping[]): Promise<void> {
        const directory: string = path.join(stateDir, 'network')
        await rm(directory, {recursive: true, force: true})
        await mkdir(directory, {recursive: true})
        const pluginPath: string = this.pluginDirectories().join(':')
        await writeFile(path.join(directory, 'env'), [
            `CNI_PATH='${pluginPath}'`,
            `CNI_CONTAINERID='${containerId}'`,
            `PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${pluginPath}'`,
            'export CNI_PATH CNI_CONTAINERID PATH',
            ''
        ].join('\n'))
        await writeFile(path.join(directory, 'hook.sh'), HOOK_SCRIPT, {mode: 0o755})
        for (let index = 0; index < networks.length; index++) {
            const {network, ip} = networks[index]
            const net: string = path.join(directory, String(index).padStart(2, '0'))
            await mkdir(net)
            await writeFile(path.join(net, 'name'), network.name)
            await writeFile(path.join(net, 'ifname'), `eth${index}`)
            await writeFile(path.join(net, 'args'), ['IgnoreUnknown=1', ...ip ? [`IP=${ip}`] : []].join(';'))
            await writeFile(path.join(net, 'count'), String(network.plugins.length))
            for (let position = 0; position < network.plugins.length; position++) {
                const plugin: Record<string, any> = {...network.plugins[position], name: network.name, cniVersion: network.cniVersion}
                //The runtime configuration of the capabilities of the plugin (the ports on the first network)
                if (plugin.capabilities?.portMappings && index === 0 && ports.length) {
                    plugin.runtimeConfig = {portMappings: ports.map((port: PortMapping): object => ({hostPort: port.hostPort, containerPort: port.containerPort, protocol: port.protocol, hostIP: port.hostIP ?? ''}))}
                }
                delete plugin.capabilities
                //Without its closing brace: the previous result is added by the hook
                await writeFile(path.join(net, `${position + 1}.conf`), JSON.stringify(plugin).slice(0, -1))
                await writeFile(path.join(net, `${position + 1}.type`), String(plugin.type))
            }
        }
    }

    /**
     * Delete the networks of a container whose hook did not (its task killed with its shim): the hook run as runc runs
     * it
     * @param stateDir
     */
    public async teardown(stateDir: string): Promise<void> {
        const hook: string = path.join(stateDir, 'network', 'hook.sh')
        if (!existsSync(hook)) return
        const results: string[] = (await readdir(path.join(stateDir, 'network')).catch((): string[] => []))
            .filter((entry: string): boolean => /^\d+$/.test(entry) && existsSync(path.join(stateDir, 'network', entry, 'result.json')))
        if (!results.length && !existsSync(path.join(stateDir, 'network', 'netns'))) return
        await new Promise<void>((resolve: () => void): void => {
            const child = spawn('/bin/sh', [hook, 'del', stateDir], {stdio: ['pipe', 'ignore', 'ignore']})
            child.on('error', (): void => resolve())
            child.on('close', (): void => resolve())
            child.stdin.end('{}')
        })
    }

    /**
     * The interfaces of a container on its networks (their results of CNI)
     * @param stateDir
     */
    public async interfaces(stateDir: string): Promise<ContainerNetworkInterface[]> {
        const directory: string = path.join(stateDir, 'network')
        const entries: string[] = (await readdir(directory).catch((): string[] => [])).filter((entry: string): boolean => /^\d+$/.test(entry)).sort()
        const interfaces: ContainerNetworkInterface[] = []
        for (const entry of entries) {
            const net: string = path.join(directory, entry)
            const name: string = await readFile(path.join(net, 'name'), 'utf8').catch((): string => '')
            const ifname: string = await readFile(path.join(net, 'ifname'), 'utf8').catch((): string => '')
            const item: ContainerNetworkInterface = {network: name, interface: ifname}
            let result: Record<string, any> | undefined
            try {
                result = JSON.parse(await readFile(path.join(net, 'result.json'), 'utf8'))
            } catch {
                //Not added (the container is not running)
            }
            if (result) {
                const index: number = (result.interfaces ?? []).findIndex((candidate: Record<string, any>): boolean => candidate.name === ifname && !!candidate.sandbox)
                if (index >= 0) item.mac = result.interfaces[index].mac
                for (const ip of result.ips ?? []) {
                    if (ip.interface !== undefined && index >= 0 && ip.interface !== index) continue
                    const [address, prefix] = String(ip.address).split('/')
                    if (address.includes(':')) {
                        item.ipv6 ??= address
                        item.ipv6Gateway ??= ip.gateway
                    } else if (!item.ip) {
                        item.ip = address
                        item.prefixLength = Number(prefix)
                        item.gateway = ip.gateway
                    }
                }
            }
            interfaces.push(item)
        }
        return interfaces
    }
}
