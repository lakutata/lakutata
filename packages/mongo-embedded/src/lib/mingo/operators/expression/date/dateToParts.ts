import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { adjustDate, isoWeek, isoWeekYear, parseTimezone } from './_internal.js'

/**
 * Returns a document that contains the constituent parts of a given Date value as individual properties.
 * The properties returned are year, month, day, hour, minute, second and millisecond.
 */
export const $dateToParts = (
  obj: AnyObject,
  expr: Any,
  options: Options
): AnyObject => {
  const args = evalExpr(obj, expr, options) as {
    date: Date
    timezone?: string
    iso8601?: boolean
  }

  const d = new Date(args.date)
  adjustDate(d, parseTimezone(args.timezone, d))

  const timePart = {
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    millisecond: d.getUTCMilliseconds()
  }

  if (args.iso8601 == true) {
    return Object.assign(timePart, {
      isoWeekYear: isoWeekYear(d),
      isoWeek: isoWeek(d),
      isoDayOfWeek: d.getUTCDay() || 7
    })
  }

  return Object.assign(timePart, {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate()
  })
}
