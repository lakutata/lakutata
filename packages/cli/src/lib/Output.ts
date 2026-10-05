import {styleText} from 'node:util'

type Style = Parameters<typeof styleText>[0]

/**
 * A text in a style, when the output is a terminal
 * @param style
 * @param text
 */
export function styled(style: Style, text: string): string {
    return process.stdout.isTTY && !process.env.NO_COLOR ? styleText(style, text) : text
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
    return `${title ? `${styled('bold', title)}\n` : ''}${lines.join('\n')}\n`
}
