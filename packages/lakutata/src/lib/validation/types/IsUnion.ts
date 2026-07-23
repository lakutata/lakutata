export type IsUnion<T, U extends T = T> =
    T extends unknown ? [U] extends [T] ? false : true : false;
