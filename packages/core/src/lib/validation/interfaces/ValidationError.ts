import {ValidationErrorItem} from './ValidationErrorItem.js'

export interface ValidationError extends Error {
    name: 'ValidationError';

    /**
     * array of errors.
     */
    details: ValidationErrorItem[];

    /**
     * function that returns a string with an annotated version of the object pointing at the places where errors occurred.
     *
     * @param stripColors - if truthy, will strip the colors out of the output.
     */
    annotate(stripColors?: boolean): string;

    _original: any;
}
