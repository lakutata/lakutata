import {HierarchySeparatorOptions} from './HierarchySeparatorOptions.js'

export interface ArrayUniqueOptions extends HierarchySeparatorOptions {
    /**
     * if true, undefined values for the dot notation string comparator will not cause the array to fail on uniqueness.
     *
     * @default false
     */
    ignoreUndefined?: boolean
}
