//koffi in the worker threads: the module the thread loaded by its path before the bundle runs (an eval worker cannot
//require koffi by its name: its requires resolve from the working directory)
module.exports = globalThis[Symbol.for('lakutata.ffi.koffi')]
