//The preparation of the strings compared by the matching rules (RFC 4518), approximated: the characters mapped to
//nothing or to a space (§2.2), NFKC (§2.3), the case folded by toLowerCase() for the case-ignoring rules (full case
//folding differs on a few characters, such as ß), the prohibited characters refused (§2.4: the private use ones and the
//noncharacters; the unassigned ones are not checked, which needs the tables of RFC 3454), and the insignificant spaces
//(§2.6.1): no space at the ends, one space between the words. Bidirectional characters are ignored, as §2.5 says.

//§2.2: mapped to nothing (soft hyphen, the joiners and the variation selectors, the byte order mark, the controls but
//tab, line feed and the like), and to a space (the other spaces and the line separators)
//Built from their code points: the combining ones (U+034F, the variation selectors) in a character class written in the
//source trip the lint on misleading character classes
const NOTHING: RegExp = new RegExp('[' + [[0xad], [0x34f], [0x1806], [0x180b, 0x180d], [0xfe00, 0xfe0f], [0xfffc], [0x200b], [0x2060], [0xfeff], [0x6dd], [0x70f], [0x180e], [0x200c, 0x200f], [0x202a, 0x202e], [0x2061, 0x2063], [0x206a, 0x206f], [0xfff9, 0xfffb]]
    .map((range: number[]): string => range.map((code: number): string => String.fromCharCode(code)).join('-')).join('') + ']', 'g')
//The controls but tab, line feed and the like, by their code points: a regular expression of control characters is refused by the lint
const CONTROLS: RegExp = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(8) + String.fromCharCode(14) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + '-' + String.fromCharCode(132) + String.fromCharCode(134) + '-' + String.fromCharCode(159) + ']', 'g')
const SPACES: RegExp = /[\t\n\v\f\r\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/g
const PROHIBITED: RegExp = /[\ue000-\uf8ff\ufdd0-\ufdef\ufffe\uffff]|[\udb80-\udbff][\udc00-\udfff]/
const RUNS: RegExp = / +/g

/**
 * Prepare a string for a comparison: RFC 4518 approximated
 * @param value The string.
 * @param caseIgnore Whether the case is folded.
 * @returns The prepared string, or undefined when it holds a prohibited character.
 */
export function prepareString(value: string, caseIgnore: boolean): string | undefined {
    let prepared: string = value.replace(NOTHING, '').replace(CONTROLS, '').replace(SPACES, ' ').normalize('NFKC')
    if (caseIgnore) prepared = prepared.toLowerCase()
    if (PROHIBITED.test(prepared)) return undefined
    return prepared.replace(RUNS, ' ').trim()
}

/**
 * Prepare a substring of a substrings assertion: as a whole string, but its spaces at the ends kept as one, since
 * "a " and " b" in `(cn=a * b)` say where the words end (§2.6.2 approximated)
 * @param value The substring.
 * @param caseIgnore Whether the case is folded.
 */
export function prepareSubstring(value: string, caseIgnore: boolean): string | undefined {
    let prepared: string = value.replace(NOTHING, '').replace(CONTROLS, '').replace(SPACES, ' ').normalize('NFKC')
    if (caseIgnore) prepared = prepared.toLowerCase()
    if (PROHIBITED.test(prepared)) return undefined
    return prepared.replace(RUNS, ' ')
}
