/**
 * The LIKE pattern (with the "!" escape character) of the keys in a namespace
 * @param namespace
 */
export function LikePrefix(namespace: string): string {
    return `${namespace.replace(/[!%_]/g, '!$&')}:%`
}
