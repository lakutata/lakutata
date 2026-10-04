import type {IncomingMessage} from 'node:http'
import {Exception, ExceptionParams, RunInValidationLanguage} from '@lakutata/core'
import {Inject} from '@lakutata/core/decorator/di'
import {ContextType, HTTPRequestOfContext, Middleware, type ActionInvocation, type BaseContext, type HTTPContext, type Next, type ServiceContext} from '@lakutata/entrypoint'
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
 * The entrypoint middleware choosing the language of each request. Add it to the `middlewares` of
 * `BuildEntrypoints()`. For each request, it reads the languages the request asks for ({@link I18nMiddleware.requested}),
 * negotiates them with the supported languages of the {@link I18n} component ({@link I18n.negotiate}, the default
 * language when none matches), and makes the result:
 * - the request's `context.locale`;
 * - the language of the {@link Translator} the request's objects inject;
 * - the language of the validation errors of the request (its input, `@Accept`/`@Return`, the `DTO.validate` calls of
 *   its code);
 * - the language of the exceptions it throws: a lakutata `Exception` whose `errno` has a message `errors.<errno>`
 *   (`errors.E_ORDER_NOT_FOUND`) gets that message, formatted with the exception's template parameters.
 *
 * The languages are read, preferred first: for HTTP, the `lang` query parameter, the `lang` cookie, then
 * `Accept-Language`; for Socket.IO, the same from the connection's handshake; for the HTTP service adapter and the
 * JSON-RPC adapter over HTTP or WebSocket, the same from the HTTP request (for WebSocket, the request opening the
 * connection); for the command line and the other service transports, the process's environment
 * ({@link EnvironmentLocales}) then the process's language; for the schedules, none. It uses the component registered as `i18n`; a subclass changes the component, the names of the query
 * parameter and of the cookie, or the languages read (`requested()`).
 * @example
 * ```typescript
 * import {type BaseContext} from 'lakutata/com/entrypoint'
 * import {Inject} from 'lakutata/decorator/di'
 * import {I18nMiddleware, type I18n} from 'lakutata/com/i18n'
 *
 * //BuildEntrypoints({middlewares: [LanguageMiddleware], ...}) in place of I18nMiddleware
 * export class LanguageMiddleware extends I18nMiddleware {
 *     //The component registered as "lang"
 *     @Inject('lang')
 *     protected readonly i18n: I18n
 *
 *     //?locale=zh-CN
 *     protected readonly queryParameter: string = 'locale'
 *
 *     protected readonly environmentVariable: string = 'SHOP_LANG'
 *
 *     //The language saved by the signed-in user first
 *     protected requested(context: BaseContext): string[] {
 *         const saved: unknown = context.data.userLanguage
 *         return [...(typeof saved === 'string' ? [saved] : []), ...super.requested(context)]
 *     }
 * }
 * ```
 */
export class I18nMiddleware extends Middleware {
    /**
     * The {@link I18n} component giving the supported languages and the messages: the object registered as `i18n`.
     */
    @Inject('i18n')
    protected readonly i18n: I18n

    /**
     * The name of the query parameter giving the language of an HTTP request (of the HTTP channel, the HTTP service and
     * JSON-RPC adapters) or a Socket.IO connection (`?lang=zh-CN`); a value which is not a language tag is ignored.
     * @default 'lang'
     */
    protected readonly queryParameter: string = 'lang'

    /**
     * The name of the cookie giving the language of an HTTP request (of the HTTP channel, the HTTP service and JSON-RPC
     * adapters) or a Socket.IO connection; a value which is not a language tag is ignored.
     * @default 'lang'
     */
    protected readonly cookie: string = 'lang'

    /**
     * The name of an environment variable (`SHOP_LANG`) whose language is preferred to the ones of the environment, for
     * the command line and the service transports reading the process's languages.
     * @default none
     */
    protected readonly environmentVariable?: string

    /**
     * Negotiate the request's language, set `context.locale`, create the request's {@link Translator}, then run the
     * next middlewares and the action with the validations in that language, translating the exception they throw.
     * @param invocation The action invocation: its context and its container.
     * @param next Runs the rest of the chain.
     * @returns The result of the rest of the chain; an exception it throws is rethrown, its message translated by
     * {@link I18nMiddleware.translate}.
     */
    public async handle(invocation: ActionInvocation, next: Next): Promise<unknown> {
        const context: BaseContext = invocation.context
        const locale: string = this.i18n.negotiate(this.requested(context))
        context.locale = locale
        //The translator of the request, shared by its objects
        const translator: Translator = await invocation.container.getShared(Translator, {locale: locale, i18n: this.i18n})
        //Its validations in its language
        return await RunInValidationLanguage(locale, async (): Promise<unknown> => {
            try {
                return await next()
            } catch (error) {
                throw this.translate(error, translator)
            }
        })
    }

