import type {EndpointLeg} from '../peer/Endpoints.js'
import type {SignalingDescription} from '../protocol/SignalingProtocol.js'
import type {SFU} from './SFU.js'

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
}

/**
 * What the HTTP endpoints may do with each media server
 */
export const sfuAccess: WeakMap<SFU, SFUAccess> = new WeakMap()
