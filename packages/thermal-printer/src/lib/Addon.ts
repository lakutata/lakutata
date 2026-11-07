/**
 * The addon of the package (build/Release/thermal_printer.node: USB printers on macOS and Windows, the print spooler of
 * Windows), loaded at its first use by the function the build (scripts/addon.mjs) writes in place of this one: a
 * require of its file by a path from the module, which the builder of lakutata follows when it packs an application.
 * Linux has no addon (its printers are files and CUPS commands).
 */
export function loadAddon(): unknown {
    throw new Error('The addon of @lakutata/thermal-printer is not built')
}
