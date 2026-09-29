#!/usr/bin/env node
import {Application} from 'lakutata'
import {Config} from './config/Config.js'

Application.run(Config())
