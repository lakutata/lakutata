/**
 * Parse repository tag
 * @param input
 * @constructor
 */
export function ParseRepositoryTag(input: string): {
    repo: string
    tag?: string
} {
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