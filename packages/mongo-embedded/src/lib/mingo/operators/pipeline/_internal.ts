import { Lazy } from '../../lazy.js'
import { Any, AnyObject, Options } from '../../types.js'
import { isNumber, isObject } from '../../util/index.js'
import { assert, isArray, isString, PathValidator } from '../../util/_internal.js'
import { $documents } from './documents.js'

const EMPTY = Lazy([])

export function filterDocumentsStage(
  pipeline: AnyObject[] | undefined,
  options: Options
): {
  documents?: AnyObject[]
  pipeline?: AnyObject[]
} {
  if (!pipeline) return {}

  const docs = pipeline[0]?.$documents
  if (!docs) return { pipeline }

  return {
    documents: $documents(EMPTY, docs, options).collect(),
    pipeline: pipeline.slice(1)
  }
}

interface ProjectMetadata {
  exclusions: string[]
  inclusions: string[]
  positional: number
}

export function validateProjection(
  expr: AnyObject,
  options: Options,
  isRoot: boolean = true
): ProjectMetadata {
  const res: ProjectMetadata = {
    exclusions: [],
    inclusions: [],
    positional: 0
  }

  const keys = Object.keys(expr)
  assert(keys.length, 'Invalid empty sub-projection')

  const idKey = options?.idKey
  let idKeyExcluded = false

  for (const k of keys) {
    // validate operators are respected
    if (k.startsWith('$')) {
      assert(
        !isRoot && keys.length === 1,
        `FieldPath field names may not start with '$', given '${k}'.`
      )
      // operators represent the leaves of the traversals so return empty result.
      return res
    }
    // validate positional projections
    if (k.endsWith('.$')) res.positional++

    const v = expr[k]

    if (v === false || (isNumber(v) && v === 0)) {
      if (k === idKey) {
        idKeyExcluded = true
      } else res.exclusions.push(k)
    } else if (!isObject(v)) {
      res.inclusions.push(k)
    } else {
      const meta = validateProjection(v, options, false)
      if (!meta.inclusions.length && !meta.exclusions.length) {
        // if we got nothing back it means we hit a leaf to be included.
        if (!res.inclusions.includes(k)) res.inclusions.push(k)
      } else {
        for (const n of meta.exclusions) res.exclusions.push(`${k}.${n}`)
        for (const n of meta.inclusions) res.inclusions.push(`${k}.${n}`)
      }
      res.positional += meta.positional
    }
    assert(
      !(res.exclusions.length && res.inclusions.length),
      'Cannot do exclusion and inclusion in projection.'
    )
    assert(
      res.positional <= 1,
      'Cannot specify more than one positional projection.'
    )
  }

  // process the idKey
  if (idKeyExcluded) {
    res.exclusions.push(idKey)
  }
  if (isRoot) {
    const p = new PathValidator()
    for (const k of res.exclusions) assert(p.add(k), `Path collision at ${k}.`)
    for (const k of res.inclusions) assert(p.add(k), `Path collision at ${k}.`)
    res.exclusions.sort()
    res.inclusions.sort()
  }
  return res
}

export function resolveCollection(
  op: string,
  expr: Any,
  options: Options
): AnyObject[] {
  if (isString(expr)) {
    assert(
      options.collectionResolver,
      `${op} requires 'collectionResolver' option to resolve named collection`
    )
  }
  const coll = isString(expr)
    ? options.collectionResolver!(expr)
    : (expr as AnyObject[])
  assert(isArray(coll), `${op} could not resolve input collection`)
  return coll
}
