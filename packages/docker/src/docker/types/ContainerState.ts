import {Time} from '@lakutata/utils/Time'

/**
 * A container's state, as Docker reports it when the container is read (`DockerContainer.state`, updated by its
 * `start()`, `stop()`, `pause()`… methods).
 */
export type ContainerState = {
    /**
     * The container's status: `'created'` (never started), `'running'`, `'paused'`, `'restarting'`, `'removing'`,
     * `'exited'` or `'dead'` (could not be removed).
     */
    status: 'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead'
    /**
     * `true` while the container is running, paused included.
     */
    running: boolean
    /**
     * `true` while the container is paused.
     */
    paused: boolean
    /**
     * `true` while Docker restarts the container after its exit.
     */
    restarting: boolean
    /**
     * `true` when the kernel's OOM killer killed one of its processes, for lack of memory.
     */
    OOMKilled: boolean
    /**
     * `true` when the container is dead: Docker failed to remove it.
     */
    dead: boolean
    /**
     * The host process ID of the container's main process, `0` when it is not running.
     */
    pid: number
    /**
     * The exit code of the container's last run, `0` when it has not exited.
     */
    exitCode: number
    /**
     * When the container was last started; `null` when it was never started.
     */
    startedAt: Time | null
    /**
     * When the container last exited; `null` when it never exited.
     */
    finishedAt: Time | null
}
