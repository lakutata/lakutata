/**
 * The patterns of the globs: the expansion of their braces and the matchers of their segments
 */

/**
 * The characters making a segment a pattern (not a name)
 */
const MAGIC: RegExp = /[*?[]/

/**
 * A segment of a pattern: a name, a globstar (**), or a matcher of the names of a directory
 */
export type GlobSegment =
    | { readonly type: 'name', readonly name: string }
    | { readonly type: 'globstar' }
    | { readonly type: 'pattern', readonly regex: RegExp, readonly dot: boolean }

/**
 * Split a list of a brace at its top level commas
 * @param body
 */
function splitAlternatives(body: string): string[] {
    const parts: string[] = []
    let depth: number = 0
    let start: number = 0
    for (let i: number = 0; i < body.length; i++) {
        const char: string = body[i]
        if (char === '\\') {
            i++
        } else if (char === '{') {
            depth++
        } else if (char === '}') {
            depth--
        } else if (char === ',' && depth === 0) {
            parts.push(body.substring(start, i))
            start = i + 1
        }
    }
    parts.push(body.substring(start))
    return parts
}

/**
 * The values of a sequence brace ({1..3}, {a..c}, {1..10..2}), undefined when it is not a sequence
 * @param body
 */
function sequence(body: string): string[] | undefined {
    const match: RegExpExecArray | null = /^(-?\d+|[a-zA-Z])\.\.(-?\d+|[a-zA-Z])(?:\.\.(-?\d+))?$/.exec(body)
    if (!match) return undefined
    const numeric: boolean = /\d/.test(match[1])
    if (numeric !== /\d/.test(match[2])) return undefined
    const start: number = numeric ? parseInt(match[1]) : match[1].charCodeAt(0)
    const end: number = numeric ? parseInt(match[2]) : match[2].charCodeAt(0)
    const step: number = Math.max(Math.abs(match[3] ? parseInt(match[3]) : 1), 1)
    //Zero padded numbers keep their width
    const width: number = numeric && (/^-?0\d/.test(match[1]) || /^-?0\d/.test(match[2])) ? Math.max(match[1].length, match[2].length) : 0
    const values: string[] = []
    for (let value: number = start; start <= end ? value <= end : value >= end; value += start <= end ? step : -step) {
        if (!numeric) {
            values.push(String.fromCharCode(value))
        } else {
            const digits: string = String(Math.abs(value)).padStart(width - (value < 0 ? 1 : 0), '0')
            values.push(value < 0 ? `-${digits}` : digits)
        }
    }
    return values
}

/**
 * Expand the braces of a pattern ({a,b} and {1..3}, nested); a brace without comma nor sequence is kept
 * @param pattern
 * @constructor
 */
export function expandBraces(pattern: string): string[] {
    let depth: number = 0
    let open: number = -1
    for (let i: number = 0; i < pattern.length; i++) {
        const char: string = pattern[i]
        if (char === '\\') {
            i++
        } else if (char === '{') {
            if (depth++ === 0) open = i
        } else if (char === '}' && depth > 0 && --depth === 0) {
            const prefix: string = pattern.substring(0, open)
            const body: string = pattern.substring(open + 1, i)
            const suffix: string = pattern.substring(i + 1)
            const alternatives: string[] | undefined = sequence(body) ?? (splitAlternatives(body).length > 1 ? splitAlternatives(body) : undefined)
            //Not a list nor a sequence: the brace is kept as it is, the braces after it are expanded
            if (!alternatives) return expandBraces(suffix).map((rest: string): string => `${prefix}{${body}}${rest}`)
            return alternatives.flatMap((alternative: string): string[] => expandBraces(`${prefix}${alternative}${suffix}`))
        }
    }
    return [pattern]
}

/**
 * The regular expression of a character class from its "[", undefined when it is not closed
 * @param segment
 * @param start
 */
function parseCharacterClass(segment: string, start: number): { source: string, end: number } | undefined {
    let i: number = start + 1
    let source: string = '['
    if (segment[i] === '!' || segment[i] === '^') {
        source += '^'
        i++
    }
    //A "]" right after the "[" (or the negation) is a character of the class
    if (segment[i] === ']') {
        source += '\\]'
        i++
    }
    for (; i < segment.length; i++) {
        const char: string = segment[i]
        if (char === ']') return {source: source + ']', end: i}
        if (char === '\\' && i + 1 < segment.length) {
            source += `\\${segment[++i]}`
        } else if (char === '[' || char === '^') {
            source += `\\${char}`
        } else {
            source += char
        }
    }
    return undefined
}

/**
 * Remove the escapes of a name
 * @param segment
 */
function unescape(segment: string): string {
    return segment.replace(/\\(.)/g, '$1')
}

/**
 * Whether a segment has a wildcard or a class (not escaped)
 * @param segment
 */
function isMagic(segment: string): boolean {
    return MAGIC.test(segment.replace(/\\./g, ''))
}

/**
 * Compile a segment of a pattern
 * @param segment
 * @param nocase
 * @constructor
 */
export function compileSegment(segment: string, nocase: boolean): GlobSegment {
    if (segment === '**') return {type: 'globstar'}
    if (!isMagic(segment)) return {type: 'name', name: unescape(segment)}
    let source: string = '^'
    for (let i: number = 0; i < segment.length; i++) {
        const char: string = segment[i]
        if (char === '\\' && i + 1 < segment.length) {
            source += segment[++i].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
        } else if (char === '*') {
            //Consecutive stars are one star in a segment
            while (segment[i + 1] === '*') i++
            source += '[^/]*'
        } else if (char === '?') {
            source += '[^/]'
        } else if (char === '[') {
            const characterClass: { source: string, end: number } | undefined = parseCharacterClass(segment, i)
            if (characterClass) {
                source += characterClass.source
                i = characterClass.end
            } else {
                source += '\\['
            }
        } else {
            source += char.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
        }
    }
    //A pattern starting with a dot matches the names starting with a dot
    return {type: 'pattern', regex: new RegExp(source + '$', nocase ? 'i' : ''), dot: segment[0] === '.'}
}
