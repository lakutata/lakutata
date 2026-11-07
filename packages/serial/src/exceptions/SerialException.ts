import {Exception} from '@lakutata/core'

/**
 * The exception of the package: a port that cannot be opened (not found, busy, not a serial port), options it refuses,
 * a read or a write that failed. Its `errno` is `'E_SERIAL'`; `code` names the error of the system.
 */
export class SerialException extends Exception {
    /**
     * `'E_SERIAL'`.
     */
    public errno: string | number = 'E_SERIAL'

    /**
     * The error of the system, when one caused it: `'ENOENT'` (no such port), `'EBUSY'` (open elsewhere), `'EACCES'`
     * (not allowed), `'ENOTTY'` (not a serial port), `'EIO'` (the device gone), `'EINVAL'` (options it refuses)…
     */
    public code?: string
}
