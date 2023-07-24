import {readdir} from 'fs/promises'

(async () => {
    console.log(await readdir('./'))
})()
