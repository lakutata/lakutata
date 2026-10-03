/**
 * The builder of the applications of lakutata: their bundles (one CommonJS file run by node) and their executables (the
 * single executable applications of Node.js, or Bun), with their native addons and their resources
 */
export {BundleProject, ProgramName, ResourceFiles, type BundleOptions, type BundleResult, type ResourceDeclaration} from './lib/Bundle.js'
export {BuildExecutable, type ExecutableOptions, type ExecutableResult} from './lib/Executable.js'
export {NativeCollector, PackNativeTree, WriteNativeTree, type NativeFile, type NativeIndex, type NativeLink, type NativeTree} from './lib/Native.js'
