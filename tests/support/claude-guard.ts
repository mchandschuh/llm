// Loaded before every test file (see the package.json test scripts).
//
// The default provider is `claude`, so any test that reaches the default
// provider without injecting one would start the real Claude Code CLI and make
// an authenticated, billed call. Point the claude provider at the fake CLI,
// which refuses unconfigured invocations, so that can never happen. Set
// FAKE_CLAUDE_GUARD_LOG to record any such invocation for auditing.
import { chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fake = fileURLToPath(new URL('../fixtures/fake-claude.mjs', import.meta.url));
chmodSync(fake, 0o755);
process.env.LLM_CLAUDE_EXECUTABLE = fake;
if (process.env.FAKE_CLAUDE_GUARD_LOG) process.env.FAKE_CLAUDE_LOG = process.env.FAKE_CLAUDE_GUARD_LOG;
