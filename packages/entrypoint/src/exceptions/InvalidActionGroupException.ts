import {Exception} from '@lakutata/core'

export class InvalidActionGroupException extends Exception {
    public errno: string | number = 'E_INVALID_ACTION_GROUP'
}