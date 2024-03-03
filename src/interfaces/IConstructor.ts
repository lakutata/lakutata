export interface IConstructor<T> {
    new(...args: any[]): T

    [prop: string]: any
}
