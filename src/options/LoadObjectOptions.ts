import {DTO} from '../lib/core/DTO.js'
import {Expect} from '../decorators/dto/Expect.js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {IndexSignature} from '../decorators/dto/IndexSignature.js'

@IndexSignature(DTO.Any())
export class LoadObjectOptions<ClassConstructor extends typeof BaseObject = typeof BaseObject> extends DTO {

    @Expect(DTO.Alternatives(DTO.String(), DTO.Symbol()).optional())
    public id?: string | symbol

    @Expect(DTO.Class(() => BaseObject).required())
    public class: ClassConstructor

}
