import {packager} from '@electron/packager';
import {exportSource} from './source-package.mjs';
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createWindowsZip} from './windows-zip.mjs';
import {bundleDesktopQQ} from './desktop-qq-runtime.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
if(process.platform!=='win32'||process.arch!=='x64'||Number(process.versions.node.split('.')[0])<24)throw Error('请在 Windows x64、Node.js 24+ 下打包。');
const args=process.argv.slice(2),qqRuntime=args.find(value=>value.startsWith('--qq-runtime='))?.slice('--qq-runtime='.length);
if(args.some(value=>value.startsWith('--')&&!value.startsWith('--qq-runtime=')))throw Error('未知打包参数。使用 --qq-runtime=官方运行时目录 包含 QQ 内核。');
const output=resolve(args.find(value=>!value.startsWith('--'))||join(root,'dist','desktop-'+Date.now()));
await mkdir(output);const source=join(output,'Limen-source'),stage=join(output,'stage');
console.log('导出干净源码…');await exportSource(root,source);
await cp(source,stage,{recursive:true,errorOnExist:true,force:false});
const pkg=JSON.parse(await readFile(join(stage,'package.json'),'utf8'));
pkg.main='desktop/main.mjs';await writeFile(join(stage,'package.json'),JSON.stringify(pkg,null,2)+'\n');
console.log('安装生产依赖…');
await new Promise((ok,fail)=>{const child=spawn(process.execPath,[join(process.execPath,'..','node_modules','npm','bin','npm-cli.js'),'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:stage,windowsHide:true,stdio:'inherit'});child.once('error',fail);child.once('exit',code=>code===0?ok():fail(Error('npm ci failed: '+code)));});
await mkdir(join(stage,'runtime','desktop'),{recursive:true});await cp(process.execPath,join(stage,'runtime','desktop','node.exe'));
// Node distributions installed by MSI may omit LICENSE; retain a verified upstream copy.
const license=await fetch('https://raw.githubusercontent.com/nodejs/node/v'+process.versions.node+'/LICENSE');if(!license.ok)throw Error('无法取得 Node.js 许可证');
await writeFile(join(stage,'runtime','desktop','LICENSE-Node.txt'),await license.text());
console.log('打包 Windows 桌面程序…');
const apps=await packager({dir:stage,out:output,name:'Limen',executableName:'Limen',platform:'win32',arch:'x64',electronVersion:pkg.devDependencies.electron,asar:false,prune:false,overwrite:false,icon:join(root,'desktop','assets','icon.ico'),appVersion:pkg.version,win32metadata:{CompanyName:'Limen',FileDescription:'Limen 本机工作台',ProductName:'Limen'}});
let qq;
if(qqRuntime){console.log('校验并打包官方 QQ 内核…');qq=await bundleDesktopQQ(resolve(qqRuntime),join(apps[0],'resources','qq-runtime'));}
await cp(join(root,'docs','desktop.md'),join(apps[0],'使用说明.md'));
console.log('生成应用与源码 ZIP…');
const artifacts=[[qq?'Limen-Windows-x64-with-QQ.zip':'Limen-Windows-x64-portable.zip',apps[0]],['Limen-source.zip',source]];
const manifest=[];
for(const [name,directory] of artifacts){const target=join(output,name);await createWindowsZip(directory,target);const hash=createHash('sha256');let size=0;for await(const bytes of createReadStream(target)){hash.update(bytes);size+=bytes.length;}manifest.push({name,bytes:size,sha256:hash.digest('hex')});}
await writeFile(join(output,'ARTIFACTS.json'),JSON.stringify({version:pkg.version,node:process.versions.node,electron:pkg.devDependencies.electron,...(qq?{qqRuntime:qq}:{}),files:manifest},null,2)+'\n');
console.log(JSON.stringify({output,app:apps[0],artifacts:manifest},null,2));
