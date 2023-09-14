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

export class MissingValueError extends Error {
    public key: string

    constructor(key: string) {
        super(`Missing a value for ${key ? `the placeholder: ${key}` : 'a placeholder'}`)
        this.name = 'MissingValueError'
        this.key = key
    }
}

export interface TemplatingOptions {
    ignoreMissing?: boolean;
    transform?: ({value, key}: { value: any; key: string }) => any;
}

export default function Templating(template: string, data: object | any[], {
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
