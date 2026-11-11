import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {emotionTemplate} from '../../../plugins/emotion/config.mjs';

const output=resolve(process.argv[2]||'dist/psychodynamic-emotion.plugin.json');
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(emotionTemplate,null,2)+'\n');
console.log('Exported '+output);
