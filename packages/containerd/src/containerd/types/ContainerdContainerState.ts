import type {Time} from '@lakutata/utils/Time'

/**
 * The state of a container ({@link ContainerdContainer.state}): the one of its task (its main process in containerd)
 * and of its last run. It is read when the container object is obtained and after each of its operations;
 * `syncContainerInfo()` reads it again.
 */
export type ContainerdContainerState = {
    /**
     * Its status: `'created'` never started; `'running'`; `'paused'`, or `'pausing'` while it is being paused;
     * `'restarting'` stopped while containerd's restart monitor is to start it again (its restart policy);
     * `'exited'` its process ended; `'unknown'` a task status containerd reports and the component does not know.
     */
    status: 'created' | 'running' | 'paused' | 'pausing' | 'restarting' | 'exited' | 'unknown'
    /**
     * Whether its process runs (`status` is `'running'`); `false` while it is paused.
     */
    running: boolean
    /**
     * Whether it is paused (`status` is `'paused'`).
     */
    paused: boolean
    /**
     * Whether its restart monitor is restarting it (`status` is `'restarting'`).
     */
    restarting: boolean
    /**
     * The host process ID of its main process, `0` when it has no task.
     */
    pid: number
    /**
     * The exit code of its last run, `0` before its first exit.
     */
    exitCode: number
    /**
     * When it was last started, `null` when it never was.
     */
    startedAt: Time | null
    /**
     * When its last run ended, `null` while it runs after a start and when it never ended.
     */
    finishedAt: Time | null
}
