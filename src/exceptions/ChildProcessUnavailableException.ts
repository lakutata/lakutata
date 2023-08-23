import {Exception} from '../lib/base/abstracts/Exception'

export class ChildProcessUnavailableException extends Exception {
    public errno: number | string = 'E_CHILD_PROCESS_UNAVAILABLE'
}
