import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const packageJson = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8')
);

const versionFile = path.join(rootDir, 'src', 'lib', 'version.ts');
const content = `// 此文件由 scripts/inject-version.js 在构建时自动生成，请勿手动编辑
export const VERSION = '${packageJson.version}';
`;

fs.writeFileSync(versionFile, content, 'utf-8');
console.log(`✅ Injected version: ${packageJson.version}`);
