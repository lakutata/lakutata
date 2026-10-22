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
