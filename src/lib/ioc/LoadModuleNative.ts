import 'reflect-metadata'

/**
 * 导入模块(ES6)
 * @param path
 */
export function importModule(path: string): Promise<any> {
    return import(path)
}
