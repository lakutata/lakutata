#!/usr/bin/env node
//Before the application changes the environment
import './lib/Environment.js'
import {Application} from 'lakutata'
import {config} from './Config.js'

Application.run(config())
