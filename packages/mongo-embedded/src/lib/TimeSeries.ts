import { typeName } from './Collation.js'
import { EmbeddedOperationError } from './Errors.js'
import { type EmbeddedDocument } from './Values.js'

/**
 * The options of a time series collection, as MongoDB 8.0 lists them: its time field, its meta field, its granularity
 * and the longest time span of its buckets, or the rounding of the start of its buckets and their span (both given)
 *
 * @internal
 */
export interface EmbeddedTimeSeriesOptions {
    timeField: string
    metaField?: string
    granularity?: string
    bucketRoundingSeconds?: number
    bucketMaxSpanSeconds: number
}

/**
 * A bucket of a time series collection, as its collection system.buckets.<name> keeps it (the uncompressed format of
 * MongoDB, version 1): the time of its start in its _id; the smallest and the largest values of each field of its
 * measurements (the one of the time field the start of the bucket), their number; their meta field; each field of its
 * measurements as a column, by the index of the measurement ('0', '1'...)
 *
 * @internal
 */
export interface EmbeddedBucket {
    _id: unknown
    control: { version: number, min: EmbeddedDocument, max: EmbeddedDocument, count: number }
    meta?: unknown
    data: Record<string, Record<string, unknown>>
}

/**
 * The collections of the buckets of the time series collections: system.buckets.<name>
 * @internal
 */
export const BUCKETS = 'system.buckets.'

/**
 * The most measurements of a bucket, and its largest size (in bytes, about): beyond, a new bucket is opened, as MongoDB
 * 8.0 opens them
 * @internal
 */
export const BUCKET_MAX_COUNT = 1000
export const BUCKET_MAX_SIZE = 125 * 1024

/**
 * The span and the rounding of the buckets of each granularity, in seconds
 */
const GRANULARITIES: Record<string, { span: number, rounding: number }> = {
    seconds: { span: 3600, rounding: 60 },
    minutes: { span: 86400, rounding: 3600 },
    hours: { span: 2592000, rounding: 86400 }
}

/**
 * The fields of the option timeseries
 */
const FIELDS = new Set(['timeField', 'metaField', 'granularity', 'bucketMaxSpanSeconds', 'bucketRoundingSeconds'])

/**
 * An error of the options of a time series collection, as MongoDB fails them
 *
 * @param code
 * @param message
 */
function invalid(code: number, message: string): EmbeddedOperationError {
    const names: Record<number, string> = { 2: 'BadValue', 14: 'TypeMismatch', 72: 'InvalidOptions', 40414: 'IDLFailedToParse', 40415: 'IDLUnknownField' }
    return new EmbeddedOperationError(code, names[code] ?? `Location${code}`, message)
}

/**
 * The options of a new time series collection (the option timeseries of createCollection), checked as MongoDB 8.0 checks
 * them, in the form it lists them
 *
 * @param given the option timeseries
 * @internal
 */
