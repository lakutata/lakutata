import {Exception} from '@lakutata/core'

/**
 * Thrown when a container is not in the state an operation needs: `exec()`, `createTTY()`, `stats()`, `kill()`,
 * `pause()`, `unpause()` and `processes()` on a container that is not running, `start()` on a paused one, `remove()`
 * on a running one without `force`, or an `update()` needing a recreation for a container the component did not
 * create. Its `errno` is `E_CONTAINERD_CONTAINER_STATE`.
 */
export class ContainerdContainerStateException extends Exception {
    public errno: string | number = 'E_CONTAINERD_CONTAINER_STATE'
}
