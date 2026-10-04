import {Exception} from '@lakutata/core'

/**
 * The abort reason of {@link MutexLock.signal} when a lock is lost: a renewal found it expired or taken by another
 * holder, a renewal failed, or the connection holding it closed. It is not thrown by the component: the work holding the
 * lock meets it through the signal (`signal.throwIfAborted()`, an `AbortSignal`-aware API). Its `errno` is
 * `'E_MUTEX_LOST'`.
 */
export class MutexLostException extends Exception {
    /**
     * `'E_MUTEX_LOST'`.
     */
    public errno: string | number = 'E_MUTEX_LOST'
}
