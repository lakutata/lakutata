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

    it('lists the time zones by their current IANA names, with UTC and the fixed offsets', (): void => {
        const zones: string[] = Time.timezones()
        for (const zone of ['UTC', 'Etc/GMT-8', 'Etc/GMT+12', 'Etc/GMT-14', 'Asia/Kolkata', 'Europe/Kyiv', 'America/Argentina/Buenos_Aires', 'Europe/Amsterdam', 'Europe/Brussels']) assert.ok(zones.includes(zone), zone)
        //The former names are not listed, and are still accepted
        for (const zone of ['Asia/Calcutta', 'Europe/Kiev', 'Etc/GMT+0']) assert.ok(!zones.includes(zone), zone)
        assert.strictEqual(new Time('2024-01-01T00:00:00Z').timezone('Asia/Calcutta').format('HH:mm'), '05:30')
        //Each listed time zone is usable, once
        assert.strictEqual(new Set(zones).size, zones.length)
        for (const zone of zones) assert.doesNotThrow((): unknown => new Time('2024-01-01T00:00:00Z').timezone(zone).format(), zone)
        assert.strictEqual(new Time('2024-01-01T00:00:00Z').timezone('Etc/GMT-8').format('HH:mm'), '08:00')
        //The list given is a copy
        zones.length = 0
        assert.ok(Time.timezones().length > 400)
    })

    it('uses the TZ environment variable as default time zone (UTC when invalid, like Date)', (): void => {
        const tz: string | undefined = process.env.TZ
        try {
            process.env.TZ = 'Asia/Tokyo'
            assert.strictEqual(new Time().timezone(), 'Asia/Tokyo')
            assert.strictEqual(new Time('2024-01-01T00:00:00Z').format('HH:mm'), '09:00')
            process.env.TZ = 'Invalid/Zone'
            assert.strictEqual(new Time().timezone(), 'UTC')
            assert.strictEqual(new Time('2024-01-01T00:00:00Z').format('HH:mm'), '00:00')
        } finally {
            if (tz === undefined) {
                delete process.env.TZ
            } else {
                process.env.TZ = tz
            }
        }
        //A Time keeps the time zone of the Time it is created from
        assert.strictEqual(new Time(new Time().timezone('Europe/Paris')).timezone(), 'Europe/Paris')
    })

    it('moves a wall clock time skipped by a transition forward by the gap, whatever the time it comes from', (): void => {
        const format: string = 'YYYY-MM-DD HH:mm Z'
        //New York, 2024-03-10: 02:00 EST jumps to 03:00 EDT
        const midnight: Time = new Time('2024-03-10T05:00:00Z').timezone('America/New_York')
        const noon: Time = new Time('2024-03-10T16:00:00Z').timezone('America/New_York')
        assert.strictEqual(midnight.hours(2).format(format), '2024-03-10 03:00 -04:00')
        assert.strictEqual(noon.hours(2).format(format), '2024-03-10 03:00 -04:00')
        assert.strictEqual(noon.hours(2).minutes(30).format(format), '2024-03-10 03:30 -04:00')
        const before: Time = new Time('2024-03-09T07:30:00Z').timezone('America/New_York')
        assert.strictEqual(before.format(format), '2024-03-09 02:30 -05:00')
        assert.strictEqual(before.add(1, 'day').format(format), '2024-03-10 03:30 -04:00')
        const after: Time = new Time('2024-03-11T06:30:00Z').timezone('America/New_York')
        assert.strictEqual(after.subtract(1, 'day').format(format), '2024-03-10 03:30 -04:00')
        assert.strictEqual(new Time('2024-02-10T07:30:00Z').timezone('America/New_York').add(1, 'month').format(format), '2024-03-10 03:30 -04:00')
        assert.strictEqual(midnight.set('minute', 150).format(format), '2024-03-10 03:30 -04:00')
        //Paris, 2024-03-31: 02:00 CET jumps to 03:00 CEST
        const paris: Time = new Time('2024-03-30T01:15:00Z').timezone('Europe/Paris')
        assert.strictEqual(paris.add(1, 'day').format(format), '2024-03-31 03:15 +02:00')
        assert.strictEqual(new Time('2024-03-31T20:00:00Z').timezone('Europe/Paris').hours(2).format(format), '2024-03-31 03:00 +02:00')
        assert.strictEqual(new Time('2024-03-31T00:00:00Z').timezone('Europe/Paris').startOf('day').hours(2).minutes(59).format(format), '2024-03-31 03:59 +02:00')
    })

    it('keeps the offset of a repeated wall clock time when it can, else takes the earlier one', (): void => {
        const format: string = 'YYYY-MM-DD HH:mm Z'
        //Paris, 2024-10-27: 03:00 CEST goes back to 02:00 CET
        const morning: Time = new Time('2024-10-26T22:00:00Z').timezone('Europe/Paris')
        const evening: Time = new Time('2024-10-27T19:00:00Z').timezone('Europe/Paris')
        assert.strictEqual(morning.hours(2).minutes(30).format(format), '2024-10-27 02:30 +02:00')
        assert.strictEqual(evening.hours(2).minutes(30).format(format), '2024-10-27 02:30 +01:00')
        //From another day, the earlier: New York, 2024-11-03 01:30 EDT then EST
        assert.strictEqual(new Time('2024-11-02T05:30:00Z').timezone('America/New_York').add(1, 'day').format(format), '2024-11-03 01:30 -04:00')
        const second: Time = new Time('2024-11-03T06:45:00Z').timezone('America/New_York')
        assert.strictEqual(second.format(format), '2024-11-03 01:45 -05:00')
        assert.strictEqual(second.startOf('hour').format(format), '2024-11-03 01:00 -05:00')
    })

    it('reads the strings without offset and the arrays in the time zone of the instance', (): void => {
        const time: Time = new Time('2024-03-09T12:00:00Z').timezone('America/New_York')
        assert.strictEqual(time.isSame('2024-03-09T07:00:00'), true)
        assert.strictEqual(time.isSame('2024-03-09 07:00'), true)
        assert.strictEqual(time.isSame('March 9, 2024 07:00:00'), true)
        assert.strictEqual(time.isSame([2024, 2, 9, 7]), true)
        assert.strictEqual(time.isSame('2024-03-09', 'day'), true)
        assert.strictEqual(time.isAfter('2024-03-09'), true)
        assert.strictEqual(time.diff('2024-03-09', 'hours'), 7)
        assert.strictEqual(time.diff('2024-03-09T07:00:00.000Z', 'hours'), 5)
        //With an offset or a zone name, the instant
        assert.strictEqual(time.isSame('2024-03-09T12:00:00Z'), true)
        assert.strictEqual(time.isSame('2024-03-09T13:00:00+01:00'), true)
        assert.strictEqual(time.isSame('Sat, 09 Mar 2024 12:00:00 GMT'), true)
        assert.strictEqual(time.isSame('March 9, 2024 07:00:00 EST'), true)
        assert.strictEqual(time.timezone('Asia/Tokyo').isSame('2024-03-09T21:00:00'), true)
        //A time skipped by the transition moves forward
        assert.strictEqual(time.add(1, 'day').hours(3).minutes(30).isSame('2024-03-10T02:30:00'), true)
        assert.throws((): unknown => time.isSame('not a date'), RangeError)
    })

    it('reads the strings without offset and the arrays of new Time() in the default time zone', (): void => {
        const tz: string | undefined = process.env.TZ
        try {
            process.env.TZ = 'Asia/Tokyo'
            assert.strictEqual(new Time('2024-01-01').toISOString(), '2023-12-31T15:00:00.000Z')
            assert.strictEqual(new Time('2024-01-01T09:00').toISOString(), '2024-01-01T00:00:00.000Z')
            assert.strictEqual(new Time([2024, 0, 1, 9]).toISOString(), '2024-01-01T00:00:00.000Z')
            assert.strictEqual(new Time('2024-01-01T09:00:00.5').valueOf(), Date.UTC(2024, 0, 1, 0, 0, 0, 500))
            process.env.TZ = 'America/New_York'
            //02:30 does not exist on 2024-03-10
            assert.strictEqual(new Time('2024-03-10T02:30').format(), '2024-03-10T03:30:00-04:00')
        } finally {
            if (tz === undefined) {
                delete process.env.TZ
            } else {
                process.env.TZ = tz
            }
        }
    })

    it('takes the missing leading fields of an array from now', (): void => {
        const now: Time = new Time()
        assert.ok(Math.abs(new Time(now.toArray()).valueOf() - now.valueOf()) < 1000)
        const june: Time = new Time([undefined, 5] as unknown as number[])
        assert.deepStrictEqual([june.year(), june.month(), june.date(), june.hours()], [new Time().year(), 5, 1, 0])
        const today: Time = new Time([])
        assert.deepStrictEqual([today.year(), today.month(), today.date(), today.hours(), today.minutes()], [new Time().year(), new Time().month(), new Time().date(), 0, 0])
    })

    it('gives the default time zone for an empty time zone name', (): void => {
        const time: Time = new Time('2024-01-01T00:00:00Z').timezone('Asia/Shanghai')
        const reset: Time = time.timezone('')
        assert.ok(reset instanceof Time)
        assert.strictEqual(reset.timezone(), new Time().timezone())
        assert.strictEqual(reset.valueOf(), time.valueOf())
    })

    it('ignores the invalid times in max and min', (): void => {
        const invalid: Time = new Time(NaN)
        const early: Time = new Time('2024-01-01T00:00:00Z')
        const late: Time = new Time('2024-06-01T00:00:00Z')
        assert.strictEqual(Time.max(invalid, early, late), late)
        assert.strictEqual(Time.min(invalid, late, early), early)
        assert.strictEqual(Time.max(early, invalid), early)
        assert.strictEqual(Time.min(late, invalid), late)
        const other: Time = new Time(NaN)
        assert.strictEqual(Time.max(invalid, other), invalid)
        assert.strictEqual(Time.min(invalid, other), invalid)
    })
})
