import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = process.cwd();
const workItemPath = join(root, '.docs/work-items/WI-0010/work-item.json');
const strategyPath = join(root, '.docs/work-items/WI-0010/steps/WI-0010-00000000-cli-session-test-strategy.yaml');
const validationPath = join(root, '.docs/work-items/WI-0010/steps/WI-0010-80000000-cli-session-validation.yaml');
const implementationPaths = [
  '.docs/work-items/WI-0010/steps/WI-0010-10000000-cli-pattern-refactor.yaml',
  '.docs/work-items/WI-0010/steps/WI-0010-20000000-chat-session-persistence.yaml',
  '.docs/work-items/WI-0010/steps/WI-0010-30000000-chat-command-ux.yaml',
];

function read(relativePath: string): string {
  const path = join(root, relativePath);
  assert.equal(existsSync(path), true, `coverage evidence path exists: ${relativePath}`);
  return readFileSync(path, 'utf8');
}

function ids(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1]!);
}

function assertAnchor(ref: string, relativePath: string, pattern: RegExp): void {
  assert.match(read(relativePath), pattern, `${ref} evidence missing in ${relativePath}`);
}

const workItem = JSON.parse(read('.docs/work-items/WI-0010/work-item.json')) as {
  readonly requirements: {
    readonly items: readonly {
      readonly id: string;
      readonly acceptanceCriteria: readonly { readonly id: string }[];
    }[];
  };
  readonly nonGoals: readonly { readonly name: string; readonly description: string }[];
};
const strategy = read('.docs/work-items/WI-0010/steps/WI-0010-00000000-cli-session-test-strategy.yaml');
const validation = read('.docs/work-items/WI-0010/steps/WI-0010-80000000-cli-session-validation.yaml');
const implementations = implementationPaths.map(read).join('\n');
const docs = `${read('README.md')}\n${read('SKILL.md')}`;
const source = `${read('src/cli.ts')}\n${read('src/cli/arguments.ts')}\n${read('src/cli/chat-command.ts')}\n${read('src/cli/prompt-command.ts')}\n${read('src/chat-session-store.ts')}`;
const tests = `${read('tests/cli.test.ts')}\n${read('tests/cli-session-store.test.ts')}`;

const testCaseEvidence: Record<string, readonly [string, RegExp][]> = {
  'TC-CLI-ARCHITECTURE': [['tests/cli.test.ts', /CLI parser preserves request-file and config modes/u]],
  'TC-PROMPT-ISOLATION': [['tests/cli.test.ts', /prompt command performs one completion/u]],
  'TC-CHAT-PERSISTENCE': [['tests/cli.test.ts', /subsequent bare continuation rehydrates history/u], ['tests/cli-session-store.test.ts', /atomically persists bounded provider-neutral state/u]],
  'TC-CHAT-ID': [['tests/cli.test.ts', /fresh chat start replaces explicit-ID state/u], ['tests/cli-session-store.test.ts', /safely validates IDs and contains paths/u]],
  'TC-SHELL-HANDOFF': [['tests/cli.test.ts', /export-only handoff|ambient handoff/u], ['README.md', /eval.*print-chat-id/u]],
  'TC-COMPATIBILITY': [['tests/cli.test.ts', /help\/version|request-file and config modes/u], ['tests/llm.test.ts', /CLI --debug preserves stdout response/u]],
  'TC-SECURITY-SCOPE': [['tests/cli-session-store.test.ts', /credential-bearing persisted state|without credentials/u], ['src/chat-session-store.ts', /MAX_SESSION_BYTES|requestWithoutSecrets/u]],
  'TC-PACKAGE-GATES': [['package.json', /"typecheck"\s*:\s*"tsc --noEmit"/u], ['tests/wi-0010-coverage.test.ts', /WI-0010 coverage audit/u]],
};

test('WI-0010 coverage audit accounts for every requirement, criterion, invariant, objective, test case, and non-goal', () => {
  const declaredRequirements = ids(strategy, /^      - id: (REQ-\d+)$/gmu);
  const declaredInvariants = ids(strategy, /^      - id: (INV-\d+)$/gmu);
  const declaredObjectives = ids(strategy, /^      - id: (OBJ-[A-Z0-9-]+)$/gmu);
  const declaredTestCases = ids(strategy, /^      - id: (TC-[A-Z0-9-]+)$/gmu);
  const coverageBlocks = [...strategy.matchAll(/^      - id: (COV-[A-Z0-9-]+)\n((?:(?!^      - id: ).)*?)(?=^      - id: |(?![\s\S]))/gmsu)];
  const coverageText = coverageBlocks.map((match) => match[2]!).join('\n');

  assert.equal(new Set(declaredRequirements).size, 7);
  assert.equal(new Set(declaredInvariants).size, 6);
  assert.equal(new Set(declaredObjectives).size, 6);
  assert.equal(new Set(declaredTestCases).size, 8);
  assert.equal(workItem.requirements.items.length, 7);
  assert.equal(workItem.requirements.items.flatMap((requirement) => requirement.acceptanceCriteria).length, 15);
  assert.equal(new Set(workItem.requirements.items.flatMap((requirement) => requirement.acceptanceCriteria.map((criterion) => criterion.id))).size, 15);

  for (const id of [...declaredRequirements, ...declaredInvariants, ...declaredObjectives, ...declaredTestCases]) {
    assert.match(coverageText, new RegExp(`\\b${id}\\b`, 'u'), `${id} lacks strategy coverage mapping`);
  }
  for (const id of declaredTestCases) {
    const anchors = testCaseEvidence[id];
    assert.ok(anchors?.length, `${id} lacks executable evidence anchors`);
    for (const [path, pattern] of anchors) assertAnchor(id, path, pattern);
  }

  for (const requirement of workItem.requirements.items) {
    assert.match(strategy, new RegExp(requirement.id.replaceAll('_', '_'), 'u'), `${requirement.id} missing from strategy input`);
    for (const criterion of requirement.acceptanceCriteria) assert.match(JSON.stringify(workItem), new RegExp(criterion.id, 'u'));
  }
  for (const nonGoal of workItem.nonGoals) {
    assert.match(JSON.stringify(workItem), new RegExp(nonGoal.name, 'u'), `${nonGoal.name} missing from work item`);
  }

  assert.match(strategy, /REPL, interactive chat loop, long-lived process, TTY\/readline requirement, stdin-driven message loop/u);
  assert.match(strategy, /every -c invocation starts fresh/u);
  assert.match(strategy, /\/tmp\/\.llm\/chat\//u);
  assert.match(validation, /VAL-CLI-MATRIX/u);
  assert.match(validation, /VAL-PERSISTENCE-SECURITY/u);
  assert.match(validation, /VAL-PACKAGE-SCOPE/u);
  assert.match(implementations, /status: passed|status: implemented/u);
  assert.match(source, /DEFAULT_CHAT_SESSION_ROOT = '\/tmp\/.llm\/chat'/u);
  assert.doesNotMatch(`${source}\n${tests}`, /createInterface|readline|process\.stdin|isTTY|you>|\/exit|\/quit|chat-sessions/u);
  assert.match(docs, /llm -p <prompt>/u);
  assert.match(docs, /llm -c --chat-id <id> <prompt>/u);
  assert.match(docs, /eval.*print-chat-id/u);
  assert.match(docs, /no REPL|no.*REPL|There is intentionally no REPL/u);
});