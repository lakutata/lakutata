/**
 * Any class creating objects of type `T`.
 */
export interface IConstructor<T = any> {
    new(...args: any[]): T
}
