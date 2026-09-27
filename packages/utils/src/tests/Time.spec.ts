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
})
