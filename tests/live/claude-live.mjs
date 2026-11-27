// Live checks of the claude provider against the real Claude Code CLI.
//
// Run with `npm run test:live:claude` (it builds first). This suite is NOT part
// of `npm test`: it starts the installed `claude` with its own sign-in and
// costs money. Each check prints one JSON result; the process exits non-zero
// if any check fails.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Use the real CLI even if the provider-free test guard's variables are set in this shell.
delete process.env.LLM_CLAUDE_EXECUTABLE;
delete process.env.FAKE_CLAUDE_RESPONSES;
delete process.env.FAKE_CLAUDE_LOG;

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { chatFactory, complete } = await import(join(repository, 'dist', 'index.js'));
const execFileAsync = promisify(execFile);
const REQUEST_SCHEMA = 'https://schemas.handschuh.dev/llm/request/v1';
const results = [];

async function check(name, run) {
  const started = Date.now();
  let result;
  try {
    result = { name, ...(await run()) };
  } catch (error) {
    result = { name, ok: false, error: String(error?.stack ?? error) };
  }
  result.ms = Date.now() - started;
  results.push(result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

await check('text-completion', async () => {
  const response = await complete({ schema: REQUEST_SCHEMA, task: 'Reply with exactly the word: pong', systemPrompt: 'Follow the task exactly. Output nothing else.' });
  return { ok: response.status === 'success' && /pong/iu.test(String(response.output?.value)), status: response.status, output: response.output?.value, errors: response.errors };
});

await check('structured-output-defs', async () => {
  const outputSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'array',
    minItems: 3,
    maxItems: 3,
    items: { $ref: '#/$defs/color' },
    $defs: { color: { type: 'object', additionalProperties: false, required: ['name', 'hex'], properties: { name: { type: 'string' }, hex: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' } } } },
  };
  const response = await complete({ schema: REQUEST_SCHEMA, task: 'List the three primary colors of light with their hex codes.', systemPrompt: 'Return only the requested data.', outputSchema });
  const value = response.output?.value;
  return { ok: response.status === 'success' && Array.isArray(value) && value.length === 3, status: response.status, output: value, errors: response.errors };
});

await check('cli-summarize', async () => {
  // The bundled summarize request declares a 2020-12 outputSchema; this is the path WI-0027 fixed.
  const configuration = await mkdtemp(join(tmpdir(), 'llm-live-claude-config-'));
  try {
    await writeFile(join(configuration, 'config.json'), JSON.stringify({ requestsDirectory: join(repository, 'requests') }));
    const { stdout } = await execFileAsync(process.execPath, [join(repository, 'bin', 'cli.js'), 'summarize', '--content', 'The claude provider runs the Claude Code CLI non-interactively with structured output and tool calling.'], {
      cwd: repository,
      env: { ...process.env, LLM_CONFIG: configuration },
      timeout: 5 * 60 * 1000,
    });
    const summary = JSON.parse(stdout).summary;
    return { ok: typeof summary === 'string' && summary.length > 0, output: summary };
  } catch (error) {
    return { ok: false, error: String(error?.stderr || error?.message || error) };
  } finally {
    await rm(configuration, { recursive: true, force: true });
  }
});

await check('chat-read-write-file-tools', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'llm-live-claude-files-'));
  const calls = [];
  const inside = (path) => {
    const target = resolve(sandbox, String(path));
    const rel = relative(sandbox, target);
    if (rel === '' || rel.startsWith('..')) throw new Error(`path is outside the sandbox: ${path}`);
    return target;
  };
  const objectSchema = (properties, required) => JSON.stringify({ type: 'object', additionalProperties: false, required, properties });
  try {
    await writeFile(join(sandbox, 'notes.txt'), 'alpha\nbravo\ncharlie\n');
    const session = chatFactory.createSession({
      request: {
        schema: REQUEST_SCHEMA,
        task: 'Help the user with files in the working directory using the provided tools.',
        systemPrompt: 'You can read and write files only through the read_file and write_file tools. Paths are relative to the working directory. Keep answers short.',
        toolOptions: {
          tools: [
            { name: 'read_file', description: 'Read a UTF-8 text file. Returns { content }.', inputSchema: objectSchema({ path: { type: 'string' } }, ['path']) },
            { name: 'write_file', description: 'Write a UTF-8 text file, replacing its contents. Returns { bytes }.', inputSchema: objectSchema({ path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']) },
          ],
          autoInvoke: true,
          maxRounds: 4,
          maxCalls: 8,
        },
      },
      toolInvoker: {
        async invoke(call) {
          calls.push({ name: call.name, arguments: call.arguments });
          if (call.name === 'read_file') return { content: await readFile(inside(call.arguments.path), 'utf8') };
          if (call.name === 'write_file') {
            await writeFile(inside(call.arguments.path), String(call.arguments.content));
            return { bytes: Buffer.byteLength(String(call.arguments.content)) };
          }
          throw new Error(`unknown tool ${call.name}`);
        },
      },
    });
    const first = await session.sendUserMessage('Read notes.txt, then write its lines in uppercase and in reverse order to out.txt (one per line). Tell me when done.');
    let written = null;
    try {
      written = await readFile(join(sandbox, 'out.txt'), 'utf8');
    } catch {
      // out.txt was not written.
    }
    const second = await session.sendUserMessage('Without using any tools, which word did you put on the first line of out.txt?');
    const lines = written?.trim().split(/\r?\n/u) ?? [];
    return {
      ok: first.response.status === 'success'
        && JSON.stringify(lines) === JSON.stringify(['CHARLIE', 'BRAVO', 'ALPHA'])
        && calls.some((call) => call.name === 'read_file')
        && calls.some((call) => call.name === 'write_file')
        && second.response.status === 'success'
        && /charlie/iu.test(String(second.response.output?.value)),
      toolCalls: calls,
      outTxt: written,
      firstOutput: first.response.output?.value,
      secondOutput: second.response.output?.value,
      errors: [...first.response.errors, ...second.response.errors],
    };
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

const failed = results.filter((result) => !result.ok).map((result) => result.name);
process.stdout.write(`${JSON.stringify({ summary: { checks: results.length, failed } })}\n`);
process.exitCode = failed.length === 0 ? 0 : 1;
