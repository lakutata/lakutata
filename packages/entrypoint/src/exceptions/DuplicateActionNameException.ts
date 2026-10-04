import {Exception} from '@lakutata/core'

/**
 * Two actions of a channel have the same name (`name` of their options, `Class:method` by default), when the
 * entrypoint initializes. Its errno is `E_DUPLICATE_ACTION_NAME`.
 */
export class DuplicateActionNameException extends Exception {
    public errno: string | number = 'E_DUPLICATE_ACTION_NAME'
}