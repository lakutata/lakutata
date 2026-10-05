#!/usr/bin/env node
import {Application} from 'lakutata'
import {installerConfig} from './config/Config.js'

Application.run(installerConfig())
