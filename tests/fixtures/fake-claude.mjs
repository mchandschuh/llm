#!/usr/bin/env node
// Fake Claude Code CLI for provider-free tests.
//
// Every invocation appends { argv, stdin } as one JSON line to FAKE_CLAUDE_LOG
// when that variable is set. Replies come from the JSON array file named by
// FAKE_CLAUDE_RESPONSES, one entry per invocation in order:
//   { "stdout": "<text>" | <json value>, "stderr": "<text>", "exitCode": 0, "delayMs": 0 }
// Without configured responses the fake refuses: tests must never reach a
// real or default claude invocation by accident.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const stdin = Buffer.concat(chunks).toString('utf8');

const log = process.env.FAKE_CLAUDE_LOG;
let invocation = 0;
if (log) {
  invocation = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0;
  appendFileSync(log, `${JSON.stringify({ argv: process.argv.slice(2), stdin })}\n`);
}

const responsesPath = process.env.FAKE_CLAUDE_RESPONSES;
const responses = responsesPath ? JSON.parse(readFileSync(responsesPath, 'utf8')) : [];
const response = responses[invocation] ?? responses.at(-1) ?? {
  stdout: { subtype: 'error_during_execution', is_error: true, result: 'fake claude: no response configured; tests must not invoke claude without a configured fake.' },
  exitCode: 1,
};

if (response.delayMs) await new Promise((resolve) => setTimeout(resolve, response.delayMs));
if (response.stderr) process.stderr.write(response.stderr);
process.stdout.write(typeof response.stdout === 'string' ? response.stdout : JSON.stringify(response.stdout ?? ''));
process.exitCode = response.exitCode ?? 0;
