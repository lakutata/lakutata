//window.ipc, before the components using it
import './ipc'
import {createApp} from 'vue'
import App from './App.vue'

createApp(App).mount('#app')
