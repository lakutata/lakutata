/**
 * Internal surface for sibling @lakutata/* packages, not part of the public API
 */
export {GetAppId, GetAppName} from '../lib/foundation/BasicInfo.js'
export {SetDefaultComponent, type DefaultComponentOptions} from '../lib/app/ApplicationDefaults.js'
export {FlexibleDTO} from '../lib/dto/FlexibleDTO.js'
export {clone as CloneDeep} from '../lib/validation/engine/utils/clone.js'
export {RegisterTeardownHook} from '../lib/core/Container.js'
export {WhenApplicationLaunched} from '../lib/app/ApplicationLaunch.js'
export {GetMethodReturnSchema} from '../lib/dto/MethodValidation.js'
