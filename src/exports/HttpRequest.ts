import axios, {
    AxiosError,
    AxiosInstance,
    AxiosResponse
} from 'axios'
import {UrlObject, parse as ParseURL, format as FormatURL} from 'url'
import {Agent as HttpAgent} from 'http'
import {Agent as HttpsAgent} from 'https'
import {HttpRequestAbortException} from '../exceptions/request/HttpRequestAbortException'
import {HttpRequestException} from '../exceptions/request/HttpRequestException'
import {Validator} from './Validator'
import ReadableStream = NodeJS.ReadableStream

/**
 * Http请求方法
 */
export type HttpRequestMethod = 'GET' | 'POST' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'PATCH'

export type HttpResponseType = 'arraybuffer' | 'document' | 'json' | 'text' | 'stream'

/**
 * Http请求参数
 */
export interface HttpRequestOptions {
    headers: Record<string, string>
    body: any | undefined
    timeout: number
    /**
     * 是否在发送跨域请求时携带跨域凭证信息
     */
    withCredentials: boolean
    /**
     * Http basic auth信息
     */
    auth: {
        username: string
        password: string
    } | undefined
    responseEncoding: BufferEncoding
    /**
     * CSRF跨域信息
     */
    csrf: {
        cookieName: string
        headerName: string
    } | undefined
    /**
     * 最大内容长度
     */
    maxContentLength: number
    /**
     * 最大Body长度
     */
    maxBodyLength: number
    /**
     * 最大重定向数
     */
    maxRedirects: number
    httpAgent: HttpAgent | undefined
    httpsAgent: HttpsAgent | undefined
    /**
     * 速率限制，单位为Bytes,置为0则表示无限制
     */
    speedLimit: {
        upload: number | undefined
        download: number | undefined
    } | undefined
}

/**
 * Http请求类
 */
export class HttpRequest {

    protected readonly method: HttpRequestMethod

    protected readonly url: string

    protected readonly options: HttpRequestOptions

    protected readonly abortController: AbortController = new AbortController()

    protected readonly requestInstance: AxiosInstance

    protected _$done: boolean = false

    protected _$data: any | null = null

    protected _$status: number | null = null

    protected _$statusText: string | null = null

    protected _$responseHeaders: Record<string, any> | null = null

    protected _$error: Error | null = null

    constructor(method: HttpRequestMethod, urlObject: UrlObject, options?: Partial<HttpRequestOptions>) {
        this.options = Object.assign({
            headers: {},
            body: undefined,
            withCredentials: false,
            auth: undefined,
            timeout: 0,
            responseEncoding: 'utf-8',
            csrf: undefined,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            maxRedirects: 8,
            httpAgent: undefined,
            httpsAgent: undefined,
            speedLimit: {
                upload: 0,
                download: 0
            }
        }, options ? options : {})
        this.abortController = new AbortController()
        this.abortController.signal.onabort = (e: Event): void => {
            if (!this._$error && !this._$done) this._$error = new HttpRequestAbortException('Canceled')
        }
        this.method = method
        this.url = FormatURL(urlObject)
        this.requestInstance = axios.create({
            adapter: 'http',
            headers: this.options.headers,
            data: this.options.body,
            timeout: this.options.timeout,
            withCredentials: this.options.withCredentials,
            auth: this.options.auth,
            responseEncoding: this.options.responseEncoding,
            xsrfCookieName: this.options.csrf?.cookieName,
            xsrfHeaderName: this.options.csrf?.headerName,
            maxContentLength: this.options.maxBodyLength,
            maxBodyLength: this.options.maxBodyLength,
            maxRedirects: this.options.maxRedirects,
            httpAgent: this.options.httpAgent,
            httpsAgent: this.options.httpsAgent,
            signal: this.abortController.signal,
            maxRate: [
                this.options.speedLimit?.upload ? this.options.speedLimit.upload : Infinity,
                this.options.speedLimit?.download ? this.options.speedLimit.download : Infinity
            ]
        })
    }

    /**
     * 执行请求
     * @protected
     */
    protected async __request(responseType: HttpResponseType = 'json'): Promise<void> {
        return new Promise<void>(resolve => {
            this.requestInstance.request({
                url: this.url,
                method: this.method,
                responseType: responseType
            }).then((response: AxiosResponse): void => {
                this._$data = response.data
                this._$status = response.status
                this._$statusText = response.statusText
                this._$responseHeaders = {...response.headers}
            }).catch((error: AxiosError): void => {
                const httpRequestException: HttpRequestException = new HttpRequestException(error.message)
                httpRequestException.errno = error.code ? error.code : httpRequestException.errno
                this._$error = this._$error ? this._$error : httpRequestException
                this._$status = error.response?.status ? error.response.status : this._$status
                this._$statusText = error.response?.statusText ? error.response.statusText : this._$statusText
                this._$responseHeaders = error.response?.headers ? {...error.response.headers} : this._$responseHeaders
            }).finally((): void => {
                this._$done = true
                return resolve()
            })
        })
    }

    /**
     * 中断请求
     */
    public abort(): void {
        this.abortController.abort()
    }

