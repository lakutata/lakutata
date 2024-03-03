export interface IConstructor<T = any> {
    new(...args: any[]): T

    [prop: string]: Omit<T, any>
}
