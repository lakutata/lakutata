import { Any } from '../types.js'

/**
 * The text score of a document found by a $text (its metadata textScore, given by $meta), on the document itself, not
 * enumerable (not one of its fields): the stages after the $text keep it ($project, $addFields, $unwind, $lookup...), as
 * MongoDB keeps the metadata of the documents.
 */
export const TEXT_SCORE: unique symbol = Symbol('textScore')

/**
 * A document given a text score.
 *
 * @param obj
 * @param score
 */
export function setTextScore<T>(obj: T, score: number): T {
  Object.defineProperty(obj, TEXT_SCORE, { value: score, configurable: true, writable: true, enumerable: false })
  return obj
}

/**
 * A document given the text score of another one, if it has one.
 *
 * @param from
 * @param to
 */
export function withTextScore<T>(from: Any, to: T): T {
  const score = (from as Record<symbol, Any> | null)?.[TEXT_SCORE]
  if (typeof score === 'number' && typeof to === 'object' && to !== null) setTextScore(to, score)
  return to
}
