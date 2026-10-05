#!/usr/bin/env node
import {Application} from 'lakutata'
import {config} from './config/Config.js'

Application.run(config())
