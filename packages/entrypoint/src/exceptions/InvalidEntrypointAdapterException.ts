import {Exception} from '@lakutata/core'

export class InvalidEntrypointAdapterException extends Exception {
    public errno: string | number = 'E_INVALID_ENTRYPOINT_ADAPTER'
}
