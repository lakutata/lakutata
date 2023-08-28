import {Exception} from '../../lib/base/abstracts/Exception'

export class AccessControlConfigureRequiredException extends Exception {
    public errno: number | string = 'E_ACCESS_CONTROL_CONFIGURE_REQUIRED'
}
