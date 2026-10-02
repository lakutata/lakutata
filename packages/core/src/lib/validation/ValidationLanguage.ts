import {AsyncLocalStorage} from 'node:async_hooks'

/**
 * The language of the validations of the code running (the language of a request)
 */
const LANGUAGE: AsyncLocalStorage<string> = new AsyncLocalStorage()

/**
 * Run a function with the language of its validations: their errors are in the language (its messages registered by
 * RegisterValidationMessages), the validations giving a language of their own (errors.language) excepted. The valid
 * values are validated as without the language: an invalid value only is validated again in it
 * @param language
 * @param fn
 */
export function RunInValidationLanguage<T>(language: string, fn: () => T): T {
    return LANGUAGE.run(language, fn)
}

/**
 * The language of the validations of the code running, undefined outside of RunInValidationLanguage()
 */
export function CurrentValidationLanguage(): string | undefined {
    return LANGUAGE.getStore()
}
