/**
 * The Time API is compatible with the moment library (English locale, moment-timezone): the results are compared on
 * random instants of time zones with various offsets and transitions. Not type-checked. Except in the gaps of the
 * transitions: a wall clock time skipped by a transition moves forward by the gap's length in Time (as moment parses
 * it), while the setters and the arithmetic of moment move it forward or backward depending on the time they start from.
 */
// @ts-nocheck
import {describe, it} from 'node:test'
import moment from 'moment-timezone'
import {Time} from '../exports/Utils.js'

//Deterministic pseudo random numbers (mulberry32)
function random(seed) {
    return () => {
        seed = (seed + 0x6D2B79F5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const ZONES = ['UTC', 'Asia/Shanghai', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'America/Los_Angeles', 'Australia/Lord_Howe',
    'America/St_Johns', 'Asia/Kathmandu', 'Pacific/Chatham', 'America/Sao_Paulo', 'Asia/Tehran', 'Pacific/Apia', 'Africa/Casablanca', 'Asia/Kolkata']
const FORMAT = 'YYYY YY Y YYYYY YYYYYY M MM MMM MMMM Mo Q Qo D DD Do DDD DDDD DDDo d do dd ddd dddd e E w ww wo W WW Wo gg gggg GG GGGG a A H HH h hh k kk m mm s ss S SS SSS SSSS Z ZZ X x N NNNN y yo [escaped] \\M LT LTS L LL LLL LLLL l ll lll llll Hmm hmmss'
const UNITS = ['year', 'quarter', 'month', 'week', 'isoWeek', 'day', 'date', 'hour', 'minute', 'second', 'millisecond']
const ADD_UNITS = ['years', 'Q', 'months', 'weeks', 'days', 'd', 'hours', 'minutes', 'seconds', 'ms']
const GET_UNITS = ['year', 'quarter', 'month', 'week', 'isoWeek', 'day', 'date', 'hour', 'minute', 'second', 'millisecond', 'dayOfYear', 'weekday', 'isoWeekday', 'weekYear', 'isoWeekYear']

function pair(instant, zone) {
    return [new Time(instant).timezone(zone), moment.tz(instant, zone)]
}

const WALL_CLOCK = 'YYYY-MM-DDTHH:mm:ss.SSS'

//The wall clock of a result of moment parsed in its zone (a time skipped by a transition moves forward)
function reparse(mom) {
    return moment.tz(mom.format(WALL_CLOCK), WALL_CLOCK, true, mom.tz())
}

//Whether moment gives a wall clock time skipped by a transition (parsed, it moves)
function inGap(mom) {
    const parsed = reparse(mom)
    return parsed.isValid() && parsed.format(WALL_CLOCK) !== mom.format(WALL_CLOCK)
}

//The instant of a result of moment, the wall clock times skipped by a transition moved forward by the gap's length
function compatible(mom) {
    return inGap(mom) ? reparse(mom).valueOf() : mom.valueOf()
}

//Whether the month differences of moment compute from a time in a gap (its anchors: the time plus whole months)
function monthAnchorInGap(mom, other) {
    const [a, b] = mom.date() < other.date() ? [other, mom] : [mom, other]
    const whole = (b.year() - a.year()) * 12 + (b.month() - a.month())
    return [whole - 1, whole, whole + 1].some((months) => inGap(a.clone().add(months, 'months')))
}

describe('Time compatibility with moment', () => {

    it('formats, reads and computes like moment', () => {
        const rnd = random(20260927)
        const pick = (items) => items[Math.floor(rnd() * items.length)]
        const failures = []
        let zone
        //Whether the data disagree on the instant of the iteration
        let disagreeing = false
        //Whether the time zone data of the runtime (ICU) and the one of moment-timezone agree on an instant: older data
        //differ (Node.js 18: Asia/Tehran in 1978 and 1979), and the instants where they differ are not compared
        const agree = (instant) => new Time(instant).timezone(zone).utcOffset() === moment.tz(instant, zone).utcOffset()
        const check = (label, actual, expected) => {
            if (disagreeing) return
            if (typeof expected === 'number' && typeof actual === 'number' && isNaN(expected) && isNaN(actual)) return
            if (typeof expected === 'number' && typeof actual === 'number' && Math.abs(expected) > 1e10 && (!agree(actual) || !agree(expected))) return
            if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`)
        }
        for (let i = 0; i < 3000; ++i) {
            zone = pick(ZONES)
            //1970 to 2100, and around the transitions (the start of the days and the hours)
            let instant = Math.floor(rnd() * 4102444800000)
            if (rnd() < 0.3) instant -= instant % 3600000
            //The same picks whatever the data, the checks of an instant the data disagree on left out
            disagreeing = !agree(instant)
            const [time, mom] = pair(instant, zone)
            const other = Math.floor(rnd() * 4102444800000)
            const label = `${zone} ${new Date(instant).toISOString()}`
            check(`${label} format`, time.format(FORMAT), mom.format(FORMAT))
            check(`${label} default format`, time.format(), mom.format())
            check(`${label} toString`, time.toString(), mom.toString())
            check(`${label} toArray`, time.toArray(), mom.toArray())
            check(`${label} toObject`, time.toObject(), mom.toObject())
            check(`${label} weeksInYear`, [time.weeksInYear(), time.isoWeeksInYear()], [mom.weeksInYear(), mom.isoWeeksInYear()])
            check(`${label} daysInMonth`, [time.daysInMonth(), time.isLeapYear(), time.unix(), time.utcOffset()], [mom.daysInMonth(), mom.isLeapYear(), mom.unix(), mom.utcOffset()])
            for (const unit of GET_UNITS) check(`${label} get ${unit}`, time.get(unit), mom.get(unit))
            const unit = pick(UNITS)
            check(`${label} startOf ${unit}`, time.startOf(unit).valueOf(), compatible(mom.clone().startOf(unit)))
            check(`${label} endOf ${unit}`, time.endOf(unit).valueOf(), compatible(mom.clone().endOf(unit)))
            const addUnit = pick(ADD_UNITS)
            const amount = pick([1, -1, 2, 13, -25, 1.5, -2.5, 100, 0.4])
            check(`${label} add ${amount} ${addUnit}`, time.add(amount, addUnit).valueOf(), compatible(mom.clone().add(amount, addUnit)))
            check(`${label} subtract ${amount} ${addUnit}`, time.subtract(amount, addUnit).valueOf(), compatible(mom.clone().subtract(amount, addUnit)))
            const setUnit = pick(GET_UNITS)
            const value = pick([0, 1, 5, 12, 29, 31, 53, 59, 100, 2020, -1])
            const set = time.set(setUnit, value)
            //The time zone data of moment-timezone has no daylight saving time far in the future (the runtime data has)
            if (set.year() < 2200) check(`${label} set ${setUnit} ${value}`, set.valueOf(), compatible(mom.clone().set(setUnit, value)))
            const diffUnit = pick([...UNITS.filter((u) => u !== 'isoWeek' && u !== 'date'), undefined])
            //The data may disagree on the other instant too (Node.js 18.10: Africa/Casablanca)
            if (agree(other) && (!['year', 'quarter', 'month'].includes(diffUnit) || !monthAnchorInGap(mom, moment.tz(other, zone)))) {
                check(`${label} diff ${diffUnit}`, time.diff(other, diffUnit), mom.diff(moment.tz(other, zone), diffUnit))
                check(`${label} diff ${diffUnit} precise`, time.diff(other, diffUnit, true), mom.diff(moment.tz(other, zone), diffUnit, true))
            }
            const near = instant + pick([0, 1, -1, 60000, 3600000, 86400000, -86400000 * 3])
            for (const granularity of [undefined, pick(UNITS)]) {
                check(`${label} compare ${granularity}`, [time.isSame(near, granularity), time.isBefore(near, granularity), time.isAfter(near, granularity), time.isSameOrBefore(near, granularity), time.isSameOrAfter(near, granularity)],
                    [mom.isSame(near, granularity), mom.isBefore(near, granularity), mom.isAfter(near, granularity), mom.isSameOrBefore(near, granularity), mom.isSameOrAfter(near, granularity)])
            }
            check(`${label} isBetween`, time.isBetween(instant - 1000, near, 'hour', '[]'), mom.isBetween(instant - 1000, near, 'hour', '[]'))
        }
        if (failures.length) {
            const kinds = {}
            for (const failure of failures) {
                const kind = failure.replace(/^\S+ \S+ /, '').split(':')[0].replace(/-?[\d.]+/g, 'n')
                //The first failure of each kind
                kinds[kind] ??= failure
            }
            throw new Error(`${failures.length} differences:\n${Object.values(kinds).slice(0, 40).join('\n')}`)
        }
    })
})
