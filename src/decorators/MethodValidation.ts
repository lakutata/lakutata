/**
 * 方法接收参数验证装饰器
 * @param {AnySchema | AnySchema[]} argumentSchemas
 * @param {{strict?: boolean, stripUnknown?: boolean}} options
 * @returns {(target: Object, propertyKey: string, descriptor: TypedPropertyDescriptor<(...args: any[]) => any>) => TypedPropertyDescriptor<(...args: any[]) => any>}
 * @constructor
 */
export const Accept: () => (target: Object, propertyKey: string, descriptor: TypedPropertyDescriptor<(...args: any[]) => any>) => TypedPropertyDescriptor<(...args: any[]) => any> = () => {
    return (target: Object, propertyKey: string, descriptor: TypedPropertyDescriptor<(...args: any[]) => any | Promise<any>>) => {
        console.log('Accept')
        return descriptor
    }
}
