#!/usr/bin/env node
//Before the application changes the environment
import './lib/Environment.js'
import {Application} from 'lakutata'
import {Config} from './Config.js'

Application.run(Config())
