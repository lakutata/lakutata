/**
 * Derived from the upstream lib/escapeHtml.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */

const namedHtml: Map<number, string> = new Map([
    [38, '&amp;'],
    [60, '&lt;'],
    [62, '&gt;'],
    [34, '&quot;'],
    [160, '&nbsp;'],
    [162, '&cent;'],
    [163, '&pound;'],
    [164, '&curren;'],
    [169, '&copy;'],
    [174, '&reg;']
])

const safeCharCodes: Set<number> = ((): Set<number> => {
    const safe: Set<number> = new Set()
    for (let i: number = 32; i < 123; ++i) {
        if ((i >= 97) ||                    // a-z
            (i >= 65 && i <= 90) ||         // A-Z
            (i >= 48 && i <= 57) ||         // 0-9
            i === 32 ||                     // space
            i === 46 ||                     // .
            i === 44 ||                     // ,
            i === 45 ||                     // -
            i === 58 ||                     // :
            i === 95) {                     // _
            safe.add(i)
        }
    }
    return safe
})()

/**
 * Escape a character for HTML
 * @param charCode
 */
function escapeHtmlChar(charCode: number): string {
    const namedEscape: string | undefined = namedHtml.get(charCode)
    if (namedEscape) return namedEscape
    if (charCode >= 256) return '&#' + charCode + ';'
    const hexValue: string = charCode.toString(16).padStart(2, '0')
    return `&#x${hexValue};`
}

/**
 * Escape a string for HTML
 * @param input
 */
export function escapeHtml(input: string): string {
    if (!input) return ''
    let escaped: string = ''
    for (let i: number = 0; i < input.length; ++i) {
        const charCode: number = input.charCodeAt(i)
        escaped += safeCharCodes.has(charCode) ? input[i] : escapeHtmlChar(charCode)
    }
    return escaped
}
