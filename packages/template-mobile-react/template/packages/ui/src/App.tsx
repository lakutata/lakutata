import {useEffect, useState} from 'react'
import {Button, ScrollView, StyleSheet, Text} from 'react-native'
import {SafeAreaProvider, useSafeAreaInsets, type EdgeInsets} from 'react-native-safe-area-context'
import {ipc} from 'ipc'

/**
 * The application: its screen in the safe area of the device, given by the provider
 */
export default function App() {
    return (
        <SafeAreaProvider>
            <Home/>
        </SafeAreaProvider>
    )
}

function Home() {
    //Clear of the status bar, the camera and the home indicator, wherever the device has them
    const insets: EdgeInsets = useSafeAreaInsets()
    const [message, setMessage] = useState<string>('…')
    const [pushed, setPushed] = useState<string>('')
    const [ended, setEnded] = useState<number | null>(null)

    const greet = (): void => {
        ipc.invoke<{ message: string }>({cmd: 'greet', name: '{$APP_NAME}'})
            .then((result: { message: string }): void => setMessage(result.message))
            .catch((error: Error): void => setMessage(error.message))
    }

    useEffect((): () => void => {
        //An event the application pushes
        const offGreeted = ipc.on('greeted', (name: string): void => setPushed(`Pushed by the application: ${name}`))
        //Node.js ended (process.exit(), an uncaught exception): the mobile application keeps running
        const offExit = ipc.on('exit', (code: number): void => setEnded(code))
        //@if i18n
        //The languages of the device, which the messages of the application are in
        ipc.invoke({cmd: 'languages', languages: [Intl.DateTimeFormat().resolvedOptions().locale]}).catch((): void => undefined)
        //@end
        greet()
        return (): void => {
            offGreeted()
            offExit()
        }
    }, [])

    const restart = (): void => {
        setEnded(null)
        ipc.restart()
        greet()
    }

    return (
        <ScrollView contentContainerStyle={{paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24, paddingLeft: insets.left + 24, paddingRight: insets.right + 24}}>
            <Text style={styles.title}>{$APP_NAME}</Text>
            <Text style={styles.text}>{message}</Text>
            <Text style={styles.text}>{pushed}</Text>
            {ended !== null && (
                <>
                    <Text style={styles.text}>Node.js ended (exit code {ended})</Text>
                    <Button title="Restart" onPress={restart}/>
                </>
            )}
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    title: {fontSize: 24, fontWeight: 'bold', marginBottom: 16},
    text: {fontSize: 16, marginBottom: 8}
})
