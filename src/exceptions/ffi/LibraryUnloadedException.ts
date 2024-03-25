import {Exception} from '../../lib/base/abstracts/Exception.js'

export class LibraryUnloadedException extends Exception {
    public errno: string | number = 'E_LIBRARY_UNLOADED'
}
