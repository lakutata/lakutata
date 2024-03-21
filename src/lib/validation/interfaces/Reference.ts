import {ReferenceOptions} from './ReferenceOptions.js'

export interface Reference extends Exclude<ReferenceOptions, 'prefix'> {
    depth: number;
    type: string;
    key: string;
    root: string;
    path: string[];
    display: string;

    toString(): string;
}
