import {Exception} from '@lakutata/core'

export class DuplicateActionNameException extends Exception {
    public errno: string | number = 'E_DUPLICATE_ACTION_NAME'
}