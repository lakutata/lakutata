import {HierarchySeparatorOptions} from './HierarchySeparatorOptions.js'

export interface ReferenceOptions extends HierarchySeparatorOptions {
    /**
     * a function with the signature `function(value)` where `value` is the resolved reference value and the return value is the adjusted value to use.
     * Note that the adjust feature will not perform any type validation on the adjusted value and it must match the value expected by the rule it is used in.
     * Cannot be used with `map`.
     *
     * @example `(value) => value + 5`
     */
    adjust?: (value: any) => any;

    /**
     * an array of array pairs using the format `[[key, value], [key, value]]` used to maps the resolved reference value to another value.
     * If the resolved value is not in the map, it is returned as-is.
     * Cannot be used with `adjust`.
     */
    map?: Array<[any, any]>;

    /**
     * overrides default prefix characters.
     */
    prefix?: {
        /**
         * references to the globally provided context preference.
         *
         * @default '$'
         */
        global?: string;

        /**
         * references to error-specific or rule specific context.
         *
         * @default '#'
         */
        local?: string;

        /**
         * references to the root value being validated.
         *
         * @default '/'
         */
        root?: string;
    };

    /**
     * If set to a number, sets the reference relative starting point.
     * Cannot be combined with separator prefix characters.
     * Defaults to the reference key prefix (or 1 if none present)
     */
    ancestor?: number;

    /**
     * creates an in-reference.
     */
    in?: boolean;

    /**
     * when true, the reference resolves by reaching into maps and sets.
     */
    iterables?: boolean;

    /**
     * when true, the value of the reference is used instead of its name in error messages
     * and template rendering. Defaults to false.
     */
    render?: boolean;
}
