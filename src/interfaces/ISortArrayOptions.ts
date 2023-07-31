type TOrder = 'asc' | 'desc'
type TComputedFunction<T> = (() => any) | ((item: T) => any)
type TComputed<T> = { [computedKey: string]: TComputedFunction<T> }

export interface ISortArrayOptions<T = any> {
    readonly by?: keyof T | string
    readonly order?: TOrder
    readonly computed?: TComputed<T>
}