    /**
     * 获取请求返回的状态码
     */
    public statusCode(): number | null {
        return this._$status
    }

    /**
     * 获取返回的状态文本
     */
    public statusText(): string | null {
        return this._$statusText
    }

    /**
     * 获取返回的响应头
     */
    public responseHeaders(): Record<string, any> | null {
        return this._$responseHeaders
    }

    /**
     * 请求并返回JSON数据
     * @param validate
     */
    public async json(validate: boolean = true): Promise<Record<any, any>> {
        await this.__request('json')
        if (this._$error) throw this._$error
        return validate ? await Validator.validateAsync(this._$data, Validator.Object(), {stripUnknown: false}) : this._$data
    }

    /**
     * 请求并返回纯文本数据
     * @param validate
     */
    public async text(validate: boolean = true): Promise<string> {
        await this.__request('text')
        if (this._$error) throw this._$error
        return validate ? await Validator.validateAsync(this._$data, Validator.String(), {stripUnknown: false}) : this._$data
    }

    /**
     * 请求并返回文档数据(XML或HTML内容格式)
     */
    public async document(validate: boolean = true): Promise<string> {
        await this.__request('document')
        if (this._$error) throw this._$error
        return validate ? await Validator.validateAsync(this._$data, Validator.HttpDocument(), {stripUnknown: false}) : this._$data
    }

    /**
     * 请求并返回Buffer数据
     */
    public async buffer(validate: boolean = true): Promise<Buffer> {
        await this.__request('arraybuffer')
        if (this._$error) throw this._$error
        return validate ? await Validator.validateAsync(this._$data, Validator.Binary(), {stripUnknown: false}) : this._$data
    }

    public async stream(): Promise<ReadableStream> {
        await this.__request('stream')
        return this._$data
    }

    /**
     * GET请求
     */
    public static get(url: string, options?: Omit<Partial<HttpRequestOptions>, 'body' | 'maxBodyLength'>): HttpRequest
    public static get(urlObject: UrlObject, options?: Omit<Partial<HttpRequestOptions>, 'body' | 'maxBodyLength'>): HttpRequest
    public static get(inp: string | UrlObject, options?: Omit<Partial<HttpRequestOptions>, 'body' | 'maxBodyLength'>): HttpRequest {
        return new this('GET', typeof inp === 'string' ? ParseURL(inp) : inp, options)
    }

    /**
     * POST请求
     */
    public static post(url: string, options?: Partial<HttpRequestOptions>): HttpRequest
    public static post(urlObject: UrlObject, options?: Partial<HttpRequestOptions>): HttpRequest
    public static post(inp: string | UrlObject, options?: Partial<HttpRequestOptions>): HttpRequest {
        return new this('POST', typeof inp === 'string' ? ParseURL(inp) : inp, options)
    }

    /**
     * DELETE请求
     */
    public static delete(url: string, options?: Omit<Partial<HttpRequestOptions>, 'body' | 'maxBodyLength'>): HttpRequest
    public static delete(urlObject: UrlObject, options?: Omit<Partial<HttpRequestOptions>, 'body' | 'maxBodyLength'>): HttpRequest
    public static delete(inp: string | UrlObject, options?: Omit<Partial<HttpRequestOptions>, 'body' | 'maxBodyLength'>): HttpRequest {
        return new this('DELETE', typeof inp === 'string' ? ParseURL(inp) : inp, options)
    }

    /**
     * HEAD请求
     */
    public static head(url: string, options?: Omit<Partial<HttpRequestOptions>, 'body' | 'maxBodyLength'>): HttpRequest
    public static head(urlObject: UrlObject, options?: Omit<Partial<HttpRequestOptions>, 'body' | 'maxBodyLength'>): HttpRequest
    public static head(inp: string | UrlObject, options?: Omit<Partial<HttpRequestOptions>, 'body' | 'maxBodyLength'>): HttpRequest {
        return new this('HEAD', typeof inp === 'string' ? ParseURL(inp) : inp, options)
    }

    /**
     * OPTIONS请求
     */
    public static options(url: string, options?: Omit<Partial<HttpRequestOptions>, 'body' | 'maxBodyLength'>): HttpRequest
    public static options(urlObject: UrlObject, options?: Omit<Partial<HttpRequestOptions>, 'body' | 'maxBodyLength'>): HttpRequest
    public static options(inp: string | UrlObject, options?: Omit<Partial<HttpRequestOptions>, 'body' | 'maxBodyLength'>): HttpRequest {
        return new this('OPTIONS', typeof inp === 'string' ? ParseURL(inp) : inp, options)
    }

    /**
     * PATCH请求
     */
    public static patch(url: string, options?: Partial<HttpRequestOptions>): HttpRequest
    public static patch(urlObject: UrlObject, options?: Partial<HttpRequestOptions>): HttpRequest
    public static patch(inp: string | UrlObject, options?: Partial<HttpRequestOptions>): HttpRequest {
        return new this('PATCH', typeof inp === 'string' ? ParseURL(inp) : inp, options)
    }

}
