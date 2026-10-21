/**
 * Whether the content type of a request is one of the types whose bodies are read as text: the media type equals one of
 * them, case aside, or a type such as `text/*` covers it
 * @param contentType The Content-Type header
 * @param types The types
 */
export function isTextType(contentType: string | undefined, types: readonly string[]): boolean {
    const mediaType: string = (contentType ?? '').split(';')[0].trim().toLowerCase()
    if (!mediaType) return false
    return types.some((type: string): boolean => {
        const listed: string = type.toLowerCase()
        return listed === mediaType || (listed.endsWith('/*') && mediaType.startsWith(listed.slice(0, -1)))
    })
}
