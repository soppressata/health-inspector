#!/usr/bin/env node
import { runCli } from '../src/cli.js';

const status = await runCli();
process.exitCode = status;
