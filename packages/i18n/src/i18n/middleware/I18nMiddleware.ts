import type {IncomingMessage} from 'node:http'
import {Inject} from '@lakutata/core/decorator/di'
import {ContextType, Middleware, type ActionInvocation, type BaseContext, type HTTPContext, type Next} from '@lakutata/entrypoint'
import type {I18n} from '../I18n.js'
import {Translator} from '../Translator.js'
import {NormalizeLocale, ParseAcceptLanguage, ProcessLocales} from '../lib/Locale.js'

/**
 * The headers and the query of a Socket.IO connection (its handshake)
 */
type Handshake = {
    headers?: Record<string, string | string[] | undefined>
    query?: Record<string, unknown>
}

/**
 * The language of each request: negotiated from the languages the request asks for, it is the language of the
 * Translator of the request and of the errors of the validation of its input. The I18n component it uses is the
 * object "i18n"; a subclass changes it, the names of the query parameter and of the cookie, or the languages asked for
 * (requested())
 */
export class I18nMiddleware extends Middleware {
    @Inject('i18n')
    protected readonly i18n: I18n

    /**
     * The query parameter giving the language (?lang=zh-CN)
     */
    protected readonly queryParameter: string = 'lang'

    /**
     * The cookie giving the language
     */
    protected readonly cookie: string = 'lang'

    /**
     * The environment variable giving the language of the command line and of Electron before the ones of the
     * environment (LAKUTATA_LANG), none by default
     */
    protected readonly environmentVariable?: string

    public async handle(invocation: ActionInvocation, next: Next): Promise<unknown> {
        const context: BaseContext = invocation.context
        const locale: string = this.i18n.negotiate(this.requested(context))
        context.locale = locale
        //The translator of the request, shared by its objects
        await invocation.container.getShared(Translator, {locale: locale, i18n: this.i18n})
        return await next()
    }

    /**
     * The languages a request asks for, preferred first:
     * - HTTP: the query parameter, the cookie, Accept-Language;
     * - Socket.IO: the query parameter, the cookie and Accept-Language of its connection;
     * - the command line and Electron: the environment variable of the middleware, the environment (LC_ALL,
     *   LC_MESSAGES, LANG), the language of the process;
     * - the schedules: none (the default language)
     * @param context
     */
    protected requested(context: BaseContext): string[] {
        if (context.type === ContextType.HTTP) {
            const request: IncomingMessage = (context as HTTPContext).request
            return this.fromHeaders(new URL(request.url ?? '/', 'http://localhost').searchParams.get(this.queryParameter), request.headers)
        }
        if (context.type === ContextType.SERVICE) {
            const handshake: Handshake | undefined = (context as BaseContext & { socket?: { handshake?: Handshake } }).socket?.handshake
            if (handshake) return this.fromHeaders(handshake.query?.[this.queryParameter], handshake.headers ?? {})
        }
        if (context.type === ContextType.CLI || context.type === ContextType.SERVICE) {
            return ProcessLocales(this.environmentVariable)
        }
        return []
    }

    /**
     * The languages of a query parameter, a cookie and Accept-Language
     * @param query
     * @param headers
     */
    protected fromHeaders(query: unknown, headers: Record<string, string | string[] | undefined>): string[] {
        const single = (value: string | string[] | undefined): string | undefined => Array.isArray(value) ? value[0] : value
        const requested: string[] = []
        if (typeof query === 'string' && NormalizeLocale(query)) requested.push(query)
        const cookie: string | undefined = this.cookieValue(single(headers.cookie))
        if (cookie && NormalizeLocale(cookie)) requested.push(cookie)
        return [...requested, ...ParseAcceptLanguage(single(headers['accept-language']))]
    }

    /**
     * The value of the cookie of the language in a Cookie header
     * @param header
     */
    protected cookieValue(header: string | undefined): string | undefined {
        for (const part of header?.split(';') ?? []) {
            const separator: number = part.indexOf('=')
            if (separator < 0 || part.slice(0, separator).trim() !== this.cookie) continue
            try {
                return decodeURIComponent(part.slice(separator + 1).trim())
            } catch {
                return undefined
            }
        }
        return undefined
    }
}
