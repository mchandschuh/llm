import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = process.cwd();
const workItemPath = join(root, '.docs/work-items/WI-0009/work-item.json');
const strategyPath = join(root, '.docs/work-items/WI-0009/steps/WI-0009-70000000-chat-session-test-strategy.yaml');
const designPath = join(root, '.docs/work-items/WI-0009/steps/WI-0009-00000000-chat-session-design.yaml');

function read(path: string): string {
  assert.equal(existsSync(path), true, `coverage evidence path exists: ${path}`);
  return readFileSync(path, 'utf8');
}

function ids(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1]!);
}

function assertAnchors(ref: string, anchors: readonly { readonly path: string; readonly pattern: RegExp }[]): void {
  assert.ok(anchors.length > 0, `${ref} must have executable evidence anchors`);
  for (const anchor of anchors) assert.match(read(join(root, anchor.path)), anchor.pattern, `${ref} evidence missing in ${anchor.path}`);
}

const workItem = JSON.parse(read(workItemPath)) as {
  readonly requirements: {
    readonly items: readonly {
      readonly id: string;
      readonly acceptanceCriteria: readonly { readonly id: string }[];
    }[];
  };
};
const strategy = read(strategyPath);
const design = read(designPath);

const testCaseEvidence: Record<string, readonly { readonly path: string; readonly pattern: RegExp }[]> = {
  'TC-FACTORY-CONTRACT': [{ path: 'tests/chat.test.ts', pattern: /chatFactory creates independent sessions/u }],
  'TC-TASK-MESSAGE-SEPARATION': [{ path: 'tests/chat.test.ts', pattern: /session keeps task context separate/u }],
  'TC-HISTORY-REPLAY': [{ path: 'tests/chat.test.ts', pattern: /session replays two complete assistant\/tool rounds/u }, { path: 'tests/provider-projection.test.ts', pattern: /complete request-3 history/u }],
  'TC-TOOL-VALIDATION-RETRY': [{ path: 'tests/chat.test.ts', pattern: /failed tools append bounded|provider retries do not duplicate/u }],
  'TC-ADDITIONAL-USER': [{ path: 'tests/chat.test.ts', pattern: /later user turn follows|ordinary session turns append/u }],
  'TC-USER-POLICIES': [{ path: 'tests/chat.test.ts', pattern: /blocked user messages|interrupt branches use/u }, { path: 'tests/chat-session-samples.test.ts', pattern: /interruptible chat sample|blocked chat sample/u }],
  'TC-PROJECTION': [{ path: 'tests/provider-projection.test.ts', pattern: /OpenRouterHttpProjection maps|OpenRouterProvider serializes/u }],
  'TC-PROMPT-XSD': [{ path: 'tests/prompt-xsd.test.ts', pattern: /generated prompts and all prompt fixtures/u }],
  'TC-SAMPLES': [{ path: 'tests/chat-session-samples.test.ts', pattern: /ordinary chat sample|interruptible chat sample|blocked chat sample/u }, { path: 'tests/samples.test.ts', pattern: /every executable feature sample/u }],
  'TC-DOCS-NONGOALS': [{ path: 'tests/wi-0009-coverage.test.ts', pattern: /callers must serialize mutations|Persistence, checkpointing|does not provide a mutex/u }],
  'TC-TYPESCRIPT-GATES': [{ path: 'tests/wi-0009-coverage.test.ts', pattern: /typecheck|npm test|npm run build/u }],
  'TC-DESIGN-CORRELATION': [{ path: 'scripts/validate-wi-0009-design.mjs', pattern: /verificationIds|strategyTestCaseIds|outcome: 'passed'/u }],
  'TC-FILE-ORGANIZATION': [{ path: 'tests/wi-0009-coverage.test.ts', pattern: /schemas\/prompt\/v1\/llm-prompt\.xsd|tests\/chat\.test\.ts/u }],
};

const requirementEvidence: Record<string, readonly string[]> = {
  'REQ-001': ['TC-FACTORY-CONTRACT'],
  'REQ-002': ['TC-FACTORY-CONTRACT', 'TC-USER-POLICIES'],
  'REQ-003': ['TC-TASK-MESSAGE-SEPARATION', 'TC-PROJECTION'],
  'REQ-004': ['TC-HISTORY-REPLAY', 'TC-TOOL-VALIDATION-RETRY', 'TC-PROJECTION'],
  'REQ-005': ['TC-ADDITIONAL-USER', 'TC-USER-POLICIES'],
  'REQ-006': ['TC-USER-POLICIES', 'TC-SAMPLES'],
  'REQ-007': ['TC-PROJECTION'],
  'REQ-008': ['TC-PROMPT-XSD'],
  'REQ-009': ['TC-SAMPLES'],
  'REQ-010': ['TC-DOCS-NONGOALS', 'TC-FILE-ORGANIZATION'],
  'REQ-011': ['TC-TYPESCRIPT-GATES', 'TC-DESIGN-CORRELATION', 'TC-FILE-ORGANIZATION'],
};

const invariantEvidence: Record<string, readonly string[]> = {
  'INV-001': ['TC-FACTORY-CONTRACT'],
  'INV-002': ['TC-TASK-MESSAGE-SEPARATION', 'TC-PROJECTION'],
  'INV-003': ['TC-HISTORY-REPLAY', 'TC-TOOL-VALIDATION-RETRY', 'TC-PROJECTION'],
  'INV-004': ['TC-USER-POLICIES', 'TC-SAMPLES'],
  'INV-005': ['TC-USER-POLICIES', 'TC-DOCS-NONGOALS', 'TC-FILE-ORGANIZATION'],
  'INV-006': ['TC-DOCS-NONGOALS', 'TC-TYPESCRIPT-GATES'],
};

