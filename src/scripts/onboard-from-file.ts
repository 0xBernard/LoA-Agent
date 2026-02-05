import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

async function copyOnboardingDoc(protocol: string, sourceFile: string): Promise<string> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const targetDir = path.resolve(__dirname, '../../.gemini/protocols', protocol);
  const targetFile = path.join(targetDir, 'ONBOARDING.md');

  await fs.mkdir(targetDir, { recursive: true });
  await fs.copyFile(sourceFile, targetFile);
  return targetFile;
}

async function main(): Promise<void> {
  const protocol = getArg('protocol');
  const filePath = getArg('file');

  if (!protocol || !filePath) {
    console.error('Usage: npm run agent:onboard-file -- --protocol=<slug> --file=<path>');
    process.exit(1);
  }

  const resolvedFile = path.resolve(filePath);
  await fs.access(resolvedFile);

  const targetFile = await copyOnboardingDoc(protocol, resolvedFile);
  console.log(`Saved onboarding notes to ${targetFile}`);

  const command = `npm run tool:onboard -- ${protocol} "${resolvedFile}"`;
  await execAsync(command);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
