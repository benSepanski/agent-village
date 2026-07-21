#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { loadEnvConfig } from '../config/index.js';
import { buildApp } from '../src/app-builder.js';

const app = new App();
const envName = app.node.tryGetContext('env') as string | undefined;
const config = loadEnvConfig(envName);

buildApp(app, config);

app.synth();
