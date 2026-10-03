import {useEffect, useState} from 'react'

export function App() {
    const [message, setMessage] = useState<string>('…')
    const [pushed, setPushed] = useState<string>('')

    useEffect((): () => void => {
        //An event the main process pushes
        const greeted = (name: string): void => setPushed(`Pushed by the main process: ${name}`)
        window.ipc.on('greeted', greeted)
        window.ipc.invoke<{ message: string }>({cmd: 'greet', name: '{$APP_NAME}'})
            .then((result: { message: string }): void => setMessage(result.message))
            .catch((error: Error): void => setMessage(error.message))
        return (): void => {
            window.ipc.off('greeted', greeted)
        }
    }, [])

    return (
        <main>
            <h1>{$APP_NAME}</h1>
            <p>{message}</p>
            <p>{pushed}</p>
        </main>
    )
}
