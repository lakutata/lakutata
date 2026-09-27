//Derived from the upstream projects listed in THIRD_PARTY_NOTICES.md (rewritten in TypeScript)
export type Colorize = (input: unknown) => string

export type Palette = {
    //Colorize a level label, by its level number or "default"
    level: Record<string, Colorize>
    message: Colorize
    property: Colorize
}

/**
 * Replace the close sequences of a text by the open sequence, so a color is not closed early by a nested one
 * @param text
 * @param index
 * @param close
 * @param open
 */
function ReplaceClose(text: string, index: number, close: string, open: string): string {
    let result: string = ''
    let tail: string = text
    while (index >= 0) {
        result += tail.substring(0, index) + open
        tail = tail.substring(index + close.length)
        index = tail.indexOf(close)
    }
    return result + tail
}

/**
 * An ANSI color
 * @param open
 * @param close
 */
function Color(open: number, close: number): Colorize {
    const openSequence: string = `\x1b[${open}m`
    const closeSequence: string = `\x1b[${close}m`
    return (input: unknown): string => {
        //Empty texts stay uncolored
        if (input === '' || input === undefined) return ''
        const text: string = `${input}`
        const index: number = text.indexOf(closeSequence, openSequence.length + 1)
        return index < 0 ? openSequence + text + closeSequence : openSequence + ReplaceClose(text, index, closeSequence, openSequence) + closeSequence
    }
}

const PLAIN: Colorize = (input: unknown): string => input as string

export const PLAIN_PALETTE: Palette = {
    level: {default: PLAIN, 60: PLAIN, 50: PLAIN, 40: PLAIN, 30: PLAIN, 20: PLAIN, 10: PLAIN},
    message: PLAIN,
    property: PLAIN
}

export const COLOR_PALETTE: Palette = {
    level: {default: Color(37, 39), 60: Color(41, 49), 50: Color(31, 39), 40: Color(33, 39), 30: Color(32, 39), 20: Color(34, 39), 10: Color(90, 39)},
    message: Color(36, 39),
    property: Color(35, 39)
}
