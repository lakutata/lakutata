/**
 * Get all property paths in an object
 * @param target
 * @param basePath
 * @constructor
 */
export function GetObjectPropertyPaths(target: Record<string, any>, basePath: string = ''): string[] {
    const paths: string[] = []
    Object.keys(target).forEach((key: string) => {
        const currentPath: string = basePath ? `${basePath}.${key}` : key
        if (typeof target[key] === 'object') {
            GetObjectPropertyPaths(target[key], currentPath).forEach((path: string) => paths.push(path))
        } else {
            paths.push(currentPath)
        }
    })
    return paths
}
