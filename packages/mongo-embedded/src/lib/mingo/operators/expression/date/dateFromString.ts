import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isNil, isObject } from '../../../util/index.js'
import {
  adjustDate,
  DATE_FORMAT,
  DATE_FORMAT_SEP_RE,
  DATE_FORMAT_SYM_RE,
  DATE_SYM_TABLE,
  MINUTES_PER_HOUR,
  MONTHS,
  parseTimezone
} from './_internal.js'

function tzLetterOffset(c: string): number {
  if (c === 'Z') return 0
  if (c >= 'A' && c < 'N') return c.charCodeAt(0) - 64 // [A, M] => [1, 12]
  return 77 - c.charCodeAt(0) // [N, Y] => [-1, -12]
}

const regexStrip = (s: string): string =>
  s.replace(/^\//, '').replace(/\/$/, '').replace(/\/i/, '')

const REGEX_SPECIAL_CHARS = ['^', '.', '-', '*', '?', '$'] as const
function regexQuote(s: string): string {
  for (const c of REGEX_SPECIAL_CHARS) s = s.replace(c, `\\${c}`)
  return s
}

interface InputExpr {
  dateString: string
  timezone?: string
  format?: string
  onError?: Any
  onNull?: Any
}

/**
 * Converts a date/time string to a date object.
 */
export function $dateFromString(
  obj: AnyObject,
  expr: InputExpr,
  options: Options
): Any {
  const args = evalExpr(obj, expr, options) as InputExpr
  const format = args.format || DATE_FORMAT
  const onNull = args.onNull || null

  let dateString = args.dateString
  if (isNil(dateString)) return onNull

  // collect all separators of the format string
  const separators = format.split(DATE_FORMAT_SEP_RE)
  separators.reverse()

  const matches = format.match(DATE_FORMAT_SYM_RE)!

  const dateParts: {
    year?: number
    month?: number
    full_month?: string
    abbr_month?: string
    day?: number
    hour?: number
    minute?: number
    second?: number
    millisecond?: number
    timezone?: string
    minute_offset?: string
  } & AnyObject = {}

  // holds the valid regex of parts that matches input date string
  let expectedPattern = ''

  for (let i = 0, len = matches.length; i < len; i++) {
    const formatSpecifier = matches[i]
    const props = DATE_SYM_TABLE[formatSpecifier]

    if (isObject(props)) {
      // get pattern and alias from table
      const m = props.re.exec(dateString)

      // get the next separtor
      const delimiter = separators.pop() || ''

      if (m !== null) {
        // store and cut out matched part
        dateParts[props.name] = /^\d+$/.exec(m[0]) ? parseInt(m[0]) : m[0]
        dateString = dateString.substring(m.index + m[0].length + 1)

        // construct expected pattern
        expectedPattern +=
          regexQuote(delimiter) + regexStrip(props.re.toString())
      } else {
        dateParts[props.name] = null
      }
    }
  }
  // Transform month names to month number
  if (isNil(dateParts.month)) {
    const abbrMonth = (
      dateParts.full_month?.slice(0, 3) ??
      dateParts.abbr_month ??
      ''
    ).toLowerCase()
    if (MONTHS[abbrMonth]) {
      dateParts.month = MONTHS[abbrMonth]
    }
  }

  // 1. validate all required date parts exists
  // 2. validate original dateString against expected pattern.
  if (
    isNil(dateParts.year) ||
    isNil(dateParts.month) ||
    isNil(dateParts.day) ||
    !new RegExp('^' + expectedPattern + '[A-Z]?$').test(args.dateString)
  ) {
    return args.onError
  }

  const m = args.dateString.match(/([A-Z])$/)
  assert(
    // only one of in-date timeone or timezone argument but not both.
    !(m && args.timezone),
    `$dateFromString: you cannot pass in a date/time string with time zone information ('${
      m && m[0]
    }') together with a timezone argument`
  )

  const minuteOffset = m
    ? tzLetterOffset(m[0]) * MINUTES_PER_HOUR
    : parseTimezone(args.timezone, new Date())

  // create the date. month is 0-based in Date
  const d = new Date(
    Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, 0, 0, 0)
  )

  if (!isNil(dateParts.hour)) d.setUTCHours(dateParts.hour)
  if (!isNil(dateParts.minute)) d.setUTCMinutes(dateParts.minute)
  if (!isNil(dateParts.second)) d.setUTCSeconds(dateParts.second)
  if (!isNil(dateParts.millisecond))
    d.setUTCMilliseconds(dateParts.millisecond)

  // adjust to the correct represention for UTC
  adjustDate(d, -minuteOffset)

  return d
}
