import {DTO} from '../lib/core/DTO.js'
import {Expect} from '../decorators/dto/Expect.js'
import {BaseObject} from '../lib/base/BaseObject.js'
import {IndexSignature} from '../decorators/dto/IndexSignature.js'

@IndexSignature(DTO.Any())
export class LoadEntryOptions<ClassConstructor extends typeof BaseObject = typeof BaseObject> extends DTO {
    @Expect(DTO.Class(BaseObject).required())
    public class: ClassConstructor

    [key: string]: any
}
