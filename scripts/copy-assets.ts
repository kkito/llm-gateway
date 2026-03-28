import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Copy Pico CSS - 复制到 dist/assets 目录
const picoSrc = path.join(rootDir, 'node_modules', '@picocss', 'pico', 'css', 'pico.min.css');
const picoDst = path.join(rootDir, 'dist', 'assets', 'pico.min.css');

async function copyAssets(): Promise<void> {
  if (fs.existsSync(picoSrc)) {
    await fs.ensureDir(path.dirname(picoDst));
    await fs.copy(picoSrc, picoDst);
    console.log('Copied:', picoDst);
  } else {
    console.warn('Warning: Pico CSS not found at', picoSrc);
  }
}

copyAssets().catch(console.error);
