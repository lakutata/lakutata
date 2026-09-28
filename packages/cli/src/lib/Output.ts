import {styleText} from 'node:util'

type Style = Parameters<typeof styleText>[0]

/**
 * A text in a style, when the output is a terminal
 * @param style
 * @param text
 */
export function Styled(style: Style, text: string): string {
    return process.stdout.isTTY && !process.env.NO_COLOR ? styleText(style, text) : text
}

/**
 * Print a step done
 * @param message
 */
export function Done(message: string): void {
    process.stdout.write(`${Styled('green', '✔')} ${message}\n`)
}

/**
 * Print a step in progress
 * @param message
 */
export function Step(message: string): void {
    process.stdout.write(`${Styled('cyan', '›')} ${message}\n`)
}

/**
 * Print a warning
 * @param message
 */
export function Warn(message: string): void {
    process.stderr.write(`${Styled('yellow', '!')} ${message}\n`)
}

/**
 * A table of names and values
 * @param rows
 * @param title
 */
export function Table(rows: [string, string][], title?: string): string {
    const width: number = Math.max(...rows.map(([name]): number => name.length))
    const lines: string[] = rows.map(([name, value]): string => `  ${Styled('blue', name.padEnd(width))}  ${value}`)
    return `${title ? `${Styled('bold', title)}\n` : ''}${lines.join('\n')}\n`
}
