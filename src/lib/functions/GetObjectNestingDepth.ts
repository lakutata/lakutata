/**
 * Get object's nesting depth
 * @param target
 * @constructor
 */
export function GetObjectNestingDepth(target: Object): number {
    let depth: number = 0
    const keys: string[] = Object.keys(target)
    if (!keys.length) return depth
    let nestingDepth: number = 0
    depth += 1
    keys.forEach((key: string) => {
        if (typeof target[key] === 'object') {
            const subObjectNestingDepth: number = GetObjectNestingDepth(target[key])
            nestingDepth = nestingDepth > subObjectNestingDepth ? nestingDepth : subObjectNestingDepth
        }
    })
    return depth + nestingDepth
}
