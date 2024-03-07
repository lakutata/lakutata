import {DTO} from '../lib/core/DTO.js'
import {Expect} from '../decorators/dto/Expect.js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {IndexSignature} from '../decorators/dto/IndexSignature.js'

export const OBJECT_ID = Symbol('OBJECT_ID')

@IndexSignature(DTO.Any())
export class LoadObjectOptions<ClassConstructor extends typeof BaseObject = typeof BaseObject> extends DTO {

    @Expect(DTO.Alternatives(DTO.String(), DTO.Symbol()).optional())
    public [OBJECT_ID]?: string | symbol

    @Expect(DTO.Class(() => BaseObject).required())
    public class: ClassConstructor

}
