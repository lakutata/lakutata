import type {Time} from '@lakutata/utils/Time'

export type ContainerdContainerState = {
    status: 'created' | 'running' | 'paused' | 'pausing' | 'restarting' | 'exited' | 'unknown'
    running: boolean
    paused: boolean
    restarting: boolean
    pid: number
    exitCode: number
    startedAt: Time | null
    finishedAt: Time | null
}
