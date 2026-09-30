/*
 * The matching of the patterns, rewritten from patrun (Copyright (c) 2013-2022 Richard Rodger, MIT License, see
 * THIRD_PARTY_NOTICES.md): the same decision tree, the same results
 */
import {GlobPattern} from './GlobPattern.js'

/**
 * A pattern: its values are compared as strings
 */
export type Pattern = Record<string, any>

/**
 * A glob of a key of a node, and the node of the patterns it matches
 */
type GlobBranch = {
    glob: GlobPattern
    node: PatternNode
}

/**
 * A node of the decision tree: the patterns having its key are found by its value (or by a glob of it), the patterns
 * without it are in its "star" node. The keys are ordered along the tree, as the keys of the patterns
 */
type PatternNode = {
    /**
     * The key the node decides on
     */
    key?: string
    /**
     * The nodes of the values of the key
     */
    values?: Record<string, PatternNode>
    /**
     * The nodes of the globs of the key
     */
    globs?: Record<string, GlobBranch[]>
    /**
     * The node of the patterns without the key
     */
    star?: PatternNode
    /**
     * The object of the pattern ending at the node
     */
    data?: unknown
    hasData?: boolean
}

export type PatternManagerOptions = {
    /**
     * The values of the patterns having "*" or "?" are globs, true by default
     */
    globMatch?: boolean
}

/**
 * A dictionary without prototype: the values of the subjects are never the properties of Object ("constructor"…)
 */
function Dictionary<T>(): Record<string, T> {
    return Object.create(null)
}

/**
 * The patterns of the actions and the objects they give: a subject is matched by the most specific pattern whose
 * properties it has (the unknown properties of the subject are ignored)
 */
export class PatternManager {

    readonly #globMatch: boolean

    readonly #top: PatternNode = {}

    constructor(options: PatternManagerOptions = {globMatch: true}) {
        this.#globMatch = !!options.globMatch
    }

    /**
     * The glob of a value of a pattern, undefined when it is not one
     * @param value
     */
    protected glob(value: string): GlobPattern | undefined {
        return this.#globMatch && GlobPattern.isGlob(value) ? new GlobPattern(value) : undefined
    }

    /**
     * The node of a glob of a key of a node, added once
     * @param node
     * @param key
     * @param glob
     */
    protected globNode(node: PatternNode, key: string, glob: GlobPattern): PatternNode {
        const globs: Record<string, GlobBranch[]> = node.globs ??= Dictionary<GlobBranch[]>()
        const branches: GlobBranch[] = globs[key] ??= []
        let branch: GlobBranch | undefined = branches.find((candidate: GlobBranch): boolean => candidate.glob.glob === glob.glob)
        if (!branch) branches.push(branch = {glob: glob, node: {}})
        return branch.node
    }

    /**
     * Register a pattern, and the object that will be returned if an input matches.
     * Both keys and values are considered to be strings.
     * Other types are converted to strings.
     * @param pattern
     * @param obj
     */
    public add(pattern: Pattern, obj: any): this {
        const keys: string[] = Object.keys(pattern).filter((key: string): boolean => pattern[key] !== null && pattern[key] !== undefined).sort()
        const values: Record<string, string> = Object.fromEntries(keys.map((key: string): [string, string] => [key, String(pattern[key])]))
        let node: PatternNode = this.#top
        //The keys of the path are ordered: a key is inserted before the next key of the path, or follows the star nodes
        for (let index: number = 0; index < keys.length; index++) {
            const key: string = keys[index]
            const value: string = values[key]
            const glob: GlobPattern | undefined = this.glob(value)
            if (node.values && node.key === key) {
                //The key of the node
                node = glob ? this.globNode(node, key, glob) : node.values[value] ??= {}
            } else if (!node.key) {
                //The end of the path: the key is the last one
                node.key = key
                node.values = Dictionary<PatternNode>()
                node = glob ? this.globNode(node, key, glob) : node.values[value] = {}
            } else if (key < node.key) {
                //The key orders before the key of the node: the node moves to the star node of the key
                const {star, globs} = node
                node.star = {key: node.key, values: node.values}
                if (star) node.star.star = star
                if (globs) node.star.globs = globs
                if (node.globs) node.globs = Dictionary<GlobBranch[]>()
                node.key = key
                node.values = Dictionary<PatternNode>()
                node = glob ? this.globNode(node, key, glob) : node.values[value] = {}
            } else {
                //The key orders after the key of the node: it is in the path of the patterns without the key of the node
                node = node.star ??= {}
                index--
            }
        }
        if (obj !== undefined) {
            node.data = obj
            node.hasData = true
        }
        return this
    }

