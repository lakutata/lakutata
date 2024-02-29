import {DTO} from './DTO.js'
import {As} from '../base/func/As.js'

class _ObjectDTO extends DTO {

}

export const ObjectDTO = As<typeof Function>(_ObjectDTO)
