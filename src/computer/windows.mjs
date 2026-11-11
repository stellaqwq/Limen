import { powershell, runProcess } from './process.mjs';

// Fixed program; all model-supplied values travel as JSON on stdin, never as code.
export const desktopScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms,System.Drawing,UIAutomationClient,UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class LimenDesktop {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSE { public int dx,dy; public uint data,flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct KEY { public ushort vk,scan; public uint flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct UNION { [FieldOffset(0)] public MOUSE mouse; [FieldOffset(0)] public KEY key; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION value; }
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder b,int n);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f,IntPtr p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint process);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h,uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern uint SendInput(uint n,INPUT[] input,int size);
  [DllImport("user32.dll",SetLastError=true)] public static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern bool GetUserObjectInformation(IntPtr handle,int index,StringBuilder data,int size,out int needed);
  public static void CheckDesktop() {
    var h=OpenInputDesktop(0,false,0x0101);if(h==IntPtr.Zero)throw new Exception("XUQIAO_DESKTOP_LOCKED");
    try{int needed;var name=new StringBuilder(256);if(!GetUserObjectInformation(h,2,name,name.Capacity*2,out needed)||name.ToString().Equals("Winlogon",StringComparison.OrdinalIgnoreCase))throw new Exception("XUQIAO_DESKTOP_LOCKED");}finally{CloseDesktop(h);}
    uint pid;GetWindowThreadProcessId(GetForegroundWindow(),out pid);
    if(pid!=0){var process=System.Diagnostics.Process.GetProcessById((int)pid);try{var name=process.ProcessName;if(name.Equals("LockApp",StringComparison.OrdinalIgnoreCase)||name.Equals("LogonUI",StringComparison.OrdinalIgnoreCase))throw new Exception("XUQIAO_DESKTOP_LOCKED");}finally{process.Dispose();}}
  }
  public static string Title(IntPtr h) { var b=new StringBuilder(512); GetWindowText(h,b,b.Capacity); return b.ToString(); }
  public static void Focus(IntPtr h) {
    ShowWindow(h,9);BringWindowToTop(h);SetForegroundWindow(h);
    // Windows may deny programmatic activation. A caption click is allowed
    // only when hit-testing proves it belongs to the requested window.
    if(GetForegroundWindow()!=h) {
      RECT r;if(!GetWindowRect(h,out r))return;
      var point=new POINT();point.X=r.Left+Math.Max(1,(r.Right-r.Left)/2);point.Y=r.Top+10;
      var hit=WindowFromPoint(point);
      if(hit!=h&&GetAncestor(hit,2)!=h)return;
      if(SetCursorPos(point.X,point.Y))Click(false,false);
    }
  }
  public static IntPtr[] Windows() { var all=new List<IntPtr>(); EnumWindows((h,p)=>{if(IsWindowVisible(h)&&Title(h).Length>0&&all.Count<80)all.Add(h);return true;},IntPtr.Zero);return all.ToArray(); }
  public static void Send(INPUT input) { if(SendInput(1,new[]{input},Marshal.SizeOf(typeof(INPUT)))!=1)throw new Exception("Input rejected (locked or elevated window)"); }
  public static void Batch(INPUT[] inputs) { if(SendInput((uint)inputs.Length,inputs,Marshal.SizeOf(typeof(INPUT)))!=inputs.Length)throw new Exception("Input rejected (locked or elevated window)"); }
  public static void Mouse(uint flags,int data=0) { var i=new INPUT(); i.type=0;i.value.mouse.flags=flags;i.value.mouse.data=unchecked((uint)data);Send(i); }
  public static void Key(ushort vk,bool up) { var i=new INPUT();i.type=1;i.value.key.vk=vk;i.value.key.flags=up?2u:0u;Send(i); }
  public static void Click(bool right,bool twice) { var down=new INPUT();down.value.mouse.flags=right?8u:2u;var up=new INPUT();up.value.mouse.flags=right?16u:4u;Batch(twice?new[]{down,up,down,up}:new[]{down,up}); }
  public static void Chord(ushort[] codes) { var inputs=new List<INPUT>();foreach(var code in codes){var i=new INPUT();i.type=1;i.value.key.vk=code;inputs.Add(i);}for(int n=codes.Length-1;n>=0;n--){var i=new INPUT();i.type=1;i.value.key.vk=codes[n];i.value.key.flags=2;inputs.Add(i);}Batch(inputs.ToArray()); }
  public static void Drag(int x,int y,int tx,int ty,int sx,int sy,int sw,int sh) { var inputs=new List<INPUT>();for(int n=0;n<=12;n++){var i=new INPUT();i.value.mouse.dx=(int)((x+(tx-x)*n/12.0-sx)*65535/Math.Max(1,sw-1));i.value.mouse.dy=(int)((y+(ty-y)*n/12.0-sy)*65535/Math.Max(1,sh-1));i.value.mouse.flags=0xE001u|(n==0?2u:0u)|(n==12?4u:0u);inputs.Add(i);}Batch(inputs.ToArray()); }
  public static void Text(string text) { var inputs=new List<INPUT>();foreach(char c in text) { if(c=='\r')continue;var i=new INPUT();i.type=1;if(c=='\n'){i.value.key.vk=13;i.value.key.flags=0;inputs.Add(i);i.value.key.flags=2;}else{i.value.key.scan=c;i.value.key.flags=4;inputs.Add(i);i.value.key.flags=6;}inputs.Add(i); }if(inputs.Count>0)Batch(inputs.ToArray()); }
}
'@
$null = [LimenDesktop]::SetProcessDPIAware()
[LimenDesktop]::CheckDesktop()
function Bounds($h) { $r=New-Object LimenDesktop+RECT; $null=[LimenDesktop]::GetWindowRect($h,[ref]$r); return @{x=$r.Left;y=$r.Top;width=($r.Right-$r.Left);height=($r.Bottom-$r.Top)} }
function Window($h) { return @{handle=$h.ToInt64().ToString();title=[LimenDesktop]::Title($h);bounds=(Bounds $h)} }
$foreground=[LimenDesktop]::GetForegroundWindow()
$screen=[System.Windows.Forms.SystemInformation]::VirtualScreen
$cursor=New-Object LimenDesktop+POINT;$null=[LimenDesktop]::GetCursorPos([ref]$cursor)
$result=@{ok=$true;foreground=(Window $foreground);cursor=@{x=$cursor.X;y=$cursor.Y};screen=@{x=$screen.X;y=$screen.Y;width=$screen.Width;height=$screen.Height}}
switch ($request.action) {
  'windows' { $result.windows=@([LimenDesktop]::Windows() | ForEach-Object { Window $_ }) }
  'screenshot' {
    $bitmap=$null;$graphics=$null;$small=$null;$scaled=$null;$stream=$null
    try {
      $bitmap=New-Object System.Drawing.Bitmap($screen.Width,$screen.Height)
      $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
      $graphics.CopyFromScreen($screen.X,$screen.Y,0,0,$screen.Size)
      $ratio=[Math]::Min([double]1,[double](1280.0/$screen.Width))
      $w=[Math]::Max(1,[int]($screen.Width*$ratio));$h=[Math]::Max(1,[int]($screen.Height*$ratio))
      $small=New-Object System.Drawing.Bitmap($w,$h);$scaled=[System.Drawing.Graphics]::FromImage($small)
      $scaled.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $scaled.DrawImage($bitmap,0,0,$w,$h)
      $stream=New-Object System.IO.MemoryStream
      $small.Save($stream,[System.Drawing.Imaging.ImageFormat]::Jpeg)
      $result.image='data:image/jpeg;base64,'+[Convert]::ToBase64String($stream.ToArray())
      $result.image_width=$w;$result.image_height=$h
    } finally { foreach($resource in @($scaled,$graphics,$small,$bitmap,$stream)) { if($null -ne $resource){$resource.Dispose()} } }
  }
  'inspect' {
    $root=[System.Windows.Automation.AutomationElement]::FromHandle($foreground)
    $walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker
    $items=New-Object System.Collections.Generic.List[object]
    function Visit($node,$depth) {
      if($null -eq $node -or $depth -gt 5 -or $items.Count -ge 100){return}
      try {
        $c=$node.Current;$r=$c.BoundingRectangle
        if(!$c.IsOffscreen -and !$c.IsPassword) {
          $items.Add(@{name=([string]$c.Name).Substring(0,[Math]::Min(160,([string]$c.Name).Length));type=$c.ControlType.ProgrammaticName;enabled=$c.IsEnabled;x=[int]$r.X;y=[int]$r.Y;width=[int]$r.Width;height=[int]$r.Height})
        }
        $child=$walker.GetFirstChild($node)
        while($null -ne $child -and $items.Count -lt 100){ Visit $child ($depth+1);$child=$walker.GetNextSibling($child) }
      } catch { }
    }
    Visit $root 0;$result.controls=@($items.ToArray())
  }
  'action' {
    $a=$request.arguments
    if($a.action -eq 'focus') {
      $h=[IntPtr]([long]$a.window)
      if(![LimenDesktop]::IsWindow($h) -or ![LimenDesktop]::IsWindowVisible($h)){throw 'Window no longer exists'}
      [LimenDesktop]::Focus($h)
      Start-Sleep -Milliseconds 150
      if([LimenDesktop]::GetForegroundWindow() -ne $h){throw 'Could not focus window'}
    } else {
      if($foreground.ToInt64().ToString() -ne [string]$request.expected_window){throw 'Foreground window changed; observe again'}
      switch ($a.action) {
        {$_ -in 'click','double_click','right_click','move','drag'} {
          if(![LimenDesktop]::SetCursorPos([int]$a.x,[int]$a.y)){throw 'Cursor movement rejected'}
          if($a.action -eq 'drag') {
            [LimenDesktop]::Drag([int]$a.x,[int]$a.y,[int]$a.to_x,[int]$a.to_y,$screen.X,$screen.Y,$screen.Width,$screen.Height)
          } elseif($a.action -ne 'move') {
            [LimenDesktop]::Click(($a.action -eq 'right_click'),($a.action -eq 'double_click'))
          }
        }
        'scroll' { if(![LimenDesktop]::SetCursorPos([int]$a.x,[int]$a.y)){throw 'Cursor movement rejected'};[LimenDesktop]::Mouse(0x0800,([int]$a.amount*120)) }
        'type' { [LimenDesktop]::Text([string]$a.text) }
        'key' {
          $map=@{CTRL=17;ALT=18;SHIFT=16;WIN=91;ENTER=13;TAB=9;ESC=27;BACKSPACE=8;DELETE=46;SPACE=32;UP=38;DOWN=40;LEFT=37;RIGHT=39;HOME=36;END=35;PAGEUP=33;PAGEDOWN=34;F1=112;F2=113;F3=114;F4=115;F5=116;F6=117;F7=118;F8=119;F9=120;F10=121;F11=122;F12=123}
          $codes=New-Object System.Collections.Generic.List[System.UInt16]
          foreach($part in ([string]$a.key).ToUpperInvariant().Split('+')) { $vk=$map[$part];if($null -eq $vk){$vk=[int][char]$part};$codes.Add([System.UInt16]$vk) }
          [LimenDesktop]::Chord($codes.ToArray())
        }
        'wait' { Start-Sleep -Milliseconds ([int]$a.milliseconds) }
        default { throw 'Unsupported action' }
      }
    }
    $result.foreground=Window ([LimenDesktop]::GetForegroundWindow())
  }
  default { throw 'Unsupported desktop request' }
}
$result | ConvertTo-Json -Depth 12 -Compress
`;

export async function windowsDesktop(action, args = {}, signal) {
  if (process.platform !== 'win32') throw Error('桌面控制目前仅支持 Windows。');
  const result = await runProcess(powershell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(desktopScript, 'utf16le').toString('base64')], {
    input: JSON.stringify({ action, ...args }), signal, timeout: 15000
  });
  if (result.code !== 0) {
    if(result.stderr.includes('XUQIAO_DESKTOP_LOCKED'))throw Object.assign(Error('电脑已锁屏或处于安全桌面，请解锁后重新发起任务。'),{status:409,code:'COMPUTER_DESKTOP_LOCKED'});
    throw Error('Windows 桌面操作失败：请检查窗口是否变化，或目标程序是否以管理员身份运行。',{cause:Error(result.stderr)});
  }
  return JSON.parse(result.stdout);
}
