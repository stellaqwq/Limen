import {mkdir,writeFile} from 'node:fs/promises';
import {activityTemplate} from '../../../plugins/free-activity/service.mjs';
const directory=new URL('../dist/',import.meta.url);await mkdir(directory,{recursive:true});
await writeFile(new URL('free-activity.plugin.json',directory),JSON.stringify(activityTemplate,null,2)+'\n');
console.log('dist/free-activity.plugin.json');
