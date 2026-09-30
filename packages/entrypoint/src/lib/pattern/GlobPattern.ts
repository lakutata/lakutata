/*
 * The glob matching of the values of the patterns, rewritten from gex (Copyright (c) 2011-2020 Richard Rodger, MIT
 * License, see THIRD_PARTY_NOTICES.md)
 */

/**
 * A glob of the value of a pattern: "*" matches any characters, "?" one character, "**" is a literal "*" and "*?" a
 * literal "?". It matches a whole value, converted to a string
 */
export class GlobPattern {

    /**
     * The expression of the glob, undefined when it matches nothing (no glob)
     */
    readonly #expression: RegExp | undefined

    /**
     * Whether a value of a pattern is a glob
     * @param value
     */
    public static isGlob(value: string): boolean {
        return /[*?]/.test(value)
    }

    /**
     * @param glob the glob, nothing is matched without it
     */
    constructor(public readonly glob: unknown) {
        //NaN is the empty glob, as gex cleans it
        this.#expression = glob === null || glob === undefined ? undefined : GlobPattern.expression(Number.isNaN(glob) ? '' : String(glob))
    }

    /**
     * The regular expression of a glob
     * @param glob
     */
    protected static expression(glob: string): RegExp {
        let source: string = glob.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
        //[\s\S] matches the line feeds too
        source = source.replace(/\\\*/g, '[\\s\\S]*')
        source = source.replace(/\\\?/g, '[\\s\\S]')
        //"**" and "*?" are the literal "*" and "?"
        source = source.replace(/\[\\s\\S\]\*\[\\s\\S\]\*/g, '\\*')
        source = source.replace(/\[\\s\\S\]\*\[\\s\\S\]/g, '\\?')
        return new RegExp(`^${source}$`)
    }

    /**
     * Whether the glob matches a value converted to a string
     * @param value
     */
    public test(value: unknown): boolean {
        return !!this.#expression && this.#expression.test(String(value))
    }

    /**
     * Whether the glob matches the value of a subject: a missing value is not matched, a primitive value (a date, a
     * regular expression) is matched as a string. An array or an object is always matched, as gex does (it gives back
     * the collection of its matching elements, which is never null): the routing of the actions is the one of 2.x
     * @param value
     */
    public matches(value: unknown): boolean {
        if (value === null || value === undefined) return false
        const type: string = typeof value
        if (type === 'string' || type === 'number' || type === 'boolean' || value instanceof Date || value instanceof RegExp) return this.test(value)
        return true
    }
}
