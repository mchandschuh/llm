import { main } from '../dist/cli.js';

const sample = 'cli-help-version';

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

try {
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => errors.push(args.join(' '));
  let versionCode;
  let versionOutput;
  let helpCode;
  let helpOutput;
  try {
    versionCode = await main(['--version']);
    versionOutput = logs.join('\n');
    logs.length = 0;
    helpCode = await main(['--help']);
    helpOutput = logs.join('\n');
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  const ok = versionCode === 0
    && helpCode === 0
    && /^\d+\.\d+\.\d+$/u.test(versionOutput)
    && helpOutput.includes('Tool-capable request')
    && helpOutput.includes('Tool-capable response')
    && errors.length === 0;
  emit({
    sample,
    ok,
    feature: 'cli-help-version',
    assertions: { versionCode, helpCode, versionOutput, hasToolRequest: helpOutput.includes('Tool-capable request'), hasToolResponse: helpOutput.includes('Tool-capable response'), stderrLines: errors.length },
  });
  if (!ok) process.exitCode = 1;
} catch (error) {
  emit({ sample, ok: false, feature: 'cli-help-version', assertions: { error: String(error) } });
  process.exitCode = 1;
}