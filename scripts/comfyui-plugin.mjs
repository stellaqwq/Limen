import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {comfyTemplate} from '../../../plugins/comfyui/config.mjs';
const output=resolve(process.argv[2]||'dist/comfyui.plugin.json');
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(comfyTemplate,null,2)+'\n');
console.log('Exported '+output);
