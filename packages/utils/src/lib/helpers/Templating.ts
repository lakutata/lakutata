const _htmlEscape = (string: string) => string
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

function htmlEscape(strings: string | TemplateStringsArray, ...values: any[]): string {
    if (typeof strings === 'string') {
        return _htmlEscape(strings)
    }

    let output: string = strings[0]
    for (const [index, value] of values.entries()) {
        output = output + _htmlEscape(String(value)) + strings[index + 1]
    }

    return output
}

/**
 * Thrown by `templating` when a placeholder has no value (its value is `undefined`) and `ignoreMissing` is off. Its
 * `name` is `'MissingValueError'`.
 * @example
 * ```typescript
 * import {MissingValueError, templating} from 'lakutata/utils'
 *
 * try {
 *     templating('Hello {user.name}', {user: {}})
 * } catch (error) {
 *     if (error instanceof MissingValueError) console.log(error.key, '|', error.message)
 *     //user.name | Missing a value for the placeholder: user.name
 * }
 * ```
 */
export class MissingValueError extends Error {
    /**
     * The placeholder's key, as written in the template (`'user.name'`).
     */
    public key: string

    constructor(key: string) {
        super(`Missing a value for ${key ? `the placeholder: ${key}` : 'a placeholder'}`)
        this.name = 'MissingValueError'
        this.key = key
    }
}

/**
 * The options of `templating`.
 */
export interface TemplatingOptions {
    /**
     * Whether a placeholder without value is left as is in the output (`{name}`), instead of throwing a
     * `MissingValueError`.
     * @default false
     */
    ignoreMissing?: boolean
    /**
     * Transform each value before it is inserted: given the value found (`undefined` when missing) and the
     * placeholder's key, it returns the value to insert. Returning `undefined` makes the placeholder missing.
     * @default the value unchanged
     */
    transform?: ({value, key}: { value: any, key: string }) => any
}

/**
 * Fill a template's placeholders with the values of an object or an array. `{key}` inserts the value as is,
 * `{{key}}` inserts it HTML-escaped (`&`, `"`, `'`, `<`, `>`). A key is an index (`{0}`) or a path of properties
 * separated by dots (`{user.name}`); its words may contain letters, digits, `_`, `$` and `-`, and no spaces (`{ name }`
 * is left as text). The values are converted with `String()`: `null` gives `'null'`, an object `'[object Object]'`;
 * only `undefined` is missing.
 * @param template The template.
 * @param data The values, by key: an object or an array.
 * @param options What to do with the missing values, and a transformation of the values.
 * @returns The filled template.
 * @throws {TypeError} When `template` is not a string, or `data` is not an object (`null` passes this check, and its
 * placeholders are then missing).
 * @throws {MissingValueError} When a placeholder has no value and `ignoreMissing` is off.
 * @example
 * ```typescript
 * import {templating} from 'lakutata/utils'
 *
 * console.log(templating('Hello {user.name}, you have {count} messages', {user: {name: 'Ada'}, count: 3}))
 * //Hello Ada, you have 3 messages
 * console.log(templating('<p>{{comment}}</p>', {comment: '<b>hi</b>'}))
 * //<p>&lt;b&gt;hi&lt;/b&gt;</p>
 * console.log(templating('{0} and {1}, {missing}', ['tea', 'cake'], {ignoreMissing: true}))
 * //tea and cake, {missing}
 * ```
 */
export function templating(template: string, data: object | any[], {
    ignoreMissing = false,
    transform = ({value}) => value
}: TemplatingOptions = {}) {
    if (typeof template !== 'string') {
        throw new TypeError(`Expected a \`string\` in the first argument, got \`${typeof template}\``)
    }

    if (typeof data !== 'object') {
        throw new TypeError(`Expected an \`object\` or \`Array\` in the second argument, got \`${typeof data}\``)
    }

    const replace = (placeholder: string, key: string) => {
        let value = data
        for (const property of key.split('.')) {
            value = value ? value[property] : undefined
        }

        const transformedValue = transform({value, key})
        if (transformedValue === undefined) {
            if (ignoreMissing) {
                return placeholder
            }

            throw new MissingValueError(key)
        }

        return String(transformedValue)
    }

    const composeHtmlEscape = (replacer: (...args: any[]) => string) => (...args: any[]) => htmlEscape(replacer(...args))

    // The regex tries to match either a number inside `{{ }}` or a valid JS identifier or key path.
    const doubleBraceRegex = /{{(\d+|[a-z$_][\w\-$]*?(?:\.[\w\-$]*?)*?)}}/gi

    if (doubleBraceRegex.test(template)) {
        template = template.replace(doubleBraceRegex, composeHtmlEscape(replace))
    }

    const braceRegex = /{(\d+|[a-z$_][\w\-$]*?(?:\.[\w\-$]*?)*?)}/gi

    return template.replace(braceRegex, replace)
}
