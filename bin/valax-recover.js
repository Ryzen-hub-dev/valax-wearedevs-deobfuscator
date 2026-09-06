#!/usr/bin/env node
const { runCli } = require('../packages/cli/src/index');

runCli(process.argv.slice(2));
