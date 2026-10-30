import {describe, it} from 'node:test'
import assert from 'node:assert'
import util from 'node:util'
import {styled} from '../lib/Output.js'

/**
 * Run a function as if the output were a terminal with colors
 * @param run
 */
function inTerminal<T>(run: () => T): T {
    const tty: boolean | undefined = process.stdout.isTTY
    const noColor: string | undefined = process.env.NO_COLOR
    process.stdout.isTTY = true
    delete process.env.NO_COLOR
    try {
        return run()
    } finally {
        process.stdout.isTTY = tty as boolean
        if (noColor !== undefined) process.env.NO_COLOR = noColor
    }
}

describe('The output of the tool', (): void => {

    it('styles its texts in a terminal only, with util.styleText or, before Node.js 20.12, the codes of the terminals', (): void => {
        if (!process.stdout.isTTY || process.env.NO_COLOR) assert.strictEqual(styled('green', 'done'), 'done')
        //Node.js 18 and 19 have no util.styleText
        const descriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(util, 'styleText')
        Reflect.deleteProperty(util, 'styleText')
        try {
            assert.strictEqual(inTerminal((): string => styled('green', 'done')), '\u001b[32mdone\u001b[39m')
            assert.strictEqual(inTerminal((): string => styled('bold', 'title')), '\u001b[1mtitle\u001b[22m')
        } finally {
            if (descriptor) Object.defineProperty(util, 'styleText', descriptor)
        }
        //util.styleText of Node.js 22.13 and later checks the stream itself
        if (descriptor) assert.strictEqual(inTerminal((): string => styled('magenta', 'pkg')), inTerminal((): string => util.styleText('magenta', 'pkg')))
    })
})
