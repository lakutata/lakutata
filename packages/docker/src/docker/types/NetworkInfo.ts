import {Time} from '@lakutata/utils/time'

export type NetworkIPAMConfig = {
    subnet: string
    range?: string
    gateway: string
}

export type NetworkInfo = {
    id: string
    name: string
    driver: 'bridge' | 'ipvlan' | 'macvlan'
    reserved: boolean
    internal: boolean
    enableIPv6: boolean
    IPAMConfigs: NetworkIPAMConfig[],
    createdAt: Time
}
