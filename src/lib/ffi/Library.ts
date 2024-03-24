import {ILib} from './interfaces/ILib.js'
import * as koffi from 'koffi'

export class Library {

    #lib: ILib

    constructor(lib: string) {
        this.#lib = koffi.load(lib)
    }
}
