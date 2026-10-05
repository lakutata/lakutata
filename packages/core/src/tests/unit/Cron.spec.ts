import {describe, it} from 'node:test'
import assert from 'node:assert'
import {isValidCron as UpstreamIsValidCron} from 'cron-validator'
import {isValidCron} from '../../lib/dto/internal/CronValidator.js'
import {DTO} from '../../lib/dto/DTO.js'
import {type CronOptions} from '../../types/CronOptions.js'

/**
 * A pseudo random generator with a seed (mulberry32)
 * @param seed
 */
function seededRandom(seed: number): () => number {
    return (): number => {
        seed = (seed + 0x6D2B79F5) | 0
        let t: number = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const random: () => number = seededRandom(20261002)

const pick = <T>(values: T[]): T => values[Math.floor(random() * values.length)]

/**
 * A random value of a field: in and out of the ranges of the fields, names, blanks, nth weekdays and invalid text
 */
function randomValue(): string {
    return pick([
        String(Math.floor(random() * 62)), String(Math.floor(random() * 8)), '0', '1', '7', '12', '13', '23', '24', '31', '32', '59', '60', '99',
        '*', '?', 'jan', 'JAN', 'Feb', 'dec', 'xyz', 'mon', 'MON', 'Fri', 'sun', 'sat', 'thu', 'L', 'W', '1*', '01', '-1', '', 'jan1'
    ])
}

/**
 * A random field: a value, a range, a step, a list of them, or an nth weekday
 */
function randomField(depth: number = 0): string {
    switch (Math.floor(random() * (depth ? 5 : 7))) {
        case 0:
        case 1:
            return randomValue()
        case 2:
            return `${randomValue()}-${randomValue()}`
        case 3:
            return `${pick([randomValue(), `${randomValue()}-${randomValue()}`, '*'])}/${pick(['1', '2', '5', '15', '0', '', 'a', 'mon', '*', '2/3'])}`
        case 4:
            return `${randomValue()}#${pick(['1', '2', '5', '6', '0', 'x', '1#2', ''])}`
        default:
            return Array.from({length: 2 + Math.floor(random() * 3)}, (): string => randomField(depth + 1)).join(',')
    }
}

/**
 * A random expression: four to seven fields, with random spaces
 */
function expression(): string {
    //Mostly valid fields: an expression is invalid as soon as one of its fields is
    const fields: string[] = Array.from({length: pick([4, 5, 5, 5, 5, 6, 6, 6, 6, 7])}, (): string => random() < 0.85 ? pick(['*', '1', '*/5', '1-5', '1,3']) : randomField())
    return pick(['', ' ', '  ']) + fields.join(pick([' ', ' ', '  ', '\t'])) + pick(['', ' '])
}

/**
 * Every combination of the options, and no options
 */
const OPTIONS: (CronOptions | undefined)[] = [undefined, {}]
for (let mask: number = 0; mask < 32; mask++) {
    OPTIONS.push({
        alias: !!(mask & 1),
        seconds: !!(mask & 2),
        allowBlankDay: !!(mask & 4),
        allowSevenAsSunday: !!(mask & 8),
        allowNthWeekdayOfMonth: !!(mask & 16)
    })
}

/**
 * The options of DTO.Cron() given to cron-validator by 2.x: its defaults for the options not given
 * @param options
 */
function defaultsOf2x(options?: CronOptions): CronOptions {
    const given: CronOptions = {...options}
    given.alias = given.alias !== undefined ? given.alias : false
    given.seconds = given.seconds !== undefined ? given.seconds : true
    given.allowBlankDay = given.allowBlankDay !== undefined ? given.allowBlankDay : true
    given.allowSevenAsSunday = given.allowSevenAsSunday !== undefined ? given.allowSevenAsSunday : true
    return given
}

describe('Cron', (): void => {

    it('validates as cron-validator', (): void => {
        const counts: Record<string, number> = {true: 0, false: 0}
        for (let run: number = 0; run < 3000; run++) {
            const cron: string = expression()
            for (const options of OPTIONS) {
                const expected: boolean = UpstreamIsValidCron(cron, options)
                assert.strictEqual(isValidCron(cron, options), expected, `${JSON.stringify(cron)} ${JSON.stringify(options)}`)
                counts[String(expected)]++
            }
        }
        //The random expressions are valid and invalid
        assert.ok(counts.true > 10000 && counts.false > 10000, JSON.stringify(counts))
    })

    it('validates the usual expressions as cron-validator', (): void => {
        const expressions: string[] = [
            '0 0 * * 1', '* * * * *', '0 0 0 * * 1', '*/15 0 1-5 * 1,3', '0 0 * JAN MON', '0 0 * jan-mar mon-fri', '0 0 0 * * MON-FRI',
            '0 0 ? * 1', '? 0 * * 1', '0 0 ? * ?', '0 0 * * 7', '60 0 * * 1', '0 0 * * 1#2', '0 0 * * MON#2', '0 0 * * 1#6',
            '0 0 * */JAN *', '0 0 * * */MON', '0 0 * * 5-1', '0 0 32 * *', '0 24 * * *', '*/ * * * *', '*/*/* * * * *', '1* * * * *',
            '0 0 * * *  ', '  0 0 * * *', '0 0 * *', '0 0 0 0 * * *', ''
        ]
        for (const cron of expressions) {
            for (const options of OPTIONS) assert.strictEqual(isValidCron(cron, options), UpstreamIsValidCron(cron, options), `${JSON.stringify(cron)} ${JSON.stringify(options)}`)
        }
    })

    it('validates DTO.Cron() as 2.x: cron-validator with the defaults of 2.x', (): void => {
        for (let run: number = 0; run < 500; run++) {
            const cron: string = expression()
            for (const options of OPTIONS) {
                const expected: boolean = UpstreamIsValidCron(cron, defaultsOf2x(options))
                assert.strictEqual(DTO.isValid(cron, DTO.Cron(options)), expected, `${JSON.stringify(cron)} ${JSON.stringify(options)}`)
            }
        }
        //The defaults: five or six fields, "?" for a day, 7 as Sunday, no names
        assert.ok(DTO.isValid('0 0 * * 1', DTO.Cron()))
        assert.ok(DTO.isValid('0 0 0 * * 1', DTO.Cron()))
        assert.ok(DTO.isValid('0 0 ? * 7', DTO.Cron()))
        assert.ok(!DTO.isValid('0 0 * JAN MON', DTO.Cron()))
        assert.ok(DTO.isValid('0 0 * JAN MON', DTO.Cron({alias: true})))
        //An option given as undefined takes its default
        assert.ok(DTO.isValid('0 0 0 * * 1', DTO.Cron({seconds: undefined})))
    })

    it('leaves the options given to DTO.Cron() unchanged and rejects the values which are not strings', (): void => {
        const options: CronOptions = {alias: true}
        const schema = DTO.Cron(options)
        assert.ok(DTO.isValid('0 0 0 * JAN MON', schema))
        assert.deepStrictEqual(options, {alias: true})
        assert.ok(!DTO.isValid(5, schema))
        assert.ok(!DTO.isValid(null, schema))
    })
})
