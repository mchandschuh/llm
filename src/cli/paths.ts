import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
export const packageRoot = resolve(sourceDirectory, '../..');
export const packagePath = resolve(packageRoot, 'package.json');
export const requestSchemaPath = resolve(packageRoot, 'schemas/request/v1/request.schema.json');
export const responseSchemaPath = resolve(packageRoot, 'schemas/response/v1/response.schema.json');