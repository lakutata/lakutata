import {HierarchySeparatorOptions} from './HierarchySeparatorOptions.js'

export     interface DependencyOptions extends HierarchySeparatorOptions {
    /**
     * overrides the default check for a present value.
     *
     * @default (resolved) => resolved !== undefined
     */
    isPresent?: (resolved: any) => boolean;
}
