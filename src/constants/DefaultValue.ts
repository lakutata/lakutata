import 'reflect-metadata'
import {ValidationOptions} from '../exports/Validator.js'

/**
 * 数据验证默认选项
 */
export const defaultValidationOptions: ValidationOptions = {
    abortEarly: true,
    cache: false,
    allowUnknown: true,
    stripUnknown: true,
    debug: false
}
