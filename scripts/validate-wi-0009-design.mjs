import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const workItemPath = join(root, '.docs/work-items/WI-0009/work-item.json');
const designPath = join(root, '.docs/work-items/WI-0009/steps/WI-0009-00000000-chat-session-design.yaml');
const strategyPath = join(root, '.docs/work-items/WI-0009/steps/WI-0009-70000000-chat-session-test-strategy.yaml');
const implementationPaths = [
  join(root, '.docs/work-items/WI-0009/steps/WI-0009-10000000-chat-session-contract-implementation.yaml'),
  join(root, '.docs/work-items/WI-0009/steps/WI-0009-20000000-provider-projection-implementation.yaml'),
  join(root, '.docs/work-items/WI-0009/steps/WI-0009-30000000-chat-session-samples-implementation.yaml'),
];

function text(path) {
  assert.equal(existsSync(path), true, `required validation path exists: ${path}`);
  return readFileSync(path, 'utf8');
}

function ids(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

const workItem = JSON.parse(text(workItemPath));
const design = text(designPath);
const strategy = text(strategyPath);
const implementations = implementationPaths.map(text);

assert.equal(workItem.workItemId, 'WI-0009');
assert.equal(workItem.requirements.items.length, 11, 'WI-0009 must retain all 11 requirements');
assert.equal(workItem.requirements.items.flatMap((item) => item.acceptanceCriteria).length, 23, 'all acceptance criteria must remain present');
assert.match(design, /processingStatus: processing_completed/u);
assert.match(design, /status: complete/u);
assert.match(strategy, /processingStatus: processing_completed/u);
assert.match(strategy, /status: complete/u);
for (const implementation of implementations) {
  assert.match(implementation, /processingStatus: processing_completed/u);
  assert.match(implementation, /status: complete/u);
  assert.match(implementation, /status: implemented/u);
}

const verificationIds = ids(design, /^\s*- id: (VER-\d+)$/gmu);
assert.deepEqual(verificationIds, ['VER-001', 'VER-002', 'VER-003', 'VER-004', 'VER-005', 'VER-006', 'VER-007', 'VER-008', 'VER-009']);
const strategyRequirementIds = ids(strategy, /^\s*- id: (REQ-\d+)$/gmu);
const strategyInvariantIds = ids(strategy, /^\s*- id: (INV-\d+)$/gmu);
const strategyTestCaseIds = ids(strategy, /^\s*- id: (TC-[A-Z0-9-]+)$/gmu);
assert.equal(new Set(strategyRequirementIds).size, 11, 'strategy must define all requirement coverage entries');
assert.equal(new Set(strategyInvariantIds).size, 6, 'strategy must define all invariant coverage entries');
assert.equal(new Set(strategyTestCaseIds).size, 13, 'strategy must define all required test cases');
for (const id of ['TC-FACTORY-CONTRACT', 'TC-TASK-MESSAGE-SEPARATION', 'TC-HISTORY-REPLAY', 'TC-TOOL-VALIDATION-RETRY', 'TC-ADDITIONAL-USER', 'TC-USER-POLICIES', 'TC-PROJECTION', 'TC-PROMPT-XSD', 'TC-SAMPLES', 'TC-DOCS-NONGOALS', 'TC-TYPESCRIPT-GATES', 'TC-DESIGN-CORRELATION', 'TC-FILE-ORGANIZATION']) {
  assert.match(strategy, new RegExp(`minimumRequiredTestCaseRefs:.*${id}`, 'u'), `${id} must remain a minimum required test case`);
}

for (const path of [
  'src/types.ts', 'src/chat.ts', 'src/complete.ts', 'src/provider.ts', 'src/openrouter-projection.ts',
  'schemas/request/v1/request.schema.json', 'schemas/request/v1/request.schema.md',
  'schemas/prompt/v1/llm-prompt.xsd', 'tests/chat.test.ts', 'tests/provider-projection.test.ts',
  'tests/prompt-xsd.test.ts', 'tests/chat-session-samples.test.ts', 'README.md', 'SKILL.md',
]) assert.equal(existsSync(join(root, path)), true, `handoff path exists: ${path}`);

const source = ['src', 'tests', 'samples'].map((directory) => text(join(root, directory, directory === 'src' ? 'chat.ts' : directory === 'tests' ? 'chat.test.ts' : 'chat-conversation.mjs'))).join('\n');
assert.doesNotMatch(source, /\b(checkpoint|compaction|persistence)\b/iu, 'implementation/sample code must not introduce persistence scope');
assert.match(text(join(root, 'README.md')), /callers must serialize mutations/iu);
assert.match(text(join(root, 'README.md')), /Persistence, checkpointing/iu);
assert.match(text(join(root, 'SKILL.md')), /does not provide a mutex, queue/iu);

process.stdout.write(`${JSON.stringify({
  workItemId: 'WI-0009',
  requirements: workItem.requirements.items.length,
  acceptanceCriteria: workItem.requirements.items.flatMap((item) => item.acceptanceCriteria).length,
  verificationObligations: verificationIds.length,
  strategyRequirements: new Set(strategyRequirementIds).size,
  invariants: new Set(strategyInvariantIds).size,
  minimumTestCases: new Set(strategyTestCaseIds).size,
  outcome: 'passed',
})}\n`);