export function isXML(string: string): boolean {
    return (/^\s*<[\s\S]*>/).test(string)
}
