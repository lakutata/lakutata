import {useEffect, useState} from 'react'

/**
 * The results of the API: {errno, errMsg, data}
 */
type APIResult<T> = {
    errno: string | null
    errMsg: string | null
    data: T
}

export function App() {
    const [message, setMessage] = useState<string>('…')

    useEffect((): void => {
        fetch('/api/example?name={$APP_NAME}')
            .then((response: Response): Promise<APIResult<{ message: string }>> => response.json())
            .then((result: APIResult<{ message: string }>): void => setMessage(result.errno ? `${result.errno}: ${result.errMsg}` : result.data.message))
            .catch((error: Error): void => setMessage(error.message))
    }, [])

    return (
        <main>
            <h1>{$APP_NAME}</h1>
            <p>{message}</p>
        </main>
    )
}
