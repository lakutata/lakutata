type TOrder = 'asc' | 'desc'
type TComputedFunction<T> = (() => any) | ((item: T) => any)
type TComputed<T> = { [computedKey: string]: TComputedFunction<T> }

export interface ISortArrayOptions<T = any> {
    by?: keyof T | string
    order?: TOrder
    computed?: TComputed<T>
}
