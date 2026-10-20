import {binaryData} from '../imports/common.js'

const {encode} = binaryData

export function encodeBuffer(obj: object, spec: binaryData.Schema) {
    return encode(obj, spec)
}
