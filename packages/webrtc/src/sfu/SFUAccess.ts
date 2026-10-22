import type {EndpointLeg} from '../peer/Endpoints.js'
import type {SignalingDescription} from '../protocol/SignalingProtocol.js'
import type {SFU, SFUTrack} from './SFU.js'

/**
 * What the HTTP endpoints (WHIP, WHEP) need of a media server
 */
export interface SFUAccess {
    /**
     * A stream published with WHIP joins a room, as a member of role `whip`
     * @param room The room.
     * @param offer The offer of the publisher.
     * @returns The id of the member, and its connection.
     * @throws {SignalingLimitException} When the server takes no more members.
     * @throws {Error} When the server does not serve the room, or the offer is refused.
     */
    publish(room: string, offer: SignalingDescription): Promise<{peerId: string, leg: EndpointLeg}>

    /**
     * A viewer of WHEP receives the audio and the video of a member of a room
     * @param room The room.
     * @param offer The offer of the viewer.
     * @param select Chooses the member among the tracks published; the default one without it.
     * @returns The id of the viewer, its connection, and its source now.
     * @throws {Error} When the server does not serve the room, or the offer is refused.
     */
    play(room: string, offer: SignalingDescription, select?: (tracks: SFUTrack[]) => string | undefined): Promise<{viewerId: string, leg: EndpointLeg & {source(): string | undefined}}>
}

/**
 * What the HTTP endpoints may do with each media server
 */
export const sfuAccess: WeakMap<SFU, SFUAccess> = new WeakMap()
