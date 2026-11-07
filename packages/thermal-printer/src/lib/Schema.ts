import {DTO} from '@lakutata/core'
import {ThermalPrinterOptionException} from '../exceptions/ThermalPrinterOptionException.js'
import type {PrinterDefinition} from './Types.js'

const NETWORK = DTO.Object({
    type: DTO.String().valid('network').required(),
    host: DTO.String().min(1).required(),
    port: DTO.Number().integer().min(1).max(65535).optional()
})

const QUEUE = DTO.Object({
    type: DTO.String().valid('queue').required(),
    name: DTO.String().min(1).required()
})

const SERIAL = DTO.Object({
    type: DTO.String().valid('serial').required(),
    path: DTO.String().min(1).required(),
    baudRate: DTO.Number().integer().positive().optional(),
    flowControl: DTO.String().valid('none', 'rts/cts', 'dtr/dsr', 'xon/xoff').optional()
})

const USB = DTO.Object({
    type: DTO.String().valid('usb').required(),
    path: DTO.String().min(1).optional(),
    vendorId: DTO.Number().integer().min(0).max(0xFFFF).optional(),
    productId: DTO.Number().integer().min(0).max(0xFFFF).optional(),
    serialNumber: DTO.String().optional()
}).or('path', 'vendorId').with('vendorId', 'productId')

const BLUETOOTH = DTO.Object({
    type: DTO.String().valid('bluetooth').required(),
    address: DTO.String().pattern(/^[0-9A-Fa-f]{2}([:-][0-9A-Fa-f]{2}){5}$/).required(),
    channel: DTO.Number().integer().min(1).max(30).optional()
})

/**
 * The connection of a printer: one of the five kinds
 */
export const CONNECTION = DTO.Alternatives(NETWORK, QUEUE, SERIAL, USB, BLUETOOTH)

/**
 * A printer definition: its connection and the options the package checks; the media are checked by the engine
 */
export const DEFINITION = DTO.Object({
    connection: CONNECTION.required(),
    baseDir: DTO.String().optional(),
    textLanguage: DTO.String().optional(),
    commands: DTO.Object().unknown(true).optional(),
    bytesPerSecond: DTO.Number().positive().optional(),
    connectTimeout: DTO.Number().positive().optional(),
    stallTimeout: DTO.Number().min(0).optional()
}).unknown(true)

/**
 * Check a printer definition (one read from a file, before it is opened): its connection and its options; its media
 * are checked when it is opened.
 * @param definition The definition.
 * @returns The definition, as given.
 * @throws {ThermalPrinterOptionException} It is not a printer definition.
 * @example
 * ```typescript
 * import {readFile} from 'node:fs/promises'
 * import {validatePrinterDefinition} from '@lakutata/thermal-printer'
 * const definition = validatePrinterDefinition(JSON.parse(await readFile('printer.json', 'utf8')))
 * ```
 */
export function validatePrinterDefinition(definition: unknown): PrinterDefinition {
    try {
        DTO.validate(definition, DEFINITION)
    } catch (error) {
        throw new ThermalPrinterOptionException(`Not a printer definition: ${error instanceof Error ? error.message : String(error)}`)
    }
    return definition as PrinterDefinition
}
