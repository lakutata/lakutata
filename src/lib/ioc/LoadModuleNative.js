// This is kept in a separate .js file to prevent TypeScript re-writing the import() statement to a require() statement
export function importModule(path) {
    return import(path)
}
// module.exports = { importModule }
