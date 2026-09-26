/**
 * The local context of a validation error, available to its message template
 */
export interface Context {
    [key: string]: any;

    key?: string;
    label?: string;
    value?: any;
}
