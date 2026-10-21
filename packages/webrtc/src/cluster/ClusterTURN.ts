import type {SignalingIceServer} from '../protocol/SignalingProtocol.js'
import type {TURNServer, TURNServerLocation} from '../turn/TURNServer.js'
import {createTURNCredentials, type TURNCredentials} from '../turn/TURNCredentials.js'
import {iceServersOfTURN} from '../turn/TURNIceServers.js'
import type {Cluster, ClusterNode} from './Cluster.js'

/**
 * A TURN server of a node of a {@link Cluster}, as it tells the other nodes.
 */
export interface ClusterTURNServer extends TURNServerLocation {
    /**
     * The id of its node.
     */
    readonly node: string
    /**
     * The labels of its node (a zone, a region).
     */
    readonly labels: Readonly<Record<string, string>>
    /**
     * Its allocations in use.
     */
    readonly allocations: number
    /**
     * Its allocations at most, if it has a limit.
     */
    readonly maxAllocations?: number
    /**
     * How long its short-lived credentials are valid, in seconds.
     */
    readonly credentialTtl: number
}

/**
 * Chooses the TURN servers of the cluster given to a client (the `selectTURN` option of `Signaling` and `WHIP`).
 * @param servers The TURN servers of the cluster.
 * @param user The client: the member of the signaling, the stream of WHIP.
 * @returns The servers given to it.
 */
export type TURNSelector = (servers: ClusterTURNServer[], user: string) => ClusterTURNServer[]

/**
 * The TURN servers given to a client by default: the two least loaded that are not full
 */
const DEFAULT_COUNT: number = 2

/**
 * The TURN servers the nodes of a cluster tell about
 * @param cluster
 */
export function turnServersOf(cluster: Cluster): ClusterTURNServer[] {
    return cluster.nodes().flatMap((node: ClusterNode): ClusterTURNServer[] => {
        const turn: Partial<ClusterTURNServer> | undefined = node.services.turn as Partial<ClusterTURNServer> | undefined
        if (!turn || typeof turn.address !== 'string' || typeof turn.port !== 'number') return []
        return [{
            node: node.id,
            labels: node.labels,
            address: turn.address,
            port: turn.port,
            udp: turn.udp === true,
            tcp: turn.tcp === true,
            ...typeof turn.tlsPort === 'number' ? {tlsPort: turn.tlsPort} : {},
            allocations: typeof turn.allocations === 'number' ? turn.allocations : 0,
            ...typeof turn.maxAllocations === 'number' ? {maxAllocations: turn.maxAllocations} : {},
            credentialTtl: typeof turn.credentialTtl === 'number' ? turn.credentialTtl : 86400
        }]
    })
}

/**
 * The least loaded TURN servers that are not full, the servers equally loaded in a random order
 * @param servers
 */
export function leastLoadedTURN(servers: ClusterTURNServer[]): ClusterTURNServer[] {
    const load = (server: ClusterTURNServer): number => server.maxAllocations ? server.allocations / server.maxAllocations : server.allocations
    return servers
        .filter((server: ClusterTURNServer): boolean => server.maxAllocations === undefined || server.allocations < server.maxAllocations)
        .map((server: ClusterTURNServer): [ClusterTURNServer, number] => [server, Math.random()])
        .sort(([x, xOrder]: [ClusterTURNServer, number], [y, yOrder]: [ClusterTURNServer, number]): number => load(x) - load(y) || xOrder - yOrder)
        .slice(0, DEFAULT_COUNT)
        .map(([server]: [ClusterTURNServer, number]): ClusterTURNServer => server)
}

/**
 * The ICE servers of a client: the ones of the TURN server of this node, then the ones of the TURN servers of the
 * cluster chosen for it (with credentials of the secret shared by the TURN servers of the cluster, or else of the
 * TURN server of this node), then the others given
 * @param user The client.
 * @param options The TURN server of this node, the cluster, the shared secret, how to choose, the other ICE servers.
 * @returns The ICE servers, and how long their credentials are valid in seconds (0 without TURN).
 */
export function iceServersFor(user: string, options: {turn?: TURNServer, cluster?: Cluster, secret?: string, select?: TURNSelector, iceServers: SignalingIceServer[]}): {iceServers: SignalingIceServer[], credentialTtl: number} {
    const {turn, cluster, secret, select, iceServers} = options
    const servers: SignalingIceServer[] = []
    const lifetimes: number[] = []
    if (turn) {
        const credentials: TURNCredentials = turn.credentials(user)
        servers.push(...iceServersOfTURN(turn.location, credentials))
        lifetimes.push(credentials.ttl)
    }
    if (cluster && (secret || turn)) {
        //The TURN server of this node is given already
        const available: ClusterTURNServer[] = turnServersOf(cluster).filter((server: ClusterTURNServer): boolean => !turn || server.node !== cluster.nodeId)
        const chosen: ClusterTURNServer[] = available.length ? (select ?? leastLoadedTURN)(available, user) : []
        if (chosen.length) {
            const ttl: number = Math.min(...chosen.map((server: ClusterTURNServer): number => server.credentialTtl))
            const credentials: TURNCredentials = secret ? createTURNCredentials(secret, user, ttl) : turn!.credentials(user)
            for (const server of chosen) servers.push(...iceServersOfTURN(server, credentials))
            lifetimes.push(credentials.ttl)
        }
    }
    return {iceServers: [...servers, ...iceServers], credentialTtl: lifetimes.length ? Math.min(...lifetimes) : 0}
}