export function timeSeriesOptionsOf(given: unknown): EmbeddedTimeSeriesOptions {
    if (typeof given !== 'object' || given === null || Array.isArray(given))
        throw invalid(14, `BSON field 'create.timeseries' is the wrong type '${typeName(given)}', expected type 'object'`)
    const options = given as EmbeddedDocument
    for (const field of Object.keys(options))
        if (options[field] !== undefined && !FIELDS.has(field))
            throw invalid(40415, `BSON field 'create.timeseries.${field}' is an unknown field.`)
    if (options.timeField === undefined)
        throw invalid(40414, "BSON field 'create.timeseries.timeField' is missing but a required field")
    for (const field of ['timeField', 'metaField', 'granularity'])
        if (options[field] !== undefined && typeof options[field] !== 'string')
            throw invalid(14, `BSON field 'create.timeseries.${field}' is the wrong type '${typeName(options[field])}', expected type 'string'`)
    if (options.metaField !== undefined && options.metaField === options.timeField)
        throw invalid(72, "The 'metaField' cannot be the same as the 'timeField'")
    if (options.granularity !== undefined && !(options.granularity in GRANULARITIES))
        throw invalid(2, `Enumeration value '${options.granularity}' for field 'create.timeseries.granularity' is not a valid value.`)
    const span = options.bucketMaxSpanSeconds
    const rounding = options.bucketRoundingSeconds
    const meta = options.metaField !== undefined ? { metaField: options.metaField } : {}
    if (span !== undefined || rounding !== undefined) {
        if (options.granularity !== undefined)
            throw invalid(72, "Timeseries 'bucketMaxSpanSeconds' and 'bucketRoundingSeconds' are not allowed with a 'granularity'")
        if (span === undefined || rounding === undefined)
            throw invalid(72, "Timeseries 'bucketMaxSpanSeconds' and 'bucketRoundingSeconds' need to be set alongside each other")
        if (Number(span) !== Number(rounding))
            throw invalid(72, "Timeseries 'bucketRoundingSeconds' needs to be equal to 'bucketMaxSpanSeconds'")
        if (!(Number(span) >= 1 && Number(span) <= 31536000))
            throw invalid(2, `Timeseries 'bucketMaxSpanSeconds' needs to be between 1 and 31536000, got ${span}`)
        return { timeField: options.timeField, ...meta, bucketRoundingSeconds: Math.trunc(Number(rounding)), bucketMaxSpanSeconds: Math.trunc(Number(span)) }
    }
    const granularity = options.granularity ?? 'seconds'
    return { timeField: options.timeField, ...meta, granularity: granularity, bucketMaxSpanSeconds: GRANULARITIES[granularity].span }
}

/**
 * The options of a time series collection changed by collMod (its option timeseries): a coarser granularity (seconds,
 * minutes, hours), or a span and a rounding not smaller than its span, as MongoDB 8.0 changes them
 *
 * @param current
 * @param given
 * @internal
 */
export function changedTimeSeriesOptions(current: EmbeddedTimeSeriesOptions, given: unknown): EmbeddedTimeSeriesOptions {
    if (typeof given !== 'object' || given === null || Array.isArray(given))
        throw invalid(14, `BSON field 'collMod.timeseries' is the wrong type '${typeName(given)}', expected type 'object'`)
    const change = given as EmbeddedDocument
    for (const field of Object.keys(change))
        if (change[field] !== undefined && !['granularity', 'bucketMaxSpanSeconds', 'bucketRoundingSeconds'].includes(field))
            throw invalid(40415, `BSON field 'collMod.timeseries.${field}' is an unknown field.`)
    const { granularity, bucketMaxSpanSeconds: span, bucketRoundingSeconds: rounding } = change
    const meta = current.metaField !== undefined ? { metaField: current.metaField } : {}
    if (granularity !== undefined) {
        if (!(granularity in GRANULARITIES))
            throw invalid(2, `Enumeration value '${String(granularity)}' for field 'collMod.timeseries.granularity' is not a valid value.`)
        if (span !== undefined || rounding !== undefined)
            throw invalid(72, "Timeseries 'bucketMaxSpanSeconds' and 'bucketRoundingSeconds' are not allowed with a 'granularity'")
        const order = Object.keys(GRANULARITIES)
        if (current.granularity === undefined) {
            if (GRANULARITIES[granularity].span < current.bucketMaxSpanSeconds)
                throw invalid(72, "Timeseries 'bucketMaxSpanSeconds' needs to be equal or greater to transition")
        } else if (order.indexOf(granularity) < order.indexOf(current.granularity))
            throw invalid(72, `Invalid transition for timeseries.granularity. Can only transition from '${current.granularity}' to a coarser granularity`)
        return { timeField: current.timeField, ...meta, granularity: granularity, bucketMaxSpanSeconds: GRANULARITIES[granularity].span }
    }
    if (span === undefined && rounding === undefined) return current
    if (span === undefined || rounding === undefined)
        throw invalid(72, "Timeseries 'bucketMaxSpanSeconds' and 'bucketRoundingSeconds' need to be set alongside each other")
    if (Number(span) !== Number(rounding))
        throw invalid(72, "Timeseries 'bucketRoundingSeconds' needs to be equal to 'bucketMaxSpanSeconds'")
    if (Number(span) < current.bucketMaxSpanSeconds)
        throw invalid(72, "Timeseries 'bucketMaxSpanSeconds' needs to be equal or greater to transition")
    return { timeField: current.timeField, ...meta, bucketRoundingSeconds: Math.trunc(Number(rounding)), bucketMaxSpanSeconds: Math.trunc(Number(span)) }
}

