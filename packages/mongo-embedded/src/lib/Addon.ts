import {type NativeAddon} from './Native.js'

/**
 * The addon of the package (build/Release/mongo_embedded.node), written by the build (scripts/addon.mjs) in place of
 * this one: a require of its file by a path from the module, which the builder of lakutata follows when it packs an
 * application
 * @internal
 */
export const addon: NativeAddon = undefined as unknown as NativeAddon
