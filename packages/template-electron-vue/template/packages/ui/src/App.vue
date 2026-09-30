<script setup lang="ts">
import {onMounted, ref} from 'vue'
import {Invoke} from './lakutata'

const message = ref<string>('…')

onMounted(async (): Promise<void> => {
    try {
        message.value = (await Invoke<{ message: string }>('greet', {name: '{$APP_NAME}'})).message
    } catch (error) {
        message.value = (error as Error).message
    }
})
</script>

<template>
    <main>
        <h1>{$APP_NAME}</h1>
        <p>{{ message }}</p>
    </main>
</template>
