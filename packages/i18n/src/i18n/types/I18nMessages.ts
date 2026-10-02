/**
 * The keys of the messages and their arguments, declared by the application (lakutata i18n types generates them):
 *
 *     declare module '@lakutata/i18n' {
 *         interface I18nMessages {
 *             'order.count': { count: number }
 *         }
 *     }
 *
 * Without them, any key and any arguments are accepted
 */
export interface I18nMessages {
}

/**
 * A key of the messages: one of the declared keys, any string without them
 */
export type MessageKey = keyof I18nMessages extends never ? string : Extract<keyof I18nMessages, string>

/**
 * The arguments of the message of a key
 */
export type MessageParams<K extends string> = K extends keyof I18nMessages ? I18nMessages[K] : Record<string, unknown>