    /**
     * Remove this pattern, and it's object, from the matcher.
     * @param pattern
     */
    public remove(pattern: Pattern): this {
        let node: PatternNode | undefined = this.#top
        let data: unknown = undefined
        let hasData: boolean = false
        let last: PatternNode | undefined = undefined
        do {
            const key: string = node.key!
            if (node.values || node.globs) {
                let next: PatternNode | undefined = node.values?.[pattern[key]]
                if (next) last = next
                if (!next && node.globs) {
                    const branch: GlobBranch | undefined = (node.globs[key] ?? []).find((candidate: GlobBranch): boolean => candidate.glob.glob === pattern[key])
                    if (branch) last = next = branch.node
                }
                if (next) {
                    data = next.data
                    hasData = !!next.hasData
                    node = next
                } else {
                    node = node.star
                }
            } else {
                node = undefined
            }
        } while (node)
        if (hasData && data !== undefined && last) {
            delete last.data
            delete last.hasData
        }
        return this
    }

    /**
     * Return the unique match for this subject, or null if not found.
     * The properties of the subject are matched against the patterns previously added, and the most specifc pattern wins.
     * Unknown properties in the subject are ignored.
     * If exact is true, then all properties of the subject must match.
     * @param subject
     * @param exact
     */
    public find(subject: Pattern, exact: boolean = false): any {
        if (subject === null || subject === undefined) return null
        const top: PatternNode = this.#top
        let node: PatternNode | undefined = top
        let data: unknown = top.hasData ? top.data : null
        const stars: PatternNode[] = []
        const found: Set<string> | undefined = exact ? new Set<string>() : undefined
        do {
            const key: string = node.key!
            if (node.values) {
                const value: any = subject[key]
                //The value itself (converted to a string, as the key of a dictionary), else a glob of it
                let next: PatternNode | undefined = node.values[value]
                if (!next && node.globs?.[key]) next = node.globs[key].find((branch: GlobBranch): boolean => branch.glob.matches(value))?.node
                if (next) {
                    found?.add(key)
                    if (node.star) stars.push(node.star)
                    data = next.hasData ? next.data : (exact ? null : data)
                    node = next
                } else {
                    //The patterns without the key
                    node = node.star
                }
            } else {
                node = undefined
            }
            //The wider patterns, when the narrower ones gave nothing
            if (!node && stars.length && (data === null || data === undefined)) node = stars.pop()
        } while (node)
        if (exact) {
            if (found!.size !== Object.keys(subject).length) data = null
        } else if ((data === null || data === undefined) && top.hasData) {
            //The object of the empty pattern matches everything
            data = top.data
        }
        return data
    }

    /**
     * Return the list of registered patterns that contain this partial pattern.
     * You can use wildcards for property values.
     * Omitted values are not equivalent to a wildcard of "*", you must specify each property explicitly.
     * @param partialPattern
     * @param exact the omitted properties match nothing
     */
    public list(partialPattern?: Pattern, exact: boolean = false): { match: Record<string, any>, data: any }[] {
        const pattern: Pattern = partialPattern ?? {}
        const results: { match: Record<string, any>, data: any }[] = []
        const descend = (node: PatternNode, match: Record<string, any>, missing: Record<string, any>): void => {
            if (!node.values) return
            const key: string = node.key!
            const glob: GlobPattern = new GlobPattern(pattern[key] === null || pattern[key] === undefined ? (exact ? null : '*') : pattern[key])
            for (const value in node.values) {
                //The empty value is not matched by a glob (gex gives back the matched value, which is falsy)
                if (value === pattern[key] || (!exact && (pattern[key] === null || pattern[key] === undefined)) || (value !== '' && glob.test(value))) {
                    const valueMatch: Record<string, any> = {...match, [key]: value}
                    const valueMissing: Record<string, any> = {...missing}
                    delete valueMissing[key]
                    const next: PatternNode = node.values[value]
                    if (!Object.keys(valueMissing).length && next.hasData && next.data) results.push({match: valueMatch, data: next.data})
                    if (next.values) descend(next, {...valueMatch}, {...valueMissing})
                }
            }
            if (node.star) descend(node.star, {...match}, {...missing})
        }
        if (this.#top.hasData && this.#top.data) results.push({match: {}, data: this.#top.data})
        descend(this.#top, {}, {...pattern})
        return results
    }

    /**
     * Generate a string representation of the decision tree for debugging.
     */
    public toJSON(): string {
        return JSON.stringify(this.#top, (key: string, value: unknown): unknown => value instanceof GlobPattern ? String(value.glob) : (key === 'hasData' ? undefined : value))
    }
}
