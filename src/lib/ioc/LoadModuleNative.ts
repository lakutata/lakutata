export function importModule(path: string): Promise<any> {
    return import(path)
}
