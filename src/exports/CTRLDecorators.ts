import 'reflect-metadata'

//CLI actions
export {CLIAction} from '../decorators/ctrl/CLIAction.js'
//HTTP actions
export {HTTPAction} from '../decorators/ctrl/HTTPAction.js'
export {DELETE} from '../decorators/ctrl/http/DELETE.js'
export {GET} from '../decorators/ctrl/http/GET.js'
export {HEAD} from '../decorators/ctrl/http/HEAD.js'
export {OPTIONS} from '../decorators/ctrl/http/OPTIONS.js'
export {PATCH} from '../decorators/ctrl/http/PATCH.js'
export {POST} from '../decorators/ctrl/http/POST.js'
export {PUT} from '../decorators/ctrl/http/PUT.js'
//Service actions
export {ServiceAction} from '../decorators/ctrl/ServiceAction.js'