/**
 * The rounding of the start of the buckets of a time series collection, in milliseconds
 *
 * @param options
 * @internal
 */
export function roundingOf(options: EmbeddedTimeSeriesOptions): number {
    return (options.bucketRoundingSeconds ?? GRANULARITIES[options.granularity ?? 'seconds'].rounding) * 1000
}

/**
 * The measurements of a bucket, as MongoDB unpacks them: the time field first, the meta field, then the other fields of
 * each one in the order of the columns of the bucket
 *
 * @param bucket
 * @param options
 * @internal
 */
export function unpacked(bucket: EmbeddedBucket, options: EmbeddedTimeSeriesOptions): EmbeddedDocument[] {
    const measurements: EmbeddedDocument[] = []
    const columns = Object.entries(bucket.data ?? {})
    const times = bucket.data?.[options.timeField] ?? {}
    for (let row = 0; row < bucket.control.count; row++) {
        const key = String(row)
        const measurement: EmbeddedDocument = { [options.timeField]: times[key] }
        if (options.metaField !== undefined && bucket.meta !== undefined) measurement[options.metaField] = bucket.meta
        for (const [field, column] of columns)
            if (field !== options.timeField && column[key] !== undefined) measurement[field] = column[key]
        measurements.push(measurement)
    }
    return measurements
}

/**
 * A bucket of measurements (its _id, its start and its meta kept): its columns in the order of their names (as MongoDB
 * 8.0 orders them for the writes that are not retryable: its measurements unpacked in that order), the smallest and the
 * largest value of each field (the one of the time field its start), as MongoDB packs them
 *
 * @param id
 * @param start the start of the bucket (rounded)
 * @param meta its meta field, if any
 * @param measurements without their meta field
 * @param options
 * @param compare the order of the values (MongoDB's)
 * @internal
 */
export function packed(
    id: unknown,
    start: Date,
    meta: unknown,
    measurements: EmbeddedDocument[],
    options: EmbeddedTimeSeriesOptions,
    compare: (a: unknown, b: unknown) => number
): EmbeddedBucket {
    const data: Record<string, Record<string, unknown>> = {}
    const min: EmbeddedDocument = {}
    const max: EmbeddedDocument = {}
    measurements.forEach((measurement, row) => {
        for (const [field, value] of Object.entries(measurement)) {
            if (value === undefined || field === options.metaField) continue
            ;(data[field] ??= {})[String(row)] = value
            if (min[field] === undefined || compare(value, min[field]) < 0) min[field] = value
            if (max[field] === undefined || compare(value, max[field]) > 0) max[field] = value
        }
    })
    min[options.timeField] = start
    const sorted: Record<string, Record<string, unknown>> = {}
    for (const field of Object.keys(data).sort()) sorted[field] = data[field]
    return {
        _id: id,
        control: { version: 1, min: min, max: max, count: measurements.length },
        ...(meta !== undefined ? { meta: meta } : {}),
        data: sorted
    }
}

/**
 * The checks of a measurement inserted into a time series collection, as MongoDB 8.0 fails them: its time field a date
 * (BadValue, 2)
 *
 * @param measurement
 * @param options
 * @internal
 */
export function checkMeasurement(measurement: EmbeddedDocument, options: EmbeddedTimeSeriesOptions): void {
    if (!(measurement[options.timeField] instanceof Date))
        throw invalid(2, `'${options.timeField}' must be present and contain a valid BSON UTC datetime value`)
}