    /**
     * Translate an exception thrown by a request into the request's language. A lakutata `Exception` with an `errno`
     * whose key `errors.<errno>` has a message (`errors.E_ORDER_NOT_FOUND`) gets that message as its `message` and
     * `errMsg`, formatted with the parameters of its template (`{id}` for named ones, `{0}`, `{1}` for the ones given one
     * by one); its `errno` and its other properties are kept. The other errors, the exceptions without such a message,
     * and the ones whose message cannot be formatted (a process warning `I18nWarning` is then emitted) are returned
     * unchanged.
     * @param error The thrown value.
     * @param translator The request's translator.
     * @returns The same value, its message replaced when it is translated.
     */
    protected translate(error: unknown, translator: Translator): unknown {
        if (!(error instanceof Exception) || error.errno === undefined || error.errno === null) return error
        const key: string = `errors.${error.errno}`
        if (!translator.has(key)) return error
        const params: Record<string, unknown> | unknown[] | undefined = ExceptionParams(error)
        let message: string
        try {
            message = translator.t(key, Array.isArray(params) ? Object.fromEntries(params.map((value: unknown, index: number): [string, unknown] => [String(index), value])) : params ?? {})
        } catch (failure) {
            process.emitWarning(`The message ${key} of ${error.name} cannot be formatted: ${(failure as Error).message}`, 'I18nWarning')
            return error
        }
        error.message = message
        Reflect.set(error, 'errMsg', message)
        return error
    }

    /**
     * Read the languages a request asks for, preferred first:
     * - HTTP: the query parameter, the cookie, then `Accept-Language`;
     * - Socket.IO: the query parameter, the cookie and `Accept-Language` of the connection's handshake;
     * - the HTTP service adapter, and the JSON-RPC adapter over HTTP or WebSocket: the query parameter, the cookie and
     *   `Accept-Language` of the HTTP request (for WebSocket, the request opening the connection);
     * - the command line and the other service transports (Electron IPC, JSON-RPC over stdio): the environment variable
     *   of `environmentVariable`, the environment (`LANGUAGE`, `LC_ALL`, `LC_MESSAGES`, `LANG`), then the process's
     *   language;
     * - the schedules and the other contexts: none (the default language is chosen).
     * @param context The request's context.
     * @returns The requested language tags, preferred first.
     */
    protected requested(context: BaseContext): string[] {
        if (context.type === ContextType.HTTP) return this.fromRequest((context as HTTPContext).request)
        if (context.type === ContextType.SERVICE) {
            const handshake: Handshake | undefined = (context as BaseContext & { socket?: { handshake?: Handshake } }).socket?.handshake
            if (handshake) return this.fromHeaders(handshake.query?.[this.queryParameter], handshake.headers ?? {})
            //The HTTP service adapter, JSON-RPC over HTTP, and over WebSocket (the request upgraded)
            const request: IncomingMessage | undefined = HTTPRequestOfContext(context as ServiceContext)
            if (request) return this.fromRequest(request)
        }
        if (context.type === ContextType.CLI || context.type === ContextType.SERVICE) {
            return ProcessLocales(this.environmentVariable)
        }
        return []
    }

    /**
     * Read the languages of an HTTP request: its query parameter, its cookie, then its `Accept-Language`.
     * @param request The Node.js HTTP request.
     * @returns The language tags, preferred first.
     */
    protected fromRequest(request: IncomingMessage): string[] {
        return this.fromHeaders(new URL(request.url ?? '/', 'http://localhost').searchParams.get(this.queryParameter), request.headers)
    }

    /**
     * Read the languages of a query parameter, the cookie and `Accept-Language`, in that order; the query and cookie
     * values which are not language tags are skipped.
     * @param query The value of the query parameter; ignored unless it is a string.
     * @param headers The request headers, by lower-case name; for a repeated header, its first value is read.
     * @returns The language tags, preferred first.
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
     * Read the value of the language cookie (named by `cookie`) in a `Cookie` header, URI-decoded.
     * @param header The value of the `Cookie` header.
     * @returns The value of the first cookie of that name; `undefined` without it, or when it cannot be decoded.
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
