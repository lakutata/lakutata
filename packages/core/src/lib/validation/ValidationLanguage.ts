import {AsyncLocalStorage} from 'node:async_hooks'

/**
 * The language of the validations of the code running (the language of a request)
 */
const LANGUAGE: AsyncLocalStorage<string> = new AsyncLocalStorage()

/**
 * Run a function with a validation language: the validation errors raised in it, its asynchronous continuations
 * included, have their messages in that language (the messages registered by `registerValidationMessages()`), except
 * for the validations giving their own `errors.language` option. The codes without a message in the language keep the
 * default (English) one, and so does every code of a language with no registered messages.
 * @param language The language tag the messages are registered under, like `fr` or `zh-CN`.
 * @param fn The function to run; it may be asynchronous.
 * @returns What the function returns (its promise, for an asynchronous function).
 * @remarks A valid value is validated as without a language: only an invalid value is validated a second time, in the
 * language, for its messages.
 * @example
 * ```typescript
 * import {DTO, loadValidationMessages, registerValidationMessages, runInValidationLanguage} from 'lakutata'
 *
 * const messages: Record<string, string> | undefined = await loadValidationMessages('fr')
 * if (messages) registerValidationMessages('fr', messages)
 *
 * await runInValidationLanguage('fr', async (): Promise<void> => {
 *     try {
 *         DTO.validate('', DTO.String().required())
 *     } catch (error) {
 *         //The message is in French
 *         console.log((error as Error).message)
 *     }
 * })
 * ```
 */
export function runInValidationLanguage<T>(language: string, fn: () => T): T {
    return LANGUAGE.run(language, fn)
}

/**
 * The validation language of the code running, set by `runInValidationLanguage()`.
 * @returns The language tag, or undefined outside of `runInValidationLanguage()`.
 * @example
 * ```typescript
 * import {currentValidationLanguage, runInValidationLanguage} from 'lakutata'
 *
 * console.log(currentValidationLanguage()) //undefined
 * runInValidationLanguage('ja', (): void => {
 *     console.log(currentValidationLanguage()) //ja
 * })
 * ```
 */
export function currentValidationLanguage(): string | undefined {
    return LANGUAGE.getStore()
}
