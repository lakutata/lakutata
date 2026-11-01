import {Controller} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {LanguagesDTO} from '../dtos/LanguagesDTO.js'

export class LanguageController extends Controller {

    /**
     * Invoked by the user interface once it is loaded, with the languages of the device: the Node.js of the mobile
     * application has no LANG of its own, the messages are in the languages given
     * @param input
     */
    @ServiceAction({cmd: 'languages'}, LanguagesDTO)
    public async languages(input: LanguagesDTO): Promise<void> {
        process.env.LANGUAGE = input.languages.join(':')
        process.env.LANG = input.languages[0]
    }
}
