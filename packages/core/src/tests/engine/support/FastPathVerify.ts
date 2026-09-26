/**
 * Preload module (node --import) running the validations in the verify mode of the fast path: the fast path and the
 * interpreter both validate, and a different result throws
 */
import {setFastPathMode} from '../../../lib/validation/engine/schema/validator.js'

setFastPathMode('verify')
if (process.env.FAST_PATH_VERIFY_LOG) process.stderr.write('fast path verify mode\n')
