import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {videoTemplate} from '../../../plugins/video/config.mjs';
const output=resolve(process.argv[2]||'dist/video-analysis.plugin.json');
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(videoTemplate,null,2)+'\n');console.log('Exported '+output);