const verificationEvidence: Record<string, readonly string[]> = {
  'VER-001': ['TC-FACTORY-CONTRACT', 'TC-FILE-ORGANIZATION'],
  'VER-002': ['TC-HISTORY-REPLAY', 'TC-PROJECTION'],
  'VER-003': ['TC-USER-POLICIES', 'TC-SAMPLES'],
  'VER-004': ['TC-PROJECTION'],
  'VER-005': ['TC-PROMPT-XSD'],
  'VER-006': ['TC-SAMPLES'],
  'VER-007': ['TC-DOCS-NONGOALS', 'TC-FILE-ORGANIZATION'],
  'VER-008': ['TC-TYPESCRIPT-GATES', 'TC-DESIGN-CORRELATION'],
  'VER-009': ['TC-USER-POLICIES', 'TC-DESIGN-CORRELATION'],
};

test('WI-0009 review coverage audit accounts for every requirement, acceptance criterion, invariant, obligation, and test case', () => {
  const declaredRequirements = ids(strategy, /^\s*- id: (REQ-\d+)$/gmu);
  const declaredInvariants = ids(strategy, /^\s*- id: (INV-\d+)$/gmu);
  const declaredTestCases = ids(strategy, /^\s*- id: (TC-[A-Z0-9-]+)$/gmu);
  const declaredObligations = ids(design, /^\s*- id: (VER-\d+)$/gmu);
  const minimumTestCases = strategy.match(/minimumRequiredTestCaseRefs:\s*\[([^\]]+)\]/u)?.[1]?.match(/TC-[A-Z0-9-]+/gu) ?? [];

  assert.equal(new Set(declaredRequirements).size, 11);
  assert.equal(new Set(declaredInvariants).size, 6);
  assert.equal(new Set(declaredTestCases).size, 13);
  assert.equal(new Set(declaredObligations).size, 9);
  assert.deepEqual(new Set(minimumTestCases), new Set(declaredTestCases));

  for (const id of declaredTestCases) assertAnchors(id, testCaseEvidence[id] ?? []);
  for (const id of declaredRequirements) {
    const cases = requirementEvidence[id];
    assert.ok(cases?.length, `${id} must map to executable test cases`);
    for (const testCase of cases) assertAnchors(`${id}/${testCase}`, testCaseEvidence[testCase]!);
  }
  for (const id of declaredInvariants) {
    const cases = invariantEvidence[id];
    assert.ok(cases?.length, `${id} must map to executable test cases`);
    for (const testCase of cases) assertAnchors(`${id}/${testCase}`, testCaseEvidence[testCase]!);
  }
  for (const id of declaredObligations) {
    const cases = verificationEvidence[id];
    assert.ok(cases?.length, `${id} must map to executable test cases`);
    for (const testCase of cases) assertAnchors(`${id}/${testCase}`, testCaseEvidence[testCase]!);
  }

  const acceptanceCriteria = workItem.requirements.items.flatMap((requirement) => requirement.acceptanceCriteria.map((criterion) => criterion.id));
  assert.equal(acceptanceCriteria.length, 23);
  assert.equal(new Set(acceptanceCriteria).size, acceptanceCriteria.length);
  for (const [index, requirement] of workItem.requirements.items.entries()) {
    const strategyRequirement = `REQ-${String(index + 1).padStart(3, '0')}`;
    assert.ok(requirementEvidence[strategyRequirement], `${requirement.id} must map to ${strategyRequirement}`);
    for (const criterion of requirement.acceptanceCriteria) {
      assert.ok(criterion.id.startsWith(`${requirement.id}_AC_`));
      const criterionEvidence = requirementEvidence[strategyRequirement];
      assert.ok(criterionEvidence.length > 0, `${criterion.id} must have executable test-case evidence`);
      for (const testCase of criterionEvidence) assertAnchors(`${criterion.id}/${testCase}`, testCaseEvidence[testCase]!);
    }
  }

  const docs = `${read(join(root, 'README.md'))}\n${read(join(root, 'SKILL.md'))}`;
  assert.match(docs, /callers must serialize mutations/iu);
  assert.match(docs, /Persistence, checkpointing/iu);
  assert.match(docs, /does not provide a mutex, queue/iu);
  assert.match(read(join(root, 'dist/index.d.ts')), /chatFactory/u);
  assert.match(read(join(root, 'dist/index.d.ts')), /LlmChatSession/u);
  assert.match(read(join(root, 'dist/index.d.ts')), /OpenRouterHttpProjection/u);

  const requiredPaths = [
    'src/types.ts', 'src/chat.ts', 'src/complete.ts', 'src/provider.ts', 'src/openrouter-projection.ts',
    'schemas/request/v1/request.schema.json', 'schemas/request/v1/request.schema.md', 'schemas/prompt/v1/llm-prompt.xsd',
    'tests/chat.test.ts', 'tests/provider-projection.test.ts', 'tests/prompt-xsd.test.ts', 'tests/chat-session-samples.test.ts',
    'samples/chat-conversation.mjs', 'samples/chat-interruptible-tool-round.mjs', 'samples/chat-blocked-tool-round.mjs',
  ];
  for (const path of requiredPaths) assert.equal(existsSync(join(root, path)), true, `organized path exists: ${path}`);

  for (const directory of ['src', 'samples']) {
    const source = read(join(root, directory, directory === 'src' ? 'chat.ts' : 'chat-conversation.mjs'));
    assert.doesNotMatch(source, /\b(checkpoint|compaction|persistence)\b/iu, `${directory} must not add forbidden scope`);
  }
});