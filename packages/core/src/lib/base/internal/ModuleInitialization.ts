/**
 * The method of a module giving its initialization (its objects loaded, its bootstrap run): the container resolving the
 * module for an object outside it waits for it
 */
export const MODULE_INITIALIZATION: symbol = Symbol('LAKUTATA.MODULE.INITIALIZATION')
