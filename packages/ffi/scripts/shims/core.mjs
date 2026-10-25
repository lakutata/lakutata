//What the worker threads use of @lakutata/core: the base of the exceptions. Their errors are sent to the thread of the
//library by their name, their message and their errno, and made again there with the classes of the package
export class Exception extends Error {
    errno = 'E_EXCEPTION'

    constructor(message) {
        super(message)
        this.name = new.target.name
    }
}
