import util from 'node:util'

/**
 * The styles of the output, and their codes of the terminals (where util.styleText is missing: before Node.js 20.12)
 */
const STYLES = {bold: [1, 22], red: [31, 39], green: [32, 39], yellow: [33, 39], blue: [34, 39], magenta: [35, 39], cyan: [36, 39]} as const

type Style = keyof typeof STYLES

/**
 * A text in a style, when the output is a terminal
 * @param style
 * @param text
 */
export function styled(style: Style, text: string): string {
    if (!process.stdout.isTTY || process.env.NO_COLOR) return text
    //node-compat: util.styleText
    if (typeof util.styleText === 'function') return util.styleText(style, text)
    return `\u001b[${STYLES[style][0]}m${text}\u001b[${STYLES[style][1]}m`
}

/**
 * Print a step done
 * @param message
 */
export function done(message: string): void {
    process.stdout.write(`${styled('green', '✔')} ${message}\n`)
}

/**
 * Print a step in progress
 * @param message
 */
export function step(message: string): void {
    process.stdout.write(`${styled('cyan', '›')} ${message}\n`)
}

/**
 * Print a warning
 * @param message
 */
export function warn(message: string): void {
    process.stderr.write(`${styled('yellow', '!')} ${message}\n`)
}

/**
 * A table of names and values
 * @param rows
 * @param title
 */
export function table(rows: [string, string][], title?: string): string {
    const width: number = Math.max(...rows.map(([name]): number => name.length))
    const lines: string[] = rows.map(([name, value]): string => `  ${styled('blue', name.padEnd(width))}  ${value}`)
    return `${title ? `${styled('bold', title)}\n` : ''}${lines.map((line: string): string => `${line}\n`).join('')}`
}
