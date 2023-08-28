import {Exception} from '../../lib/base/abstracts/Exception'

export class AccessDenyException extends Exception {
    public errno: number | string = 'E_ACCESS_DENY'
}
