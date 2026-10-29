#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import { lstat, mkdir, readFile, readlink, realpath, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = join(repositoryRoot, 'package.json');
const sourceSkill = join(repositoryRoot, 'SKILL.md');
const sourceSchemas = join(repositoryRoot, 'schemas');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const gitCommand = process.platform === 'win32' ? 'git.exe' : 'git';

function usage() {
  console.error('Usage: scripts/install_agent_skill.mjs <skills-directory>');
  console.error('Installs dependencies, builds dist/, registers llm with npm, and links the llm skill.');
}

function isCode(error, code) {
  return error && typeof error === 'object' && 'code' in error && error.code === code;
}

async function assertFile(path, description) {
  try {
    const info = await lstat(path);
    if (!info.isFile()) throw new Error(`Required ${description} is not a regular file: ${path}`);
  } catch (error) {
    if (isCode(error, 'ENOENT')) throw new Error(`Required ${description} is missing: ${path}`);
    throw error;
  }
}

async function assertDirectory(path, description) {
  try {
    const info = await lstat(path);
    if (!info.isDirectory()) throw new Error(`Required ${description} is not a directory: ${path}`);
  } catch (error) {
    if (isCode(error, 'ENOENT')) throw new Error(`Required ${description} is missing: ${path}`);
    throw error;
  }
}

async function run(command, args, description, environment = process.env) {
  console.log(`${description}...`);
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: repositoryRoot, env: environment, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${description} failed with exit code ${code ?? 'unknown'}.`));
    });
  });
}

async function assertGitCheckout() {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(gitCommand, ['rev-parse', '--show-toplevel'], { cwd: repositoryRoot }));
  } catch (error) {
    throw new Error(`The installer must run from a Git checkout at ${repositoryRoot}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (resolve(stdout.trim()) !== repositoryRoot) throw new Error(`The Git checkout root does not match the installer repository: ${stdout.trim()}`);
}

async function ensureDirectory(path) {
  try {
    const info = await lstat(path);
    if (!info.isDirectory()) throw new Error(`Refusing to use existing non-directory path: ${path}`);
  } catch (error) {
    if (!isCode(error, 'ENOENT')) throw error;
    await mkdir(path, { recursive: true });
  }
}

async function ensureLink(source, target, description, type) {
  try {
    const info = await lstat(target);
    if (!info.isSymbolicLink()) throw new Error(`Refusing to overwrite existing ${description}: ${target}`);
    const existingSource = resolve(dirname(target), await readlink(target));
    if (existingSource !== source) throw new Error(`Refusing to replace ${description} symlink pointing to ${existingSource}: ${target}`);
    return;
  } catch (error) {
    if (!isCode(error, 'ENOENT')) throw error;
  }
  await symlink(source, target, type);
}

async function readPackage() {
  await assertFile(packagePath, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  if (typeof packageJson.name !== 'string' || !packageJson.name) throw new Error('package.json must define a package name.');
  if (!packageJson.bin || typeof packageJson.bin !== 'object') throw new Error('package.json must define a bin entry.');
  return packageJson;
}

function npmPrefix() {
  return resolve(process.env.AGENT_NPM_PREFIX ?? process.env.npm_config_prefix ?? process.env.NPM_CONFIG_PREFIX ?? join(homedir(), '.local'));
}

async function verifyNpmLink(packageJson, prefix) {
  const linkedPackage = join(prefix, 'lib', 'node_modules', packageJson.name);
  const packageInfo = await lstat(linkedPackage);
  if (!packageInfo.isSymbolicLink()) throw new Error(`npm link did not create a package symlink: ${linkedPackage}`);
  const linkedSource = resolve(dirname(linkedPackage), await readlink(linkedPackage));
  if (linkedSource !== repositoryRoot) throw new Error(`npm link points to ${linkedSource}, not ${repositoryRoot}.`);

  const binEntries = typeof packageJson.bin === 'string' ? { [packageJson.name]: packageJson.bin } : packageJson.bin;
  for (const [name, relativeSource] of Object.entries(binEntries)) {
    const commandPath = join(prefix, 'bin', name);
    const info = await lstat(commandPath);
    if (!info.isSymbolicLink()) throw new Error(`npm link did not create a terminal command symlink: ${commandPath}`);
    const commandSource = await realpath(commandPath);
    const expectedSource = resolve(repositoryRoot, relativeSource);
    if (commandSource !== expectedSource) throw new Error(`Terminal command ${commandPath} points to ${commandSource}, not ${expectedSource}.`);
  }
}

async function installPackage(packageJson) {
  const lockfile = join(repositoryRoot, 'package-lock.json');
  const hasLockfile = await lstat(lockfile).then(() => true).catch((error) => {
    if (isCode(error, 'ENOENT')) return false;
    throw error;
  });
  await run(npmCommand, [hasLockfile ? 'ci' : 'install'], hasLockfile ? 'Installing locked npm dependencies' : 'Installing npm dependencies');
  await run(npmCommand, ['run', 'build'], 'Building dist/');
  await assertDirectory(join(repositoryRoot, 'dist'), 'dist/');

  const prefix = npmPrefix();
  await run(npmCommand, ['link', '--no-save'], `Registering ${packageJson.name} with npm at ${prefix}`, { ...process.env, npm_config_prefix: prefix });
  await verifyNpmLink(packageJson, prefix);
  return prefix;
}

async function installSkill(destination) {
  await assertFile(sourceSkill, 'SKILL.md');
  await assertDirectory(sourceSchemas, 'schemas/');
  const skillDirectory = join(resolve(process.cwd(), destination), 'llm');
  await ensureDirectory(skillDirectory);
  await ensureLink(sourceSkill, join(skillDirectory, 'SKILL.md'), 'SKILL.md', 'file');
  await ensureLink(sourceSchemas, join(skillDirectory, 'schemas'), 'schemas/', 'dir');
  return skillDirectory;
}

async function main() {
  const [destination] = process.argv.slice(2);
  if (!destination || destination === '--help' || destination === '-h' || process.argv.length !== 3) {
    usage();
    process.exitCode = 2;
    return;
  }

  await assertGitCheckout();
  const packageJson = await readPackage();
  const prefix = await installPackage(packageJson);
  const skillDirectory = await installSkill(destination);
  console.log(`Installed llm agent skill in ${skillDirectory}`);
  console.log(`  SKILL.md -> ${sourceSkill}`);
  console.log(`  schemas/ -> ${sourceSchemas}`);
  console.log(`  npm prefix -> ${prefix}`);
  console.log(`  llm -> ${join(prefix, 'bin', 'llm')}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'The agent skill could not be installed.');
  process.exitCode = 1;
}