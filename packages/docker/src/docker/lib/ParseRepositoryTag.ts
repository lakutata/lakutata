import {type RepositoryTag} from '../types/RepositoryTag.js'

/**
 * Split an image reference into its repository and its tag (or digest). A digest (`@`) wins over a tag; the port of a
 * registry (`registry:5000/app`) is not taken for a tag.
 * @param input The image reference: `alpine`, `alpine:3.20`, `registry.example.com:5000/team/app:1.0`,
 * `alpine@sha256:…`.
 * @returns The repository, and the tag (or the digest, without its `@`) when the reference has one.
 * @example
 * ```typescript
 * import {ParseRepositoryTag, type RepositoryTag} from 'lakutata/com/docker'
 *
 * const reference: RepositoryTag = ParseRepositoryTag('registry.example.com:5000/team/app:1.0')
 * console.log(reference) //{repo: 'registry.example.com:5000/team/app', tag: '1.0'}
 * console.log(ParseRepositoryTag('registry.example.com:5000/team/app')) //{repo: 'registry.example.com:5000/team/app'}
 * ```
 */
export function ParseRepositoryTag(input: string): RepositoryTag {
    let separatorPos: number
    const digestPos: number = input.indexOf('@')
    const colonPos: number = input.lastIndexOf(':')
    // @ symbol is more important
    if (digestPos >= 0) {
        separatorPos = digestPos
    } else if (colonPos >= 0) {
        separatorPos = colonPos
    } else {
        // no colon nor @
        return {
            repo: input
        }
    }
    // last colon is either the tag (or part of a port designation)
    const tag: string = input.slice(separatorPos + 1)
    // if it contains a / its not a tag and is part of the url
    if (tag.indexOf('/') === -1) {
        return {
            repo: input.slice(0, separatorPos),
            tag: tag
        }
    }
    return {
        repo: input
    }
}