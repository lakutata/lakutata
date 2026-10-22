import type {EndpointLeg} from '../peer/Endpoints.js'
import type {SignalingDescription} from '../protocol/SignalingProtocol.js'

/**
 * The topics of the requests of the media servers of a cluster to each other
 */
export const SFU_TOPICS = {
    //Take a member in a room (answered with the id of the member of the server, null for a room not served, or full)
    serve: 'webrtc.sfu.serve',
    //Take a stream of WHIP, or a viewer of WHEP, in a room: its offer answered there (a LegReply)
    publish: 'webrtc.sfu.publish',
    play: 'webrtc.sfu.play',
    //To the node of a leg: apply a PATCH, end the leg
    patch: 'webrtc.sfu.leg.patch',
    end: 'webrtc.sfu.leg.end',
    //To the node of the session of a leg: the leg ended, the source of a viewer changed, choose the source of a viewer
    ended: 'webrtc.sfu.leg.ended',
    source: 'webrtc.sfu.leg.source',
    choose: 'webrtc.sfu.leg.choose'
} as const

/**
 * The answer of a node taking a stream of WHIP or a viewer of WHEP: the answer to its offer (and the source of a
 * viewer), or full, or refused (the room is not served, the offer is refused)
 */
export type LegReply = {answer: SignalingDescription, source?: string | null} | {full: true} | {refused: string}

/**
 * The answer of the node of a leg to a PATCH (see patchConnection): the fragment answering an ICE restart, or stale
 */
export type LegPatchReply = {fragment?: string, stale?: boolean}

/**
 * How long a node may take to answer an offer or a PATCH (its candidates gathered), in milliseconds
 */
export const LEG_TIMEOUT: number = 10000

/**
 * What a leg of another node needs of the media server
 */
export interface ClusterLegLink {
    //The legs on other nodes, by their id
    readonly legs: Map<string, ClusterLeg>
    request<Result>(node: string, topic: string, message: unknown): Promise<Result>
}

/**
 * The connection of a session of WHIP or WHEP held by this node to its client, on the media server of another node:
 * its PATCH requests and its end go there, its end and the source of a viewer come from there
 */
export class ClusterLeg implements EndpointLeg {

    readonly #link: ClusterLegLink

    readonly #listeners: (() => void)[] = []

    #ended: boolean = false

    #source: string | undefined

    /**
     * The id of the leg: the member of the stream of WHIP, or the viewer.
     */
    public readonly id: string

    /**
     * The node of the connection.
     */
    public readonly node: string

    /**
     * The answer, with all the candidates.
     */
    public readonly answer: SignalingDescription

    /**
     * Keep a leg of another node.
     * @param link The media server.
     * @param node The node of the connection.
     * @param id The id of the leg.
     * @param answer The answer.
     * @param source The source of a viewer.
     */
    constructor(link: ClusterLegLink, node: string, id: string, answer: SignalingDescription, source?: string) {
        this.#link = link
        this.node = node
        this.id = id
        this.answer = answer
        this.#source = source
        link.legs.set(id, this)
    }

    /**
     * The source of a viewer of WHEP.
     */
    public source(): string | undefined {
        return this.#source
    }

    /**
     * The source of a viewer changed.
     * @param source
     */
    public sourced(source: string | undefined): void {
        this.#source = source
    }

    /**
     * Apply a PATCH on the node of the connection.
     * @param fragment
     * @param restart
     */
    public async patch(fragment: string, restart: boolean): Promise<string | undefined | null> {
        if (this.#ended) throw new Error('The session ended')
        const reply: LegPatchReply = await this.#link.request<LegPatchReply>(this.node, SFU_TOPICS.patch, {id: this.id, fragment: fragment, restart: restart})
        return reply.stale ? null : reply.fragment
    }

    /**
     * Call a listener once the leg ends.
     * @param listener
     */
    public ended(listener: () => void): void {
        if (this.#ended) listener()
        else this.#listeners.push(listener)
    }

    /**
     * Close the connection, on its node.
     */
    public close(): void {
        if (this.#ended) return
        this.#link.request(this.node, SFU_TOPICS.end, {id: this.id}).catch((): void => undefined)
        this.end()
    }

    /**
     * The connection is gone (closed on its node, or its node is down).
     */
    public end(): void {
        if (this.#ended) return
        this.#ended = true
        if (this.#link.legs.get(this.id) === this) this.#link.legs.delete(this.id)
        for (const listener of this.#listeners.splice(0)) listener()
    }
}
