import { Any } from '../types.js'

/**
 * The text score of a document found by a $text (its metadata textScore, given by $meta), on the document itself, not
 * enumerable (not one of its fields): the stages after the $text keep it ($project, $addFields, $unwind, $lookup...), as
 * MongoDB keeps the metadata of the documents.
 */
export const TEXT_SCORE: unique symbol = Symbol('textScore')

/**
 * The distance of a document found by a $near or a $geoNear and its location measured (its metadata geoNearDistance
 * and geoNearPoint), kept as the text score is.
 */
export const GEO_DISTANCE: unique symbol = Symbol('geoNearDistance')
export const GEO_POINT: unique symbol = Symbol('geoNearPoint')

/**
 * The symbols of the metadata of the documents
 */
const METADATA = [TEXT_SCORE, GEO_DISTANCE, GEO_POINT]

/**
 * A document given metadata (not enumerable).
 *
 * @param obj
 * @param symbol
 * @param value
 */
function setMetadata<T>(obj: T, symbol: symbol, value: Any): T {
  Object.defineProperty(obj, symbol, { value: value, configurable: true, writable: true, enumerable: false })
  return obj
}

/**
 * A document given a text score.
 *
 * @param obj
 * @param score
 */
export function setTextScore<T>(obj: T, score: number): T {
  return setMetadata(obj, TEXT_SCORE, score)
}

/**
 * A document given its distance and its location of a near.
 *
 * @param obj
 * @param distance
 * @param point
 */
export function setGeoNear<T>(obj: T, distance: number, point: Any): T {
  return setMetadata(setMetadata(obj, GEO_DISTANCE, distance), GEO_POINT, point)
}

/**
 * A document given the metadata of another one (its text score, its distance and location of a near), the ones it has.
 *
 * @param from
 * @param to
 */
export function withMetadata<T>(from: Any, to: T): T {
  if (typeof from !== 'object' || from === null || typeof to !== 'object' || to === null) return to
  for (const symbol of METADATA) {
    const value = (from as Record<symbol, Any>)[symbol]
    if (value !== undefined) setMetadata(to, symbol, value)
  }
  return to
}
