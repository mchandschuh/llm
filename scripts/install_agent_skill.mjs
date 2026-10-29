#!/usr/bin/env node

import { lstat, mkdir, readlink, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceSkill = join(repositoryRoot, 'SKILL.md');
const sourceSchemas = join(repositoryRoot, 'schemas');

function usage() {
  console.error('Usage: scripts/install_agent_skill.mjs <skills-directory>');
  console.error('Creates <skills-directory>/llm with links to this repository\'s SKILL.md and schemas/.');
}

async function assertSource(path, description) {
  try {
    const info = await lstat(path);
    if (description === 'SKILL.md' && !info.isFile()) throw new Error(`${path} is not a regular file.`);
    if (description === 'schemas/' && !info.isDirectory()) throw new Error(`${path} is not a directory.`);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`Required source ${description} is missing: ${path}`);
    }
    throw error;
  }
}

async function ensureLink(source, target, description, type) {
  try {
    const info = await lstat(target);
    if (!info.isSymbolicLink()) {
      throw new Error(`Refusing to overwrite existing ${description}: ${target}`);
    }
    const existingSource = resolve(dirname(target), await readlink(target));
    if (existingSource !== source) {
      throw new Error(`Refusing to replace ${description} symlink pointing to ${existingSource}: ${target}`);
    }
    return;
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  await symlink(source, target, type);
}

async function ensureDirectory(path) {
  try {
    const info = await lstat(path);
    if (!info.isDirectory()) throw new Error(`Refusing to use existing non-directory skill path: ${path}`);
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    await mkdir(path, { recursive: true });
  }
}

async function main() {
  const [destination] = process.argv.slice(2);
  if (!destination || destination === '--help' || destination === '-h' || process.argv.length !== 3) {
    usage();
    process.exitCode = 2;
    return;
  }

  await assertSource(sourceSkill, 'SKILL.md');
  await assertSource(sourceSchemas, 'schemas/');

  const skillDirectory = join(resolve(process.cwd(), destination), 'llm');
  await ensureDirectory(skillDirectory);
  await ensureLink(sourceSkill, join(skillDirectory, 'SKILL.md'), 'SKILL.md', 'file');
  await ensureLink(sourceSchemas, join(skillDirectory, 'schemas'), 'schemas/', 'dir');

  console.log(`Installed llm agent skill in ${skillDirectory}`);
  console.log(`  SKILL.md -> ${sourceSkill}`);
  console.log(`  schemas/ -> ${sourceSchemas}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'The agent skill could not be installed.');
  process.exitCode = 1;
}
