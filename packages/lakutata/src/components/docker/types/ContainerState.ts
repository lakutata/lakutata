import {Time} from '@lakutata/core'

export type ContainerState = {
    status: 'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead'
    running: boolean
    paused: boolean
    restarting: boolean
    OOMKilled: boolean
    dead: boolean
    pid: number
    exitCode: number
    startedAt: Time | null
    finishedAt: Time | null
}
