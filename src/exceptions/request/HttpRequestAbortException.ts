import {Exception} from '../../lib/base/abstracts/Exception'

export class HttpRequestAbortException extends Exception {
    public errno: number | string = 'E_HTTP_REQUEST_ABORT'
}
