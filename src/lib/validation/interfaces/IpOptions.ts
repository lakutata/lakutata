import {PresenceMode} from '../types/PresenceMode.js'

export interface IpOptions {
    /**
     * One or more IP address versions to validate against. Valid values: ipv4, ipv6, ipvfuture
     */
    version?: string | string[];
    /**
     * Used to determine if a CIDR is allowed or not. Valid values: optional, required, forbidden
     */
    cidr?: PresenceMode;
}
