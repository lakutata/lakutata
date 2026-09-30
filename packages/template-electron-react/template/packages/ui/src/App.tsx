import {useEffect, useState} from 'react'
import {Invoke} from './lakutata'

export function App() {
    const [message, setMessage] = useState<string>('…')

    useEffect((): void => {
        Invoke<{ message: string }>('greet', {name: '{$APP_NAME}'})
            .then((result: { message: string }): void => setMessage(result.message))
            .catch((error: Error): void => setMessage(error.message))
    }, [])

    return (
        <main>
            <h1>{$APP_NAME}</h1>
            <p>{message}</p>
        </main>
    )
}
