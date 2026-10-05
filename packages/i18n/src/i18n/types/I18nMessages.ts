/**
 * The application's message keys and their arguments, declared by the application to type-check {@link I18n.t} and
 * the translators: a wrong key or a missing argument is then a compilation error. `lakutata i18n types` (or
 * {@link generateMessageTypes}) generates the declaration from the messages of the default language, or it is written
 * by hand, in the module the application imports the i18n from:
 *
 *     declare module 'lakutata/com/i18n' {
 *         interface I18nMessages {
 *             'order.count': { count: number }
 *         }
 *     }
 *
 * Empty by default: any key and any arguments are then accepted.
 */
export interface I18nMessages {
}

/**
 * A message key: one of the keys declared in {@link I18nMessages}, any string when none is declared.
 */
export type MessageKey = keyof I18nMessages extends never ? string : Extract<keyof I18nMessages, string>

/**
 * The arguments of the message of a key: the ones declared in {@link I18nMessages}, any record for a key not declared.
 */
export type MessageParams<K extends string> = K extends keyof I18nMessages ? I18nMessages[K] : Record<string, unknown>
