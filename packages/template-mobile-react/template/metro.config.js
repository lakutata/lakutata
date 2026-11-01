const path = require('path')
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config')
const {createHarmonyMetroConfig} = require('@react-native-oh/react-native-harmony/metro.config')

/**
 * A directory of the project left out of what Metro watches and resolves
 * @param directory
 */
const outside = (directory) => new RegExp(`^${path.resolve(__dirname, directory).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[/\\\\].*`)

/**
 * The configuration of Metro: React Native, and the platform harmony of RNOH (the user interface of HarmonyOS). The
 * user interface does not import the code of packages/app, which runs in the Node.js of the application
 */
module.exports = mergeConfig(getDefaultConfig(__dirname), createHarmonyMetroConfig({reactNativeHarmonyPackageName: '@react-native-oh/react-native-harmony'}), {
    resolver: {blockList: [outside('packages'), outside('native/node/out'), outside('android/app/src/main/assets'), outside('ios/nodejs')]}
})
