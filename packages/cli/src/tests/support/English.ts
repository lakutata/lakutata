/**
 * The tests read the texts of the tool in English, whatever the language of the machine running them (the help and
 * the prompts are in the language of the user: LAKUTATA_LANG, then LC_ALL, LANG)
 */
process.env.LAKUTATA_LANG = 'en'

export {}
