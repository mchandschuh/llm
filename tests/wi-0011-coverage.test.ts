import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = process.cwd();

function read(relativePath: string): string {
  const path = join(root, relativePath);
  assert.equal(existsSync(path), true, `WI-0011 evidence path exists: ${relativePath}`);
  return readFileSync(path, 'utf8');
}

test('WI-0011 coverage audit enumerates every strategy test case and major-release obligation', () => {
  const workItem = JSON.parse(read('.docs/work-items/WI-0011/work-item.json')) as {
    readonly requirements: { readonly items: readonly { readonly id: string; readonly acceptanceCriteria: readonly { readonly id: string }[] }[] };
  };
  const strategy = read('.docs/work-items/WI-0011/steps/WI-0011-00000000-chat-session-store-test-strategy.yaml');
  const delivery = read('.docs/work-items/WI-0011/steps/WI-0011-91000000-chat-session-store-delivery.yaml');
  const publicSource = read('src/index.ts');
  const declarations = read('dist/index.d.ts');
  const classification = JSON.parse(read('.docs/work-items/WI-0011/classification-result.json')) as { readonly classification: { readonly migrationImpact: string }; readonly workItemSha256: string };
  const testCaseIds = [...strategy.matchAll(/^      - id: (TC-[A-Z0-9-]+)$/gmu)].map((match) => match[1]!);
  const procedureCount = [...strategy.matchAll(/^        procedure:$/gmu)].length;
  const minimumSection = strategy.slice(strategy.indexOf('minimumRequiredTestCaseRefs:'), strategy.indexOf('recommendedTestCaseRefs:'));
  const minimumRefs = [...minimumSection.matchAll(/TC-[A-Z0-9-]+/gu)];

  assert.equal(new Set(testCaseIds).size, 16);
  assert.equal(procedureCount, 16);
  assert.deepEqual(new Set(minimumRefs.map((match) => match[0])), new Set(testCaseIds));
  assert.equal(workItem.requirements.items.length, 7);
  assert.equal(workItem.requirements.items.flatMap((requirement) => requirement.acceptanceCriteria).length, 14);
  for (const requirement of workItem.requirements.items) {
    assert.match(strategy, new RegExp(`\\b${requirement.id}\\b`, 'u'));
    for (const criterion of requirement.acceptanceCriteria) assert.match(JSON.stringify(workItem), new RegExp(criterion.id, 'u'));
  }
  assert.match(strategy, /OBJ-CONTRACT/u);
  assert.match(strategy, /OBJ-CONFIG/u);
  assert.match(strategy, /OBJ-SECURITY/u);
  assert.match(strategy, /OBJ-COMPATIBILITY/u);
  assert.match(strategy, /OBJ-ENCAPSULATION/u);
  assert.match(strategy, /OBJ-RELEASE/u);
  assert.match(delivery, /deliveryTypes:/u);
  assert.match(delivery, /major-version|major version 1\.0\.0/u);
  assert.equal(classification.classification.migrationImpact, 'present');
  assert.match(read('.docs/work-items/WI-0011/README.md'), /major release|version 1\.0\.0/u);
  assert.match(publicSource, /ChatSessionStoreFactory/u);
  assert.doesNotMatch(publicSource, /loadChatSession|saveChatSession/u);
  assert.doesNotMatch(declarations, /loadChatSession|saveChatSession/u);
  assert.doesNotMatch(read('.docs/work-items/WI-0011/README.md'), /design task.*required/u);
});