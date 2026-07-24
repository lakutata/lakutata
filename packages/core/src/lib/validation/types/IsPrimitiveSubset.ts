export type IsPrimitiveSubset<T> =
    [T] extends [string]
        ? true
        : [T] extends [number]
            ? true
            : [T] extends [bigint]
                ? true
                : [T] extends [boolean]
                    ? true
                    : [T] extends [symbol]
                        ? true
                        : [T] extends [null]
                            ? true
                            : [T] extends [undefined]
                                ? true
                                : false;
