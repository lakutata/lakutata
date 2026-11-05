import { Any, AnyObject, Callback } from './types.js'
import { assert } from './util/index.js'

/**
 * A value produced by a generator
 */
export interface IteratorResult {
  readonly value?: Any
  readonly done: boolean
}

/**
 * Represents a stream interface that provides a method to retrieve the next item in a sequence.
 */
export interface Generator {
  next: () => IteratorResult
}

export type Source = Generator | Callback<IteratorResult> | Iterable<Any>

/**
 * Creates a lazy iterator from the given source.
 */
export function Lazy(source: Source): Iterator {
  return new Iterator(source)
}

/**
 * Concatenate multiple iterators and return a new iterator.
 *
 * @param iterators The iterators to concatenate
 * @returns {Iterator} A new iterator
 */
export function concat(...iterators: Iterator[]): Iterator {
  let index = 0
  return Lazy(() => {
    while (index < iterators.length) {
      const o = iterators[index].next()
      if (!o.done) return o
      index++
    }
    return { done: true, value: undefined }
  })
}

/**
 * Checks whether the given object is compatible with a generator i.e Object{next:Function}
 * @param {*} o An object
 */
function isGenerator(o: Any) {
  return (
    !!o && typeof o === 'object' && typeof (o as AnyObject)?.next === 'function'
  )
}

function isIterable(o: Any) {
  return (
    !!o &&
    (typeof o === 'object' || typeof o === 'function') &&
    typeof (o as Iterable<Any>)[Symbol.iterator] === 'function'
  )
}

interface Iteratee {
  op: 'map' | 'filter'
  fn: Callback<Any>
}

/**
 * A lazy collection iterator yields a single value at a time upon request.
 */
export class Iterator {
  #iteratees: Iteratee[] = []
  #buffer: Any[] = []
  #getNext: Callback<IteratorResult, boolean>
  #done = false

  constructor(source: Source) {
    let iter: Generator
    if (isIterable(source))
      iter = (source as Iterable<Any>)[Symbol.iterator]() as Generator
    else if (isGenerator(source)) iter = source as Generator
    else if (typeof source === 'function') iter = { next: source }
    else
      assert(0, 'mingo: iterator requires an iterable, generator or function')

    // index of successfully transformed and yielded item
    let index = -1
    // create function to yield the next transformed value
    this.#getNext = () => {
      while (true) {
        let { value, done } = iter.next()  
        if (done) return { done }
        let ok = true
        index++
        for (let i = 0; i < this.#iteratees.length; i++) {
          const { op, fn } = this.#iteratees[i]
          const res = fn(value, index)
          if (op === 'map') {
            value = res
          } else if (!res) {
            ok = false
            break
          }
        }
        if (ok) return { value, done }
      }
    }
  }

  /**
   * Add an iteratee to this lazy sequence
   */
  private push(op: 'map' | 'filter', fn: Callback) {
    this.#iteratees.push({ op, fn })
    return this
  }

  next(): IteratorResult {
    return this.#getNext()
  }

  // Iteratees methods

  /**
   * Transform each item in the sequence to a new value
   * @param {Function} f
   */
  map<R, T = R>(f: (o: T, n: number) => R): Iterator {
    return this.push('map', f as Callback)
  }

  /**
   * Select only items matching the given predicate
   * @param {Function} f
   */
  filter<T>(f: (o: T, n: number) => boolean): Iterator {
    return this.push('filter', f as Callback<T>)
  }

  /**
   * Take given numbe for values from sequence
   * @param {Number} n A number greater than 0
   */
  take(n: number): Iterator {
    assert(n >= 0, 'value must be a non-negative integer')
    return this.filter((_: Any) => n-- > 0)
  }

  /**
   * Drop a number of values from the sequence
   * @param {Number} n Number of items to drop greater than 0
   */
  drop(n: number): Iterator {
    assert(n >= 0, 'value must be a non-negative integer')
    return this.filter((_: Any) => n-- <= 0)
  }

  // Transformations

  /**
   * Returns a new lazy object with results of the transformation
   * The entire sequence is realized.
   *
   * @param {Callback<Source, Any[]>} f Tranform function of type (Array) => (Any)
   */
  transform<T>(f: Callback<Iterator, T[]>): Iterator {
    const self = this
    let iter: Iterator
    return Lazy(() => {
      if (!iter) iter = f(self.collect())
      return iter.next()
    })
  }

  /**
   * Retrieves all remaining values from the lazy evaluation and returns them as an array.
   * This method processes the underlying iterator until it is exhausted, storing the results
   * in an internal buffer to ensure subsequent calls return the same data.
   */
  collect<T>(): T[] {
    while (!this.#done) {
      const { done, value } = this.#getNext()
      if (!done) this.#buffer.push(value)
      this.#done = done
    }
    return this.#buffer as T[]
  }

  /**
   * Execute the callback for each value.
   * @param f The callback function.
   */
  each<T>(f: Callback<void, T>): void {
    for (let o = this.next(); o.done !== true; o = this.next()) f(o.value as T)
  }

  /**
   * Returns the reduction of sequence according the reducing function
   *
   * @param f The reducing function
   * @param initialValue The initial value
   */
  reduce<R>(f: Callback<R>, initialValue?: R): R {
    let o = this.next()

    if (initialValue === undefined && !o.done) {
      initialValue = o.value as R
      o = this.next()
    }

    while (!o.done) {
      initialValue = f(initialValue, o.value as R)
      o = this.next()
    }

    return initialValue as R
  }

  /**
   * Returns the number of matched items in the sequence.
   * The stream is realized and buffered for later retrieval with {@link collect}.
   */
  size(): number {
    return this.collect().length
  }

  [Symbol.iterator](): Iterator {
    return this
  }
}
