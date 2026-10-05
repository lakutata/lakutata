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
function replaceClose(text: string, index: number, close: string, open: string): string {
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
function color(open: number, close: number): Colorize {
    const openSequence: string = `\x1b[${open}m`
    const closeSequence: string = `\x1b[${close}m`
    return (input: unknown): string => {
        //Empty texts stay uncolored
        if (input === '' || input === undefined) return ''
        const text: string = `${input}`
        const index: number = text.indexOf(closeSequence, openSequence.length + 1)
        return index < 0 ? openSequence + text + closeSequence : openSequence + replaceClose(text, index, closeSequence, openSequence) + closeSequence
    }
}

const plain: Colorize = (input: unknown): string => input as string

export const PLAIN_PALETTE: Palette = {
    level: {default: plain, 60: plain, 50: plain, 40: plain, 30: plain, 20: plain, 10: plain},
    message: plain,
    property: plain
}

export const COLOR_PALETTE: Palette = {
    level: {default: color(37, 39), 60: color(41, 49), 50: color(31, 39), 40: color(33, 39), 30: color(32, 39), 20: color(34, 39), 10: color(90, 39)},
    message: color(36, 39),
    property: color(35, 39)
}
