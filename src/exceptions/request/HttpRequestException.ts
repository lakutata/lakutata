import {Exception} from '../../lib/base/abstracts/Exception'

export class HttpRequestException extends Exception {
    public errno: number | string = 'E_HTTP_REQUEST'
}
