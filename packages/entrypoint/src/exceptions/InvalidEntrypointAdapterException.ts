import {Exception} from '@lakutata/core'

/**
 * An option of the entrypoint is given an adapter of another channel, an adapter of an undefined channel, or a value
 * which is neither an option nor an adapter, when the entrypoint initializes. Its errno is
 * `E_INVALID_ENTRYPOINT_ADAPTER`.
 */
export class InvalidEntrypointAdapterException extends Exception {
    public errno: string | number = 'E_INVALID_ENTRYPOINT_ADAPTER'
}
