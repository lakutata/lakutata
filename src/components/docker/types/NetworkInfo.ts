import {Time} from '../../../lib/core/Time.js'

export type NetworkIPAMConfig = {
    subnet: string
    range?: string
    gateway: string
}

export type NetworkContainer = {
    id: string
    name: string
    endpointId: string
    mac: string
    ipv4: string
    ipv6: string
}

export type NetworkInfo = {
    id: string
    name: string
    driver: 'bridge' | 'ipvlan' | 'macvlan'
    internal: boolean
    enableIPv6: boolean
    IPAMConfigs: NetworkIPAMConfig[],
    createdAt: Time
}
