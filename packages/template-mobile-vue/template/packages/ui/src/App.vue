<script setup lang="ts">
import {onMounted, onUnmounted, ref} from 'vue'

const message = ref<string>('…')
const pushed = ref<string>('')

//An event the application pushes
const greeted = (name: string): void => {
    pushed.value = `Pushed by the application: ${name}`
}

onMounted(async (): Promise<void> => {
    window.ipc.on('greeted', greeted)
    try {
        message.value = (await window.ipc.invoke<{ message: string }>({cmd: 'greet', name: '{$APP_NAME}'})).message
    } catch (error) {
        message.value = (error as Error).message
    }
})

onUnmounted((): void => {
    window.ipc.off('greeted', greeted)
})
</script>

<template>
    <main>
        <h1>{$APP_NAME}</h1>
        <p>{{ message }}</p>
        <p>{{ pushed }}</p>
    </main>
</template>
