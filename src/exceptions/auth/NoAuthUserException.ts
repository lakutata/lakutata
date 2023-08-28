import {Exception} from '../../lib/base/abstracts/Exception'

export class NoAuthUserException extends Exception {
    public errno: number | string = 'E_NO_AUTH_USER'
}
