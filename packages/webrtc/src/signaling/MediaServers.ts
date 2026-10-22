import type {Signaling} from './Signaling.js'

/**
 * Gives a member joining a room the media server it connects to: the id of the member of the server, once the server is
 * in the room; none for a room without one
 * @param room The room.
 * @param peerId The id of the member joining.
 * @throws {SignalingLimitException} When the media server takes no more members.
 */
export type MediaServerAssignment = (room: string, peerId: string) => Promise<string | undefined>

/**
 * The media server attached to each signaling
 */
export const mediaServers: WeakMap<Signaling, MediaServerAssignment> = new WeakMap()

/**
 * The service a media server announces on the cluster (`Cluster.announce()`), with its load
 */
export const MEDIA_SERVER_SERVICE: string = 'sfu'

/**
 * The load of a media server, as it announces it
 */
export interface MediaServerLoad {
    //The members and the viewers of WHEP it has, the members it takes at most (0 for no limit)
    readonly members: number
    readonly viewers: number
    readonly maxMembers: number
}

/**
 * The topic of the requests to a media server of the cluster: give a member joining a room (through a node without a
 * media server) a media server, as the media server would for a member joining through its own node
 */
export const MEDIA_SERVER_ASSIGN_TOPIC: string = 'webrtc.sfu.assign'

/**
 * The answer to a request of a media server for a member (MEDIA_SERVER_ASSIGN_TOPIC, and the requests between the media
 * servers): the id of the member of the server (null for a room without one), or full when no media server takes the
 * member
 */
export type MediaServerReply = {sfu: string | null} | {full: true}
