import {PrimitiveKind} from './PrimitiveKind.js'
import {ArrayHint} from './ArrayHint.js'
import {PrototypeInfo} from './PrototypeInfo.js'

export type TypeInfo = {
    name: string;
    primitive: PrimitiveKind;
    size: number;
    alignment: number;
    disposable: boolean;
    length?: number;
    hint?: ArrayHint;
    ref?: TypeInfo;
    members?: Record<string, { name: string, type: TypeInfo, offset: number }>;
    proto?: PrototypeInfo
}
