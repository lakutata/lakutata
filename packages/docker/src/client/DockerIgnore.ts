/*
 * The rules of the .dockerignore files, rewritten from @balena/dockerignore (Copyright 2020 Balena Ltd., Apache License
 * 2.0, and Copyright 2018 Zeit, Inc., MIT License, see THIRD_PARTY_NOTICES.md), which follows the implementation of
 * Docker (moby/moby builder/dockerignore and pkg/fileutils)
 */
import path from 'node:path'

type DockerIgnoreRule = {
    pattern: string
    directories: string[]
    negative: boolean
    expression?: RegExp
}

/**
 * The separators of the paths of the platform: on Windows, "/" and "\" separate the paths and "\" does not escape
 */
const SEPARATOR: string = path.sep

/**
 * filepath.Clean of Go
 * @param file
 */
function CleanPath(file: string): string {
    return path.normalize(file).replace(SEPARATOR === '\\' ? /(?<=.)\\$/ : /(?<=.)\/$/, '')
}

/**
 * filepath.ToSlash of Go
 * @param file
 */
function ToSlash(file: string): string {
    return SEPARATOR === '/' ? file : file.replace(/\\/g, '/')
}

/**
 * filepath.FromSlash of Go
 * @param file
 */
function FromSlash(file: string): string {
    return SEPARATOR === '/' ? file : file.replace(/\//g, SEPARATOR)
}

/**
 * The rules of a .dockerignore file: the files of a build context they exclude
 */
export class DockerIgnore {

    readonly #rules: DockerIgnoreRule[] = []

    readonly #cache: Map<string, boolean> = new Map()

    /**
     * @param content the content of a .dockerignore file
     * @param ignoreCase match the case-insensitively, as Docker does not (false by default)
     */
    constructor(content: string = '', protected readonly ignoreCase: boolean = false) {
        this.add(content)
    }

    /**
     * Add the rules of a content
     * @param content
     */
    public add(content: string): this {
        for (const line of content.split(/\r?\n/)) {
            if (!line.trim() || line.startsWith('#')) continue
            const rule: DockerIgnoreRule | undefined = this.rule(line.trim())
            if (rule) this.#rules.push(rule)
        }
        this.#cache.clear()
        return this
    }

    /**
     * A rule of a line (moby/moby builder/dockerignore/dockerignore.go and pkg/fileutils/fileutils.go)
     * @param line
     */
    protected rule(line: string): DockerIgnoreRule | undefined {
        let pattern: string = line
        let negative: boolean = false
        if (pattern.startsWith('!')) {
            negative = true
            pattern = pattern.substring(1).trim()
        }
        if (pattern.length > 0) {
            pattern = ToSlash(CleanPath(pattern))
            if (pattern.length > 1 && pattern.startsWith('/')) pattern = pattern.slice(1)
        }
        if (negative) pattern = `!${pattern}`
        pattern = pattern.trim()
        if (!pattern) return undefined
        pattern = CleanPath(pattern)
        if (pattern.startsWith('!')) {
            if (pattern.length === 1) return undefined
            negative = true
            pattern = pattern.substring(1)
        } else {
            negative = false
        }
        return {pattern: pattern, directories: pattern.split(SEPARATOR), negative: negative}
    }

    /**
     * The regular expression of a rule (fileutils.go regexpMatch)
     * @param rule
     */
    protected expression(rule: DockerIgnoreRule): RegExp {
        if (rule.expression) return rule.expression
        const separator: string = SEPARATOR === '\\' ? '\\\\' : SEPARATOR
        let source: string = '^'
        const pattern: string = rule.pattern
        for (let index: number = 0; index < pattern.length; index++) {
            const character: string = pattern[index]
            if (character === '*') {
                if (pattern[index + 1] === '*') {
                    index++
                    //"**/" is "**"
                    if (pattern[index + 1] === SEPARATOR) index++
                    source += pattern[index + 1] === undefined ? '.*' : `(.*${separator})?`
                } else {
                    source += `[^${separator}]*`
                }
            } else if (character === '?') {
                source += `[^${separator}]`
            } else if (character === '.' || character === '$') {
                source += `\\${character}`
            } else if (character === '\\') {
                if (SEPARATOR === '\\') {
                    source += separator
                } else if (pattern[index + 1] !== undefined) {
                    source += `\\${pattern[++index]}`
                } else {
                    source += '\\'
                }
            } else {
                source += character
            }
        }
        return rule.expression = new RegExp(`${source}$`, this.ignoreCase ? 'i' : '')
    }

    /**
     * Whether a file of the context is excluded by the rules (its path relative to the context, "/" separated)
     * @param file
     */
    public ignores(file: string): boolean {
        if (!file) return true
        let ignored: boolean | undefined = this.#cache.get(file)
        if (ignored === undefined) this.#cache.set(file, ignored = this.test(file))
        return ignored
    }

    /**
     * Whether a file is excluded: the last rule matching it or one of its parent directories decides
     * @param file
     */
    protected test(file: string): boolean {
        const local: string = FromSlash(file)
        const parent: string = CleanPath(path.dirname(local))
        const parentDirectories: string[] = parent.split(SEPARATOR)
        let matched: boolean = false
        for (const rule of this.#rules) {
            let match: boolean = this.expression(rule).test(local)
            if (!match && parent !== '.') {
                if (rule.directories.includes('**')) {
                    for (let index: number = rule.directories.filter((directory: string): boolean => directory !== '**').length; index <= parentDirectories.length; index++) {
                        match = match || this.expression(rule).test(parentDirectories.slice(0, index).join(SEPARATOR))
                    }
                } else if (rule.directories.length <= parentDirectories.length) {
                    match = this.expression(rule).test(parentDirectories.slice(0, rule.directories.length).join(SEPARATOR))
                }
            }
            if (match) matched = !rule.negative
        }
        return matched
    }
}
