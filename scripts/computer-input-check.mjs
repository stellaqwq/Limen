import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { windowsDesktop } from '../src/computer/windows.mjs';
import { powershell } from '../src/computer/process.mjs';

// A disposable, visibly labelled fixture. Never type into a pre-existing app.
const root = resolve('dist/computer-input-check'); await mkdir(root,{recursive:true});
const directory = await mkdtemp(join(root,'fixture-')), statePath = join(directory,'state.json');
const fixtureScript = String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$output=[Environment]::GetEnvironmentVariable('XUQIAO_FIXTURE_STATE')
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$form=New-Object System.Windows.Forms.Form
$form.Text='Limen Agent input check - closes automatically'
$form.Size=New-Object System.Drawing.Size(640,380)
$form.StartPosition='CenterScreen'
$label=New-Object System.Windows.Forms.Label
$label.Text='Temporary input test. This window will close automatically.'
$label.Location=New-Object System.Drawing.Point(24,20);$label.AutoSize=$true
$text=New-Object System.Windows.Forms.TextBox
$text.Multiline=$true;$text.Location=New-Object System.Drawing.Point(24,55);$text.Size=New-Object System.Drawing.Size(570,190)
$button=New-Object System.Windows.Forms.Button
$button.Text='Test click';$button.Location=New-Object System.Drawing.Point(24,270);$button.Size=New-Object System.Drawing.Size(140,36)
$script:clicks=0;$script:lastKey=''
function Save-State {
  $tp=$text.PointToScreen([System.Drawing.Point]::Empty);$bp=$button.PointToScreen([System.Drawing.Point]::Empty)
  $data=@{handle=$form.Handle.ToInt64().ToString();text=$text.Text;clicks=$script:clicks;last_key=$script:lastKey;text_x=$tp.X+35;text_y=$tp.Y+25;button_x=$bp.X+50;button_y=$bp.Y+18}|ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($output,$data,(New-Object System.Text.UTF8Encoding($false)))
}
$text.Add_TextChanged({Save-State})
# Classic WinForms multiline edit controls need an explicit Select All shortcut.
# The event itself verifies that both native Ctrl and A reached this control.
$text.Add_KeyDown({param($sender,$eventArgs)
  if($eventArgs.Control -and $eventArgs.KeyCode -eq [System.Windows.Forms.Keys]::A){
    $script:lastKey='CTRL+A';$text.SelectAll();$eventArgs.Handled=$true;$eventArgs.SuppressKeyPress=$true;Save-State
  }
})
$button.Add_Click({$script:clicks++;Save-State})
$form.Add_Shown({$form.Show();$form.Activate();$null=$text.Focus();Save-State})
$timer=New-Object System.Windows.Forms.Timer;$timer.Interval=45000;$timer.Add_Tick({$form.Close()});$timer.Start()
$form.Controls.AddRange(@($label,$text,$button))
try{[System.Windows.Forms.Application]::Run($form)}finally{$timer.Dispose();$form.Dispose()}
`;
let child, original, fixture, success = false, blocked = false, stage='desktop preflight';const checks=[];
async function state() { for(let n=0;n<80;n++){try{return JSON.parse(await readFile(statePath,'utf8'));}catch{await delay(100);}}throw Error('Fixture did not start'); }
async function expect(fn) { for(let n=0;n<40;n++){if(fn(await state()))return;await delay(100);}throw Error('Native input did not reach the fixture'); }
async function act(args) {
  const current = await windowsDesktop('windows');
  if(current.foreground.handle!==fixture.handle)throw Error('Test fixture lost focus; no input submitted');
  return windowsDesktop('action',{expected_window:fixture.handle,arguments:args});
}
try {
  if(process.platform!=='win32')throw Error('Windows is required');
  original=await windowsDesktop('windows');
  child=spawn(powershell(),['-NoLogo','-NoProfile','-NonInteractive','-STA','-WindowStyle','Hidden','-EncodedCommand',Buffer.from(fixtureScript,'utf16le').toString('base64')],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,XUQIAO_FIXTURE_STATE:statePath}});
  child.stderr.on('data',()=>{});
  child.on('error',()=>{});fixture=await state();
  stage='window focus';
  await windowsDesktop('action',{arguments:{action:'focus',window:fixture.handle}});
  checks.push(stage);stage='mouse click';
  await act({action:'click',x:fixture.text_x,y:fixture.text_y});
  checks.push(stage);stage='Unicode Chinese and multiline input';
  const initial='Limen本机输入验收\n第二行 Unicode 123';
  await act({action:'type',text:initial});
  await expect(s=>s.text.replaceAll('\r\n','\n')===initial);
  checks.push(stage);stage='CTRL+A selection and replacement';
  await act({action:'key',key:'CTRL+A'});
  await expect(s=>s.last_key==='CTRL+A');
  await act({action:'type',text:'中文替换成功'});
  await expect(s=>s.text==='中文替换成功');
  checks.push(stage);stage='button click event';
  await act({action:'click',x:fixture.button_x,y:fixture.button_y});
  await expect(s=>s.clicks===1);
  checks.push(stage);const report={ok:true,real_input:true,fixture_only:true,checks,existing_apps_modified:false};
  await writeFile(join(root,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));success=true;
} catch(error) {
  blocked=error.code==='COMPUTER_DESKTOP_LOCKED';console.error(stage+': '+error.message);if(error.cause)console.error(error.cause.message);process.exitCode=1;
} finally {
  let restore=false;
  if(fixture){try{restore=(await windowsDesktop('windows')).foreground.handle===fixture.handle;}catch{}}
  if(child?.pid&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'close').catch(()=>{});child.kill();await exited;}
  if(original?.foreground?.handle){
    try {
      const current=await windowsDesktop('windows');
      // Do not override a window the user selected while the check was running.
      if(restore||current.foreground.handle===fixture?.handle||current.foreground.handle===original.foreground.handle){
        await windowsDesktop('action',{arguments:{action:'focus',window:original.foreground.handle}});
        if(original.cursor)await windowsDesktop('action',{expected_window:original.foreground.handle,arguments:{action:'move',x:original.cursor.x,y:original.cursor.y}});
      }
    }catch{}
  }
  const childPath=relative(root,resolve(directory));if(!childPath||childPath.startsWith('..')||isAbsolute(childPath))throw Error('Invalid fixture cleanup path');
  await rm(directory,{recursive:true,force:true,maxRetries:3});
  if(!success)await writeFile(join(root,'report.json'),JSON.stringify({ok:false,fixture_only:true,blocked,stage,checks,reason:blocked?'desktop_locked':'input_check_failed'})+'\n');
}
