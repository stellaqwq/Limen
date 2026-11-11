import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { livingMemoryTemplate } from '../../../plugins/living-memory/config.mjs';

const output=resolve(process.argv[2]||'dist/living-memory.plugin.json');
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(livingMemoryTemplate,null,2)+'\n');
console.log('Exported '+output);
