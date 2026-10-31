/**
 * The builder of the applications of lakutata: their bundles (one CommonJS file run by node) and their executables (the
 * single executable applications of Node.js, or Bun), with their native addons and their resources
 */
export {bundleProject, programName, resourceFiles, type BundleOptions, type BundleResult, type ResourceDeclaration} from './lib/Bundle.js'
export {buildExecutable, type ExecutableOptions, type ExecutableResult} from './lib/Executable.js'
export {NativeCollector, packNativeTree, writeNativeTree, type NativeFile, type NativeIndex, type NativeLink, type NativeTree} from './lib/Native.js'
export {buildInstaller, type InstallerConfig, type InstallerOptions, type InstallerResult, type ServiceOptions} from './lib/Installer.js'
export {LINUX_TARGETS, type LinuxTarget} from './lib/linux/Linux.js'
export {INSTALLER_HOOKS, NATIVE_HOOKS, type InstallerHook, type InstallerScripts, type NativeHook, type NativeScripts} from './lib/Scripts.js'
export {detectLibc} from './lib/Platform.js'
export {WINDOWS_TARGETS, type WindowsTarget} from './lib/win/Windows.js'
export {MAC_TARGETS, type MacTarget} from './lib/mac/Mac.js'
export {downloadNwjs, nwjsPlatform, nwjsRelease, nwjsReleases, type NwjsFlavor, type NwjsRelease, type NwjsRuntime, type NwjsRuntimeOptions} from './lib/nwjs/Runtime.js'
export {stageNwjsApp, type NwjsConfig, type NwjsStage, type NwjsStageOptions} from './lib/nwjs/Stage.js'
