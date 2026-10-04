import type {Time} from '@lakutata/utils/Time'

export type ContainerdVolumeInfo = {
    name: string
    /**
     * Its directory of the host
     */
    mountpoint: string
    labels: Record<string, string>
    createdAt: Time
}
