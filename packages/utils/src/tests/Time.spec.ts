import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Time} from '../exports/Utils.js'

describe('Time', (): void => {

    it('is created from dates, strings, numbers and times', (): void => {
        const iso: Time = new Time('2024-02-29T12:34:56.789Z')
        assert.ok(iso instanceof Date)
        assert.strictEqual(iso.valueOf(), Date.UTC(2024, 1, 29, 12, 34, 56, 789))
        assert.strictEqual(new Time(new Date(0)).valueOf(), 0)
        assert.strictEqual(new Time(1000).valueOf(), 1000)
        assert.strictEqual(new Time(iso).valueOf(), iso.valueOf())
        assert.ok(Math.abs(new Time().valueOf() - Date.now()) < 1000)
        //Strings are validated as dates
        assert.throws((): unknown => new Time('not a date'))
    })

    it('computes in a timezone', (): void => {
        const time: Time = new Time('2024-02-29T23:30:00Z').timezone('Asia/Shanghai')
        assert.strictEqual(time.timezone(), 'Asia/Shanghai')
        assert.strictEqual(time.format('YYYY-MM-DD HH:mm'), '2024-03-01 07:30')
        assert.strictEqual(time.date(), 1)
        assert.strictEqual(time.clone().add(1, 'day').format('YYYY-MM-DD'), '2024-03-02')
        assert.strictEqual(time.clone().subtract(1, 'month').format('YYYY-MM-DD'), '2024-02-01')
        assert.strictEqual(time.clone().startOf('day').format('HH:mm:ss'), '00:00:00')
        assert.ok(Time.timezones().includes('Asia/Shanghai'))
    })

    it('compares times', (): void => {
        const early: Time = new Time('2024-01-01T00:00:00Z')
        const late: Time = new Time('2024-06-01T00:00:00Z')
        assert.ok(early.isBefore(late) && late.isAfter(early))
        assert.strictEqual(Time.max(early, late).valueOf(), late.valueOf())
        assert.strictEqual(Time.min(early, late).valueOf(), early.valueOf())
        assert.strictEqual(late.diff(early, 'days'), 152)
        assert.ok(early.isLeapYear())
    })

    it('returns new instances from its operations', (): void => {
        const time: Time = new Time('2024-02-29T12:00:00Z').timezone('Asia/Shanghai')
        const value: number = time.valueOf()
        const results: Time[] = [time.add(1, 'day'), time.subtract(1, 'hour'), time.hours(5), time.startOf('month'), time.endOf('year'), time.set('month', 3), time.timezone('UTC'), time.clone()]
        for (const result of results) {
            assert.notStrictEqual(result, time)
            assert.ok(result instanceof Time)
        }
        assert.strictEqual(time.valueOf(), value)
        assert.strictEqual(time.timezone(), 'Asia/Shanghai')
    })

    it('fixes the behaviors of 2.x', (): void => {
        const time: Time = new Time('2024-02-29T23:30:00Z').timezone('Asia/Shanghai')
        //clone() keeps the time zone
        assert.strictEqual(time.clone().timezone(), 'Asia/Shanghai')
        assert.strictEqual(time.clone().format('YYYY-MM-DD HH:mm'), '2024-03-01 07:30')
        //0 is the epoch, not now
        assert.strictEqual(new Time(0).valueOf(), 0)
        //ISO weeks of the year
        assert.strictEqual(new Time('2020-06-01T00:00:00Z').isoWeeksInYear(), 53)
        //Date-like strings
        assert.strictEqual(time.toTimeString(), '07:30:00 GMT+0800 (China Standard Time)')
        assert.strictEqual(time.toUTCString(), 'Thu, 29 Feb 2024 23:30:00 GMT')
        assert.strictEqual(time.toISOString(), '2024-02-29T23:30:00.000Z')
        assert.strictEqual(JSON.stringify({time}), '{"time":"2024-02-29T23:30:00.000Z"}')
        //The offset of Date, and the offset of the time zone
        assert.strictEqual(time.getTimezoneOffset(), -480)
        assert.strictEqual(time.utcOffset(), 480)
        assert.strictEqual(new Time(0).timezone('UTC').getTimezoneOffset(), 0)
    })

    it('stays consistent after the Date methods change it', (): void => {
        const time: Time = new Time('2024-01-01T00:00:00Z').timezone('UTC')
        time.setUTCFullYear(2030)
        assert.strictEqual(time.format('YYYY'), '2030')
        assert.strictEqual(time.year(), 2030)
        assert.strictEqual(time.timezone(), 'UTC')
    })

    it('rejects invalid values', (): void => {
        assert.throws((): unknown => new Time(''), RangeError)
        assert.throws((): unknown => new Time('   '), RangeError)
        assert.throws((): unknown => new Time('2024-13-45'), RangeError)
        assert.throws((): unknown => new Time().timezone('Mars/Olympus'), RangeError)
        assert.strictEqual(new Time(NaN).format(), 'Invalid date')
        //Numeric strings are timestamps, arrays are wall clock fields (out of range: invalid)
        assert.strictEqual(new Time('1000').valueOf(), 1000)
        assert.strictEqual(new Time([2024, 1, 29]).format('YYYY-MM-DD'), '2024-02-29')
        assert.ok(isNaN(new Time([2023, 1, 29]).valueOf()))
    })

    it('uses the time zone data of the runtime', (): void => {
        assert.ok(Time.timezones().includes('America/New_York'))
        const winter: Time = new Time('2024-01-15T12:00:00Z').timezone('America/New_York')
        const summer: Time = new Time('2024-07-15T12:00:00Z').timezone('America/New_York')
        assert.deepStrictEqual([winter.utcOffset(), summer.utcOffset()], [-300, -240])
        //A day across the transition keeps the wall clock
        assert.strictEqual(new Time('2024-03-09T17:00:00Z').timezone('America/New_York').add(1, 'day').format('HH:mm Z'), '12:00 -04:00')
    })
})
