import {printerModels, type PrinterLanguage, type PrinterModel} from '@lakutata/thermal'

/**
 * The fields of an IEEE 1284 device id (MFG:EPSON;CMD:ESC/POS;MDL:TM-T88V;CLS:PRINTER;), by their keys in capitals;
 * the long names (MANUFACTURER, MODEL, COMMAND SET) as the short ones
 * @param deviceId
 */
export function deviceIdFields(deviceId: string): Record<string, string> {
    const fields: Record<string, string> = {}
    const aliases: Record<string, string> = {MANUFACTURER: 'MFG', MODEL: 'MDL', 'COMMAND SET': 'CMD', CLASS: 'CLS', DESCRIPTION: 'DES'}
    for (const part of deviceId.split(';')) {
        const colon: number = part.indexOf(':')
        if (colon <= 0) continue
        const key: string = part.slice(0, colon).trim().toUpperCase()
        fields[aliases[key] ?? key] = part.slice(colon + 1).trim()
    }
    return fields
}

/**
 * A name of a model for comparing: its letters and digits
 */
function bare(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * The model of the table a device id names: the longest name its model contains (TM-T88VI before TM-T88V)
 * @param deviceId
 */
export function modelOfDeviceId(deviceId: string): PrinterModel | undefined {
    const model: string = bare(deviceIdFields(deviceId).MDL ?? '')
    if (!model) return undefined
    let found: PrinterModel | undefined
    for (const candidate of printerModels()) {
        const name: string = bare(candidate.name)
        if (name && model.includes(name) && (!found || name.length > bare(found.name).length)) found = candidate
    }
    return found
}

/**
 * The command language of a device id's command sets (CMD): ZPL, TSPL, ESC/POS
 * @param deviceId
 */
export function languageOfDeviceId(deviceId: string): PrinterLanguage | undefined {
    const commands: string = (deviceIdFields(deviceId).CMD ?? '').toUpperCase()
    if (/ZPL/.test(commands)) return 'zpl'
    if (/TSPL/.test(commands)) return 'tspl'
    if (/ESC\s*\/?\s*POS|ESCPOS/.test(commands)) return 'escpos'
    return undefined
}
