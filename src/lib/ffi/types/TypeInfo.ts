import {PrimitiveKind} from './PrimitiveKind.js'
import {ArrayHint} from './ArrayHint.js'
import {ICType} from '../interfaces/ICType.js'

export type TypeInfo = {
    name: string;
    primitive: PrimitiveKind;
    size: number;
    alignment: number;
    disposable: boolean;
    length?: number;
    hint?: ArrayHint;
    ref?: ICType;
    members?: Record<string, { name: string, type: ICType, offset: number }>
}
