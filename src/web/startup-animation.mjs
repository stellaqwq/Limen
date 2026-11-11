const esc = value => String(value).replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const PRESET_LABELS = { orbit: '轨道', pulse: '涟漪', stars: '星屑', curtain: '幕启' };
const THEME_LABELS = { ink: '墨黑', paper: '纸白', aurora: '极光' };
const EXIT_LABELS = { fade: '淡出', rise: '上升', zoom: '推近' };
const SOURCE_LABELS = { preset: '内置动画', video: '我的视频' };
const FIT_LABELS = { cover: '铺满窗口', contain: '完整显示' };

// A logo replaces the built-in chat mark; both nodes ship together so the
// management preview can switch between them without another request.
function markMarkup(logo) {
  return `<img class="sa-logo" src="${logo ? esc(logo.url) : ''}" alt=""${logo ? '' : ' hidden'}>` +
    `<svg class="sa-glyph" viewBox="0 0 24 24" aria-hidden="true"${logo ? ' hidden' : ''}>` +
    `<path d="M7.6 5.5h8.8A3.6 3.6 0 0 1 20 9.1v4.8a3.6 3.6 0 0 1-3.6 3.6h-4.9L6.5 21v-3.6A3.6 3.6 0 0 1 4 13.9V9.1a3.6 3.6 0 0 1 3.6-3.6Z"/>` +
    `<path d="M8.8 11.6h6.4" opacity=".55"/></svg>`;
}

/** Video layers sit above the CSS decoration but below the optional title copy. */
function videoMarkup(value, useVideo) {
  if (!useVideo) return '';
  return `<video class="sa-video" src="${esc(value.video.url)}" muted playsinline preload="auto"${value.video_loop ? ' loop' : ''} disablepictureinpicture aria-hidden="true"></video>` +
    '<div class="sa-video-veil"></div><div class="sa-video-curtain"></div>';
}

/**
 * Shared by the workspace overlay and the Electron launch page. The CSS
 * composition is visible from the first frame; the video only cross-fades in
 * once Chromium actually has a decoded frame, so a slow decode never produces
 * a black flash. Any failure falls straight back to the built-in animation.
 */
export const startupVideoLogic = String.raw`
(function(){
var el=document.getElementById('sa-overlay');
if(!el||el.getAttribute('data-video')!=='1')return;
var video=el.querySelector('.sa-video');if(!video)return;
var settled=false,watch=0;
function fallback(){
  if(settled)return;settled=true;clearTimeout(watch);
  try{video.pause();video.removeAttribute('src');video.load();}catch(e){}
  el.classList.remove('sa-video-ready');el.classList.add('sa-video-fallback');
}
function reveal(){
  if(settled)return;
  var playing;
  try{playing=video.play();}catch(e){fallback();return;}
  Promise.resolve(playing).then(function(){
    if(settled)return;
    function show(){
      if(settled)return;settled=true;clearTimeout(watch);
      requestAnimationFrame(function(){el.classList.add('sa-video-ready');});
    }
    if(video.requestVideoFrameCallback){try{video.requestVideoFrameCallback(show);return;}catch(e){}}
    show();
  }).catch(fallback);
}
if(video.readyState>=2)reveal();
else video.addEventListener('loadeddata',reveal,{once:true});
video.addEventListener('error',fallback);
watch=setTimeout(function(){if(!settled)fallback();},6000);
video.addEventListener('ended',function(){
  try{if(video.duration)video.currentTime=Math.max(0,video.duration-0.04);video.pause();}catch(e){}
});
})();
`;

function overlayMarkup(value, withId) {
  const title = value.title ? `<h1 class="sa-title">${esc(value.title)}</h1>` : '';
  const subtitle = value.subtitle ? `<p class="sa-sub">${esc(value.subtitle)}</p>` : '';
  const meter = value.show_progress ? '<div class="sa-meter"><i></i></div>' : '';
  const caption = value.caption ? `<p class="sa-caption">${esc(value.caption)}</p>` : '';
  // The hand-off frame deliberately carries no video: the desktop window has
  // already played it and a second <video> would restart the intro.
  const useVideo = !!(value.source === 'video' && value.video && !value.handoff);
  return `<div class="sa"${withId ? ' id="sa-overlay"' : ''} role="presentation" aria-hidden="true" data-preset="${esc(value.preset)}" data-theme="${esc(value.theme)}" data-exit="${esc(value.exit)}" data-once="${value.once_per_session ? '1' : '0'}" data-skip="${value.skippable ? '1' : '0'}" data-handoff="${value.handoff ? '1' : '0'}" data-instant="${value.instant ? '1' : '0'}" data-video="${useVideo ? '1' : '0'}" data-video-fit="${esc(value.video_fit || 'cover')}" data-video-overlay="${value.video_overlay === false ? '0' : '1'}" data-video-loop="${value.video_loop === false ? '0' : '1'}" data-key="${esc('xuqiao-startup:' + value.signature)}" data-min="${value.min_ms}" data-max="12000">` +
    '<div class="sa-bg"></div><div class="sa-blobs"><i></i><i></i><i></i></div><div class="sa-grid"></div><div class="sa-stars"></div>' +
    '<div class="sa-curtain"><i></i><i></i></div>' +
    videoMarkup(value, useVideo) +
    '<div class="sa-center"><div class="sa-core"><div class="sa-ripples"><i></i><i></i><i></i></div>' +
    '<div class="sa-orbit"><i><b></b></i><i><b></b></i><i></i></div>' +
    `<div class="sa-mark">${markMarkup(value.logo)}</div></div>` +
    `<div class="sa-copy">${title}${subtitle}${meter}${caption}</div></div>` +
    (value.skippable ? '<p class="sa-skip">点击任意处跳过</p>' : '') +
    '</div>';
}

/** The overlay is rendered by the server so it is on screen at the first paint. */
export function startupOverlay(value) {
  if (!value || !value.enabled) return '';
  return overlayMarkup(value, true);
}

/** Hidden copy of the overlay markup, cloned by the management preview. */
export function startupTemplate(value) {
  const fallback = value || {
    preset: 'orbit', theme: 'ink', exit: 'fade', once_per_session: false, skippable: true,
    show_progress: true, title: 'Limen', subtitle: '信号与回应之间', caption: '正在启动本机工作台',
    min_ms: 1800, signature: 'preview', logo: null, video: null, source: 'preset',
    video_fit: 'cover', video_loop: true, video_overlay: true
  };
  // The preview always animates; the hand-off flag belongs to the boot page only.
  // Its video layer is inserted by the panel script so a cloned <template>
  // never carries a second media element into the first paint.
  return `<template id="sa-template">${overlayMarkup({ ...fallback, handoff: false, source: 'preset', video: null }, false)}</template>`;
}

// Runs immediately after the overlay markup: it decides whether the animation
// should be skipped for this session and guarantees the overlay never traps the
// workbench if the main client fails to boot.
export function startupBoot(value, nonce) {
  if (!value || !value.enabled) return '';
  return `<script nonce="${nonce}">(function(){
var el=document.getElementById('sa-overlay');if(!el)return;
var handoff=el.getAttribute('data-handoff')==='1';
var once=!handoff&&el.getAttribute('data-once')==='1',key=el.getAttribute('data-key')||'';
var min=Number(el.getAttribute('data-min'))||1800,max=Number(el.getAttribute('data-max'))||12000;
var started=performance.now(),done=false,timer=0;
var isVideo=el.getAttribute('data-video')==='1';
if(handoff){
  document.documentElement.classList.add('sa-handoff');
  var handoffTheme=el.getAttribute('data-theme');
  document.documentElement.style.setProperty('--sa-handoff-bg',handoffTheme==='paper'?'#f6f6f9':handoffTheme==='aurora'?'#05060e':'#0a0a10');
}
if(once){try{if(sessionStorage.getItem(key)==='1'){el.remove();return;}}catch(e){}}
function hide(){
  if(done)return;done=true;if(timer)clearTimeout(timer);
  // Let the video blur, dim and dissolve behind a themed curtain before the
  // whole layer fades out; the workspace hand-off then keeps the same colour.
  if(isVideo)el.classList.add('sa-video-exit');
  el.classList.add('sa-out');
  if(once){try{sessionStorage.setItem(key,'1');}catch(e){}}
  setTimeout(function(){
    if(el.parentNode)el.remove();
    // The hand-off frame hides the console scrollbar so it does not pop in
    // while the animation dissolves.
    if(handoff)document.documentElement.classList.remove('sa-handoff');
  },isVideo?720:460);
}
window.__xuqiaoStartupExit=hide;
window.__xuqiaoStartup={ready:function(){
  if(done)return;
  // The hand-off frame only has to bridge the navigation, so it dissolves as
  // soon as the workbench reports its first state.
  var wait=handoff?120:Math.max(0,min-(performance.now()-started));
  timer=setTimeout(hide,wait);
}};
timer=setTimeout(hide,handoff?1500:max);
function fallbackLogo(){
  var img=el.querySelector('.sa-logo'),glyph=el.querySelector('.sa-glyph');
  if(!img||!glyph)return;
  img.addEventListener('error',function(){img.setAttribute('hidden','');glyph.removeAttribute('hidden');});
}
if(el.getAttribute('data-skip')==='1'){
  var skip=function(event){if(event&&event.type==='keydown'&&event.key!=='Escape'&&event.key!=='Enter'&&event.key!==' ')return;hide();};
  el.addEventListener('pointerup',skip);
  document.addEventListener('keydown',skip);
}
fallbackLogo();
})();` + startupVideoLogic + `<\/script>`;
}

/**
 * The Electron window shows this page while the backend boots, so the animation
 * covers the native "正在启动本机工作台…" placeholder instead of following it.
 * It has no auto-dismiss: the main process calls `__xuqiaoBootExit()` before it
 * navigates to the workspace. The logo is served by the temporary local server.
 */
export function renderLaunchPage(value) {
  const boot = { ...value, enabled: true, skippable: false, once_per_session: false, instant: true, logo: value?.logo || null };
  // The page behind the overlay shares the theme, so the hand-off never shows
  // a light frame behind a dark animation.
  const pageBackground = boot.theme === 'paper' ? '#f6f6f9' : boot.theme === 'aurora' ? '#05060e' : '#0a0a10';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">` +
    '<title>Limen</title><style>:root{--font:\'Segoe UI Variable Text\',\'Segoe UI\',\'PingFang SC\',\'Microsoft YaHei\',system-ui,sans-serif}' +
    `html,body{margin:0;height:100%;overflow:hidden;background:${pageBackground}}` +
    startupStyles + startupAccentCss(boot) +
    '.sa{position:fixed;inset:0;cursor:default;-webkit-user-select:none;user-select:none}</style></head><body>' +
    overlayMarkup(boot, true) +
    '<script>(function(){' +
    'window.__xuqiaoBootExit=function(fast){var el=document.getElementById("sa-overlay");if(!el)return false;' +
    'el.classList.add("sa-hold");if(fast)el.classList.add("sa-out-fast");' +
    'if(el.getAttribute("data-video")==="1")el.classList.add("sa-video-exit");' +
    'el.classList.add("sa-out");return true;};' +
    'var img=document.querySelector("#sa-overlay .sa-logo"),glyph=document.querySelector("#sa-overlay .sa-glyph");' +
    'if(img&&glyph)img.addEventListener("error",function(){img.setAttribute("hidden","");glyph.removeAttribute("hidden");});' +
    '})();' + startupVideoLogic + '<\/script></body></html>';
}


/** Accent colour has to reach the first paint, so it is emitted in the nonced stylesheet. */
export function startupAccentCss(value) {
  if (!value || !value.enabled || !/^#[0-9a-f]{6}$/i.test(value.accent || '')) return '';
  const hex = value.accent.slice(1);
  const [r, g, b] = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16));
  return `#sa-overlay{--sa-accent:${value.accent};--sa-glow:rgba(${r},${g},${b},.17)}` +
    (value.min_ms ? `#sa-overlay .sa-meter i{animation-duration:${value.min_ms}ms}` : '');
}

export const startupStyles = String.raw`
.sa [hidden]{display:none!important}
.sa{--sa-accent:#8b7cf6;position:fixed;inset:0;z-index:900;display:grid;place-items:center;overflow:hidden;background:var(--sa-bg,#0a0a10);color:var(--sa-fg,#f5f5fa);font:16px/1.6 var(--font);-webkit-font-smoothing:antialiased;transition:opacity .5s ease,transform .6s cubic-bezier(.4,0,.2,1)}
.sa[data-theme=ink]{--sa-bg:#0a0a10;--sa-fg:#f5f5fa;--sa-muted:#9395a8;--sa-panel:#12121b;--sa-line:rgba(255,255,255,.13);--sa-fill:rgba(255,255,255,.055);--sa-shadow:rgba(0,0,0,.42)}
.sa[data-theme=paper]{--sa-bg:#f6f6f9;--sa-fg:#24252f;--sa-muted:#74768a;--sa-panel:#fff;--sa-line:rgba(24,24,46,.1);--sa-fill:rgba(255,255,255,.86);--sa-shadow:rgba(38,36,64,.14)}
.sa[data-theme=aurora]{--sa-bg:#05060e;--sa-fg:#f4f6ff;--sa-muted:#a4a8c8;--sa-panel:#0e1023;--sa-line:rgba(255,255,255,.14);--sa-fill:rgba(255,255,255,.06);--sa-shadow:rgba(0,0,0,.44)}
.sa-bg{position:absolute;inset:-12%;background:radial-gradient(58% 52% at 50% 44%,var(--sa-glow,rgba(139,124,246,.16)) 0%,transparent 72%)}
.sa[data-theme=aurora] .sa-bg{background:radial-gradient(60% 50% at 32% 30%,rgba(139,124,246,.3) 0%,transparent 70%),radial-gradient(55% 46% at 72% 64%,rgba(56,208,216,.22) 0%,transparent 72%),radial-gradient(58% 46% at 50% 102%,rgba(255,138,201,.2) 0%,transparent 70%);filter:blur(1.4em);animation:sa-aurora 16s ease-in-out infinite alternate}
.sa-blobs{position:absolute;inset:0;overflow:hidden}
.sa-blobs i{position:absolute;display:block;border-radius:50%;background:var(--sa-accent);filter:blur(5.5em);opacity:.19;animation:sa-drift 18s ease-in-out infinite alternate}
.sa-blobs i:nth-child(1){width:22em;height:22em;left:16%;top:12%}
.sa-blobs i:nth-child(2){width:17em;height:17em;right:14%;top:34%;opacity:.14;animation-duration:24s;animation-direction:alternate-reverse}
.sa-blobs i:nth-child(3){width:26em;height:26em;left:38%;bottom:-14%;opacity:.1;animation-duration:30s}
.sa[data-theme=paper] .sa-blobs i{opacity:.07}
.sa[data-theme=paper] .sa-blobs i:nth-child(2){opacity:.05}
.sa[data-theme=aurora] .sa-blobs i{opacity:.34}
.sa[data-theme=aurora] .sa-blobs i:nth-child(2){opacity:.26}
.sa[data-theme=aurora] .sa-blobs i:nth-child(3){opacity:.2}
.sa-grid{position:absolute;inset:0;color:var(--sa-fg);opacity:.08;background-image:radial-gradient(currentColor 1px,transparent 1px);background-size:2.1em 2.1em;-webkit-mask-image:radial-gradient(ellipse 70% 62% at 50% 46%,#000 0%,transparent 78%);mask-image:radial-gradient(ellipse 70% 62% at 50% 46%,#000 0%,transparent 78%)}
.sa[data-theme=paper] .sa-grid{opacity:.16}
.sa-stars{position:absolute;inset:-8%;opacity:0;background-image:radial-gradient(1.4px 1.4px at 18% 24%,#fff,transparent),radial-gradient(1.2px 1.2px at 62% 12%,#fff,transparent),radial-gradient(1.6px 1.6px at 84% 46%,#fff,transparent),radial-gradient(1.1px 1.1px at 36% 68%,#fff,transparent),radial-gradient(1.3px 1.3px at 72% 82%,#fff,transparent),radial-gradient(1px 1px at 8% 56%,#fff,transparent);background-size:220px 220px;animation:sa-stars 26s linear infinite}
.sa-stars::after{content:'';position:absolute;inset:0;background-image:radial-gradient(1px 1px at 44% 18%,rgba(255,255,255,.9),transparent),radial-gradient(1px 1px at 12% 78%,rgba(255,255,255,.8),transparent),radial-gradient(1.2px 1.2px at 90% 64%,rgba(255,255,255,.75),transparent),radial-gradient(1px 1px at 66% 40%,rgba(255,255,255,.7),transparent);background-size:150px 150px;animation:sa-stars 18s linear infinite reverse;opacity:.7}
.sa[data-preset=stars] .sa-stars{opacity:.55}
.sa[data-theme=paper] .sa-stars{opacity:0}
.sa-curtain{position:absolute;inset:0;display:none;grid-template-columns:1fr 1fr;pointer-events:none}
.sa[data-preset=curtain] .sa-curtain{display:grid}
.sa-curtain::before{content:'';position:absolute;left:50%;top:50%;width:30em;height:30em;margin:-15em 0 0 -15em;background:radial-gradient(circle,var(--sa-accent) 0%,transparent 66%);opacity:.22;filter:blur(2.4em)}
.sa-curtain i{position:relative;display:block;background:linear-gradient(180deg,#1c1c26,#0c0c13 72%);box-shadow:inset 0 0 0 1px var(--sa-line),inset -3em 0 4em -3em rgba(0,0,0,.5)}
.sa-curtain i:last-child{box-shadow:inset 0 0 0 1px var(--sa-line),inset 3em 0 4em -3em rgba(0,0,0,.5)}
.sa[data-theme=paper] .sa-curtain i{box-shadow:inset 0 0 0 1px var(--sa-line),inset -3em 0 4em -3em rgba(60,60,90,.13)}
.sa[data-theme=paper] .sa-curtain i:last-child{box-shadow:inset 0 0 0 1px var(--sa-line),inset 3em 0 4em -3em rgba(60,60,90,.13)}
.sa[data-theme=paper] .sa-curtain i{background:linear-gradient(180deg,#fff,#ececf3 76%)}
.sa[data-theme=aurora] .sa-curtain i{background:linear-gradient(180deg,#141530,#070812 72%)}
.sa-curtain i:first-child{animation:sa-curtain-left .92s cubic-bezier(.5,0,.15,1) .05s both}
.sa-curtain i:last-child{animation:sa-curtain-right .92s cubic-bezier(.5,0,.15,1) .05s both}
.sa-center{position:relative;z-index:2;display:grid;justify-items:center;gap:2.1em;padding:2em;text-align:center}
.sa-core{position:relative;display:grid;place-items:center;width:14.5em;height:14.5em}
.sa-core::before{content:'';position:absolute;width:8.4em;height:8.4em;border-radius:50%;background:var(--sa-accent);opacity:.18;filter:blur(2.6em);animation:sa-glow-in .9s ease both}
.sa-orbit{position:absolute;inset:0;display:grid;place-items:center;opacity:0;animation:sa-fade .8s ease .1s forwards}
.sa-orbit i{position:absolute;border:1px solid var(--sa-accent);border-radius:50%;opacity:.24}
.sa-orbit i:nth-child(1){width:8.6em;height:8.6em;opacity:.36;animation:sa-spin 15s linear infinite}
.sa-orbit i:nth-child(2){width:11.9em;height:11.9em;border-style:dashed;opacity:.24;animation:sa-spin 26s linear infinite reverse}
.sa-orbit i:nth-child(3){width:15.2em;height:15.2em;opacity:.13;animation:sa-spin 38s linear infinite}
.sa-orbit b{position:absolute;top:-.19em;left:50%;width:.38em;height:.38em;margin-left:-.19em;border-radius:50%;background:var(--sa-accent);box-shadow:0 0 .7em .05em var(--sa-accent)}
.sa-orbit i:nth-child(2) b{opacity:.7;width:.3em;height:.3em;margin-left:-.15em;top:-.15em}
.sa-ripples{position:absolute;inset:0;display:grid;place-items:center;opacity:0}
.sa-ripples i{position:absolute;width:6.4em;height:6.4em;border:1px solid var(--sa-accent);border-radius:50%;opacity:0}
.sa[data-preset=pulse] .sa-ripples{opacity:1}
.sa[data-preset=pulse] .sa-ripples i{animation:sa-ripple 3.6s cubic-bezier(.2,.6,.25,1) infinite}
.sa[data-preset=pulse] .sa-ripples i:nth-child(2){animation-delay:1.2s}
.sa[data-preset=pulse] .sa-ripples i:nth-child(3){animation-delay:2.4s}
.sa[data-preset=pulse] .sa-orbit{display:none}
.sa[data-preset=curtain] .sa-orbit i:nth-child(3){opacity:.05}
.sa-mark{position:relative;z-index:2;display:grid;place-items:center;width:6.1em;height:6.1em;border-radius:1.8em;overflow:hidden;background:linear-gradient(155deg,var(--sa-fill),transparent 82%);border:1px solid var(--sa-line);box-shadow:0 1.4em 3.2em var(--sa-shadow),inset 0 1px 0 rgba(255,255,255,.14);backdrop-filter:blur(8px);animation:sa-mark-in .8s cubic-bezier(.2,.8,.2,1) both}
.sa-mark::after{content:'';position:absolute;inset:0;background:linear-gradient(118deg,transparent 32%,rgba(255,255,255,.3) 48%,transparent 64%);transform:translateX(-130%);animation:sa-sheen 4.2s ease-in-out 1.4s infinite}
.sa-glyph{width:2.8em;height:2.8em;fill:none;stroke:var(--sa-fg);stroke-width:1.35;stroke-linecap:round;stroke-linejoin:round;animation:sa-glyph-in .85s ease .12s both}
.sa-logo{max-width:66%;max-height:66%;object-fit:contain;border-radius:.5em;animation:sa-glyph-in .85s ease .12s both}
.sa-copy{display:grid;justify-items:center;max-width:min(90vw,44em)}
.sa-title{margin:0;font-size:2.5em;font-weight:600;letter-spacing:.22em;text-indent:.22em;line-height:1.25;color:var(--sa-fg);overflow-wrap:anywhere;animation:sa-title-in .85s cubic-bezier(.2,.8,.2,1) .12s both}
.sa-sub{margin:.95em 0 0;font-size:.84em;letter-spacing:.3em;text-indent:.3em;color:var(--sa-muted);animation:sa-fade-up .7s ease .34s both}
.sa-meter{width:10em;height:2px;margin-top:2.3em;border-radius:2px;background:var(--sa-line);overflow:hidden;animation:sa-fade .6s ease .55s both}
.sa-meter i{display:block;width:100%;height:100%;transform:scaleX(0);transform-origin:left center;background:linear-gradient(90deg,transparent,var(--sa-accent) 14%,var(--sa-accent) 86%,transparent);filter:drop-shadow(0 0 .5em var(--sa-accent));animation:sa-fill 1.8s cubic-bezier(.2,.62,.2,1) forwards}
.sa-caption{margin:.95em 0 0;font-size:.72em;letter-spacing:.18em;text-indent:.18em;color:var(--sa-muted);animation:sa-fade .6s ease .62s both}
.sa-skip{position:absolute;right:2.2em;bottom:1.8em;margin:0;font-size:.7em;letter-spacing:.16em;color:var(--sa-muted);opacity:0;animation:sa-fade .7s ease .9s forwards}
html.sa-handoff{overflow:hidden;scrollbar-gutter:stable;background:var(--sa-handoff-bg,#0a0a10)}
/* The hand-off only carries the themed backdrop: the boot window already faded
   the logo and title out, so repeating them would look like a second replay. */
.sa[data-handoff="1"]{background:color-mix(in srgb,var(--sa-bg) 86%,transparent)}
.sa[data-handoff="1"] .sa-center,.sa[data-handoff="1"] .sa-skip{opacity:0}
/* The launcher paints its composition right away: a hidden window can pause the
   entrance animations, which would leave an empty frame on screen. */
.sa[data-instant="1"] .sa-mark,.sa[data-instant="1"] .sa-glyph,.sa[data-instant="1"] .sa-logo,.sa[data-instant="1"] .sa-title,.sa[data-instant="1"] .sa-sub,.sa[data-instant="1"] .sa-caption{animation:none;opacity:1}
.sa[data-instant="1"] .sa-core::before{animation:none;opacity:.18}
.sa[data-handoff="1"] .sa-orbit i,.sa[data-handoff="1"] .sa-blobs i,.sa[data-handoff="1"] .sa-stars,.sa[data-handoff="1"] .sa-stars::after,.sa[data-handoff="1"] .sa-mark::after,.sa[data-handoff="1"] .sa-meter i{animation:none}
.sa[data-handoff="1"] .sa-mark,.sa[data-handoff="1"] .sa-glyph,.sa[data-handoff="1"] .sa-logo,.sa[data-handoff="1"] .sa-title,.sa[data-handoff="1"] .sa-sub,.sa[data-handoff="1"] .sa-caption,.sa[data-handoff="1"] .sa-meter{animation:none;opacity:1}
.sa[data-handoff="1"] .sa-meter i{transform:scaleX(1)}
.sa[data-handoff="1"] .sa-mark::after{opacity:0}
/* Video intro: the CSS composition stays on screen until a decoded video frame
   exists, then both layers cross-fade. On exit the video softens into a themed
   curtain, so the workbench never sees a black cut or a second replay. */
.sa-video{position:absolute;inset:0;width:100%;height:100%;z-index:1;object-fit:cover;opacity:0;pointer-events:none;background:var(--sa-bg);transition:opacity .7s ease,filter .7s ease,transform .7s cubic-bezier(.4,0,.2,1)}
.sa[data-video-fit=contain] .sa-video{object-fit:contain}
.sa.sa-video-ready .sa-video{opacity:1}
.sa.sa-video-fallback .sa-video{opacity:0}
.sa-video-veil{position:absolute;inset:0;z-index:1;pointer-events:none;opacity:0;background:linear-gradient(180deg,rgba(0,0,0,.3),rgba(0,0,0,.2) 46%,rgba(0,0,0,.5));transition:opacity .7s ease}
.sa[data-theme=paper] .sa-video-veil{background:linear-gradient(180deg,rgba(255,255,255,.42),rgba(255,255,255,.3) 46%,rgba(255,255,255,.6))}
.sa[data-video-overlay="1"].sa-video-ready .sa-video-veil{opacity:1}
.sa-video-curtain{position:absolute;inset:0;z-index:3;pointer-events:none;opacity:0;background:var(--sa-bg);transition:opacity .62s ease}
.sa[data-video="1"] .sa-bg,.sa[data-video="1"] .sa-blobs,.sa[data-video="1"] .sa-grid,.sa[data-video="1"] .sa-stars,.sa[data-video="1"] .sa-curtain,.sa[data-video="1"] .sa-core,.sa[data-video="1"] .sa-center{transition:opacity .7s ease}
.sa[data-video="1"].sa-video-ready .sa-bg,.sa[data-video="1"].sa-video-ready .sa-blobs,.sa[data-video="1"].sa-video-ready .sa-grid,.sa[data-video="1"].sa-video-ready .sa-stars,.sa[data-video="1"].sa-video-ready .sa-curtain,.sa[data-video="1"].sa-video-ready .sa-core{opacity:0}
.sa[data-video-overlay="0"] .sa-center{opacity:0}
.sa-skip{z-index:4}
.sa.sa-video-exit .sa-video{filter:blur(14px) brightness(.72);transform:scale(1.045)}
.sa.sa-video-exit .sa-video-veil{opacity:0}
.sa.sa-video-exit .sa-video-curtain{opacity:.94}
.sa.sa-out-fast.sa-video-exit .sa-video,.sa.sa-out-fast.sa-video-exit .sa-video-curtain{transition-duration:.18s}
.sa-hold *{animation-play-state:paused!important}
.sa.sa-out-fast{transition-duration:.18s}
.sa-out{pointer-events:none}
.sa-out[data-exit=fade]{opacity:0}
.sa-out[data-exit=rise]{opacity:0;transform:translateY(-3.5%)}
.sa-out[data-exit=zoom]{opacity:0;transform:scale(1.06)}
@keyframes sa-fade{from{opacity:0}to{opacity:1}}
@keyframes sa-glow-in{from{opacity:0;transform:scale(.72)}to{opacity:.18;transform:none}}
@keyframes sa-fade-up{from{opacity:0;transform:translateY(.7em)}to{opacity:1;transform:none}}
@keyframes sa-title-in{from{opacity:0;letter-spacing:.62em;text-indent:.62em;transform:translateY(.28em);filter:blur(4px)}to{opacity:1;letter-spacing:.22em;text-indent:.22em;transform:none;filter:none}}
@keyframes sa-mark-in{from{opacity:0;transform:scale(.86) translateY(.5em)}to{opacity:1;transform:none}}
@keyframes sa-glyph-in{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:none}}
@keyframes sa-sheen{0%,72%{transform:translateX(-130%)}92%,100%{transform:translateX(130%)}}
@keyframes sa-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@keyframes sa-ripple{0%{transform:scale(.55);opacity:0}18%{opacity:.4}100%{transform:scale(2.5);opacity:0}}
@keyframes sa-fill{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes sa-drift{from{transform:translate3d(-1.5em,1em,0) scale(1)}to{transform:translate3d(2em,-1.4em,0) scale(1.08)}}
@keyframes sa-stars{from{transform:translateY(0)}to{transform:translateY(-220px)}}
@keyframes sa-aurora{from{transform:rotate(-4deg) scale(1)}to{transform:rotate(4deg) scale(1.06)}}
@keyframes sa-curtain-left{from{transform:none}to{transform:translateX(-101%)}}
@keyframes sa-curtain-right{from{transform:none}to{transform:translateX(101%)}}
@media(max-width:680px){.sa{font-size:12px}.sa-center{gap:2em;padding:1.4em}.sa-core{width:13em;height:13em}.sa-title{font-size:2.1em}.sa-sub{letter-spacing:.2em;text-indent:.2em}.sa-skip{right:1.2em;bottom:1.1em}}
@media(prefers-reduced-motion:reduce){.sa{transition:none}.sa *{animation:none!important;transition:none!important}}
`;

export const startupPanel = String.raw`
<section id="view-startup" aria-label="启动动画" hidden>
<div class="panel sa-intro"><div><h2>启动动画 <span class="tag" id="sa-status">读取中</span></h2><p id="sa-hint" class="help-text">正在读取启动动画设置…</p></div><div class="inline-actions"><button class="button primary" id="sa-install" hidden>安装启动动画插件</button><button class="button" id="sa-toggle" hidden>启用插件</button></div></div>
<p id="sa-error" class="banner error" role="alert" tabindex="-1" hidden></p>
<div class="sa-layout">
<div class="panel sa-stage-panel"><div class="panel-head"><h2>效果预览</h2><span class="tag" id="sa-stage-tag">尚未启用</span></div>
<div class="sa-preview" id="sa-preview" aria-label="启动动画预览"></div>
<div class="sa-preview-bar"><button class="button" id="sa-replay" type="button">重新播放</button><span class="help-text">预览是缩小版；实际动画铺满整个工作台窗口。</span></div>
<ul class="sa-facts">
<li><strong>首帧播放</strong><span>页面出现时动画已经就位，不会先闪一下工作台。</span></li>
<li><strong>视频过渡</strong><span>视频有画面后才与内置画面交叉淡入；收起时先模糊压暗，再溶解到工作台，桌面交接不重播。</span></li>
<li><strong>就绪退出</strong><span>后台状态就绪后按设置的退出方式收起；最长 12 秒兜底，可点击跳过。</span></li>
<li><strong>只在本机</strong><span>文案、颜色、Logo 与视频保存在本机数据目录，不上传网络。</span></li>
</ul>
</div>
<div class="panel sa-controls"><div class="panel-head"><h2>自定义</h2><span class="tag" id="sa-save-tag">读取中</span></div>
<form id="sa-form" class="sa-form">
<div class="sa-field"><span class="sa-label">动画来源</span><div class="sa-chips" id="sa-source-chips" role="group" aria-label="动画来源"></div><p class="help-text">内置动画用光环、涟漪等样式；「我的视频」播放本机片头，视频有画面之前由内置动画打底。</p></div>
<div class="sa-video-options" id="sa-video-options" hidden>
<div class="sa-field"><span class="sa-label">视频填充</span><div class="sa-chips" id="sa-fit-chips" role="group" aria-label="视频填充"></div></div>
<div class="sa-checks sa-checks-tight">
<label class="sa-check"><input type="checkbox" id="sa-video-loop" checked> 循环播放到就绪</label>
<label class="sa-check"><input type="checkbox" id="sa-video-overlay" checked> 叠加标题文案</label>
</div>
</div>
<div class="sa-field"><span class="sa-label">动画风格</span><div class="sa-chips" id="sa-preset-chips" role="group" aria-label="动画风格"></div><p class="help-text" id="sa-preset-hint">轨道：光环缓慢旋转；涟漪：从中心扩散；星屑：星点漂浮；幕启：幕布向两侧打开。</p></div>
<div class="sa-field"><span class="sa-label">底色</span><div class="sa-chips" id="sa-theme-chips" role="group" aria-label="底色"></div></div>
<div class="sa-row">
<label class="sa-field" for="sa-accent"><span class="sa-label">强调色</span><span class="sa-color"><input id="sa-accent" type="color" value="#8b7cf6"><output id="sa-accent-value" for="sa-accent">#8b7cf6</output></span></label>
<label class="sa-field" for="sa-exit"><span class="sa-label">退出方式</span><select id="sa-exit"></select></label>
</div>
<label class="sa-field" for="sa-title"><span class="sa-label">主标题 <small id="sa-title-count">0/24</small></span><input id="sa-title" type="text" maxlength="24" placeholder="留空则不显示"></label>
<label class="sa-field" for="sa-subtitle"><span class="sa-label">副标题 <small id="sa-subtitle-count">0/60</small></span><input id="sa-subtitle" type="text" maxlength="60" placeholder="留空则不显示"></label>
<label class="sa-field" for="sa-caption"><span class="sa-label">启动提示 <small id="sa-caption-count">0/40</small></span><input id="sa-caption" type="text" maxlength="40" placeholder="留空则不显示"></label>
<label class="sa-field" for="sa-min"><span class="sa-label">最短展示时长 <output id="sa-min-value" for="sa-min">1.8 秒</output></span><input id="sa-min" type="range" min="600" max="8000" step="100" value="1800"></label>
<div class="sa-checks">
<label class="sa-check"><input type="checkbox" id="sa-enabled"> 显示启动动画</label>
<label class="sa-check"><input type="checkbox" id="sa-progress"> 显示进度线</label>
<label class="sa-check"><input type="checkbox" id="sa-skip"> 点击任意处跳过</label>
<label class="sa-check"><input type="checkbox" id="sa-once"> 每次会话只播放一次</label>
</div>
<div class="sa-field"><span class="sa-label">自定义 Logo <small>PNG / JPEG / WebP / GIF，≤ 2 MiB</small></span>
<div class="sa-logo-row"><span class="sa-logo-preview" id="sa-logo-preview"></span><div class="inline-actions"><button class="button" id="sa-logo-upload" type="button">选择图片</button><button class="button danger" id="sa-logo-remove" type="button" hidden>移除</button><input type="file" id="sa-logo-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></div></div>
<p class="help-text">没有上传时使用内置的对话气泡标记；Logo 只保存在本机数据目录。</p></div>
<div class="sa-field"><span class="sa-label">自定义启动视频 <small>MP4 / WebM，≤ 40 MiB</small></span>
<div class="sa-video-row"><span class="sa-video-chip" id="sa-video-chip"></span><div class="inline-actions"><button class="button" id="sa-video-upload" type="button">选择视频</button><button class="button danger" id="sa-video-remove" type="button" hidden>移除</button><input type="file" id="sa-video-file" accept="video/mp4,video/webm,.mp4,.webm" hidden></div></div>
<p class="help-text" id="sa-video-hint">上传后自动切换为视频片头：静音播放，首帧出现前由内置动画打底，收起时渐隐到同色交接，不会黑闪或重播。</p></div>
<p id="sa-form-state" class="help-text" role="status"></p>
<div class="sa-actions"><button class="button primary" id="sa-save" type="submit">保存设置</button><button class="button" id="sa-reset" type="button">恢复默认</button></div>
</form>
</div>
</div>
</section>`;

export const startupStylesPanel = String.raw`
.sa-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(370px,.86fr);gap:24px;align-items:start}
.sa-intro{display:flex;justify-content:space-between;align-items:center;gap:18px;padding:20px 24px;margin-bottom:20px}
.sa-intro h2{font-size:15px}.sa-intro .help-text{margin-top:6px;max-width:78ch}
.sa-preview{position:relative;aspect-ratio:16/10;margin:20px 22px 0;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#0a0a10}
.sa-preview .sa{position:absolute;inset:0;font-size:10px;transition:none;animation:none}
.sa-preview .sa.sa-out{opacity:1;transform:none}
.sa-preview-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 22px 0}
.sa-preview-bar .help-text{text-align:right}
.sa-facts{list-style:none;margin:0;padding:6px 22px 20px;display:grid;gap:9px}
.sa-facts li{display:grid;grid-template-columns:5em minmax(0,1fr);gap:10px;align-items:baseline;padding-top:9px;border-top:1px solid var(--line);font-size:12px;color:var(--muted);line-height:1.75}
.sa-facts strong{font-size:12px;color:var(--ink);font-weight:600}
.sa-facts span{overflow-wrap:anywhere}
.sa-form{padding:18px 24px 22px}
.sa-field{display:grid;gap:7px;margin:0 0 16px;font-size:12px;color:var(--muted);min-width:0}
.sa-label{display:flex;align-items:center;justify-content:space-between;gap:10px;color:var(--ink);font-size:12px;font-weight:600}
.sa-label small{color:var(--muted);font-weight:400;font-variant-numeric:tabular-nums}
.sa-field input[type=text],.sa-field select{width:100%;padding:9px 11px;border:1px solid var(--field-line);background:var(--surface);color:var(--ink);min-height:40px;font-size:13px}
.sa-field input[type=range]{width:100%;accent-color:var(--accent);margin:2px 0}
.sa-color{display:flex;align-items:center;gap:8px}
.sa-color input[type=color]{width:38px;height:30px;padding:0;border:1px solid var(--line);border-radius:8px;background:var(--surface);cursor:pointer}
.sa-color output{font-family:var(--mono);font-size:11px;color:var(--muted);text-transform:uppercase}
.sa-chips{display:flex;gap:7px;flex-wrap:wrap}
.sa-chip{border:1px solid var(--line);background:var(--surface);color:var(--muted);padding:6px 12px;border-radius:9px;font-size:12px;min-height:34px;line-height:1}
.sa-chip:hover{border-color:#c9c3ec;color:var(--ink)}
.sa-chip[aria-pressed=true]{border-color:#c9c3ec;background:var(--accent-soft);color:var(--accent);font-weight:600}
.sa-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.sa-checks{display:grid;gap:9px;padding:14px 0;margin-bottom:14px;border-top:1px solid var(--line)}
.sa-check{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--ink);min-height:24px}
.sa-check input{width:17px;height:17px;accent-color:var(--accent);margin:0}
.sa-logo-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.sa-logo-preview{width:44px;height:44px;border:1px solid var(--line);border-radius:10px;background:var(--surface-muted);display:grid;place-items:center;overflow:hidden;color:var(--muted);flex:none}
.sa-logo-preview img{max-width:100%;max-height:100%;object-fit:contain;display:block}
.sa-logo-preview svg{width:22px;height:22px}
.sa-video-options[hidden]{display:none}
.sa-checks-tight{padding:0 0 12px;margin-bottom:8px;border-top:0}
.sa-video-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.sa-video-chip{display:inline-flex;align-items:center;min-height:34px;max-width:100%;padding:0 12px;border:1px solid var(--line);border-radius:9px;background:var(--surface-muted);color:var(--muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sa-video-chip[data-active="1"]{color:var(--ink);border-color:#c9c3ec;background:var(--accent-soft)}
.sa-preview .sa-video-curtain{transition-duration:.3s}
.sa-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;padding-top:16px;border-top:1px solid var(--line)}
@media(max-width:1100px){.sa-layout{grid-template-columns:minmax(0,1fr)}}
@media(max-width:680px){.sa-intro{align-items:flex-start;flex-direction:column;padding:16px}.sa-preview{margin:16px 16px 0;aspect-ratio:4/3}.sa-preview-bar{align-items:flex-start;flex-direction:column;padding:12px 16px 0}.sa-preview-bar .help-text{text-align:left}.sa-facts{padding:6px 16px 16px}.sa-form{padding:16px}.sa-row{grid-template-columns:1fr;gap:0}.sa-field select,.sa-field input[type=text]{font-size:16px;min-height:44px}.sa-chip{min-height:40px}}
`;

export const startupClient = String.raw`
let startupSnapshot=null,startupBusy=false,startupDirty=false;
const startupPresetLabels=${JSON.stringify(PRESET_LABELS)};
const startupThemeLabels=${JSON.stringify(THEME_LABELS)};
const startupExitLabels=${JSON.stringify(EXIT_LABELS)};
const startupSourceLabels=${JSON.stringify(SOURCE_LABELS)};
const startupFitLabels=${JSON.stringify(FIT_LABELS)};
function startupEl(id){return document.getElementById(id);}
function startupError(error){const node=startupEl('sa-error');if(!node)return;node.textContent=error?error.message||String(error):'';node.hidden=!error;if(error)node.focus({preventScroll:false});}
function startupChip(parent,value,label,onPick){
  const button=el('button','sa-chip',label);button.type='button';button.dataset.value=value;
  button.setAttribute('aria-pressed','false');button.onclick=()=>{if(startupBusy)return;onPick(value);};
  parent.append(button);return button;
}
function startupBuildChips(){
  const presets=startupEl('sa-preset-chips'),themes=startupEl('sa-theme-chips'),exits=startupEl('sa-exit');
  const sources=startupEl('sa-source-chips'),fits=startupEl('sa-fit-chips');
  if(!presets||!themes||!exits||!sources||!fits||presets.childElementCount)return;
  for(const [value,label] of Object.entries(startupSourceLabels))startupChip(sources,value,label,next=>{startupSetChip(sources,next);startupSyncOptions();startupReplay();startupMarkDirty();});
  for(const [value,label] of Object.entries(startupFitLabels))startupChip(fits,value,label,next=>{startupSetChip(fits,next);startupSyncPreview();startupMarkDirty();});
  for(const [value,label] of Object.entries(startupPresetLabels))startupChip(presets,value,label,next=>{startupSetChip(presets,next);startupReplay();});
  for(const [value,label] of Object.entries(startupThemeLabels))startupChip(themes,value,label,next=>{startupSetChip(themes,next);startupReplay();});
  for(const [value,label] of Object.entries(startupExitLabels)){const option=el('option','',label);option.value=value;exits.append(option);}
}
function startupSetChip(parent,value){for(const chip of parent.querySelectorAll('.sa-chip'))chip.setAttribute('aria-pressed',String(chip.dataset.value===value));}
function startupValues(){
  return {
    source:(startupEl('sa-source-chips').querySelector('[aria-pressed=true]')||{}).dataset?.value||'preset',
    video_fit:(startupEl('sa-fit-chips').querySelector('[aria-pressed=true]')||{}).dataset?.value||'cover',
    video_loop:startupEl('sa-video-loop').checked,
    video_overlay:startupEl('sa-video-overlay').checked,
    preset:(startupEl('sa-preset-chips').querySelector('[aria-pressed=true]')||{}).dataset?.value||'orbit',
    theme:(startupEl('sa-theme-chips').querySelector('[aria-pressed=true]')||{}).dataset?.value||'ink',
    accent:startupEl('sa-accent').value,
    exit:startupEl('sa-exit').value,
    title:startupEl('sa-title').value,
    subtitle:startupEl('sa-subtitle').value,
    caption:startupEl('sa-caption').value,
    min_ms:Number(startupEl('sa-min').value),
    enabled:startupEl('sa-enabled').checked,
    show_progress:startupEl('sa-progress').checked,
    skippable:startupEl('sa-skip').checked,
    once_per_session:startupEl('sa-once').checked
  };
}
function startupSeconds(ms){return (ms/1000).toFixed(1).replace(/\.0$/,'')+' 秒';}
function startupCounts(){
  for(const key of ['title','subtitle','caption']){
    const input=startupEl('sa-'+key),count=startupEl('sa-'+key+'-count');
    if(input&&count)count.textContent=input.value.length+'/'+input.maxLength;
  }
  const min=startupEl('sa-min');if(min)startupEl('sa-min-value').textContent=startupSeconds(Number(min.value));
}
function startupVideoLayer(node,value){
  const active=value.source==='video'&&!!startupSnapshot?.video;
  let video=node.querySelector('.sa-video');
  if(!active){
    if(video){
      try{video.pause();}catch(e){}
      video.remove();node.querySelector('.sa-video-veil')?.remove();node.querySelector('.sa-video-curtain')?.remove();
    }
    node.classList.remove('sa-video-ready','sa-video-exit');
    return;
  }
  if(!video){
    video=el('video','sa-video');
    video.muted=true;video.setAttribute('muted','');video.playsInline=true;video.setAttribute('playsinline','');
    video.setAttribute('preload','auto');video.setAttribute('aria-hidden','true');video.setAttribute('disablepictureinpicture','');
    const anchor=node.querySelector('.sa-center');
    node.insertBefore(video,anchor);
    node.insertBefore(el('div','sa-video-veil'),anchor);
    node.insertBefore(el('div','sa-video-curtain'),anchor);
  }
  video.loop=value.video_loop!==false;
  const url=startupSnapshot.video.url;
  if(video.getAttribute('src')!==url){video.setAttribute('src',url);video.dataset.wired='';}
  if(video.dataset.wired==='1')return;
  video.dataset.wired='1';
  const play=()=>{
    try{const played=video.play();Promise.resolve(played).then(()=>{if(video.parentNode===node)node.classList.add('sa-video-ready');}).catch(()=>{});}catch(e){}
  };
  video.onerror=()=>node.classList.remove('sa-video-ready');
  if(video.readyState>=2)play();else video.addEventListener('loadeddata',play,{once:true});
}
function startupSyncOptions(){
  const box=startupEl('sa-video-options');if(!box)return;
  const active=startupValues().source==='video';
  box.hidden=!active;
  const hint=startupEl('sa-video-hint');
  if(hint)hint.textContent=active?'视频片头已启用：保存后下次打开工作台生效；上传新视频会自动替换旧文件。':'上传后自动切换为视频片头：静音播放，首帧出现前由内置动画打底，收起时渐隐到同色交接，不会黑闪或重播。';
}
function startupRenderVideo(){
  const chip=startupEl('sa-video-chip'),video=startupSnapshot?.video;
  if(!chip)return;
  if(video){
    const name=video.name||('启动视频.'+video.format);
    chip.textContent=name+' · '+(video.size/1048576).toFixed(1)+' MiB';
    chip.dataset.active='1';chip.title=name;
  }else{chip.textContent='尚未上传视频';chip.dataset.active='0';chip.title='';}
  startupEl('sa-video-remove').hidden=!video;
  startupEl('sa-video-upload').textContent=video?'替换视频':'选择视频';
}
function startupApply(node,value){
  node.dataset.preset=value.preset;node.dataset.theme=value.theme;node.dataset.exit=value.exit;
  node.dataset.skip=value.skippable?'1':'0';node.dataset.once=value.once_per_session?'1':'0';
  node.dataset.videoFit=value.video_fit||'cover';
  node.dataset.videoOverlay=value.video_overlay?'1':'0';
  node.dataset.videoLoop=value.video_loop?'1':'0';
  node.dataset.video=value.source==='video'&&!!startupSnapshot?.video?'1':'0';
  node.style.setProperty('--sa-accent',value.accent);
  const title=node.querySelector('.sa-title'),subtitle=node.querySelector('.sa-sub'),caption=node.querySelector('.sa-caption');
  if(title){title.textContent=value.title;title.hidden=!value.title;}
  if(subtitle){subtitle.textContent=value.subtitle;subtitle.hidden=!value.subtitle;}
  if(caption){caption.textContent=value.caption;caption.hidden=!value.caption;}
  const meter=node.querySelector('.sa-meter');if(meter){meter.hidden=!value.show_progress;const fill=meter.firstElementChild;if(fill)fill.style.animationDuration=value.min_ms+'ms';}
  const skip=node.querySelector('.sa-skip');if(skip)skip.hidden=!value.skippable;
  const image=node.querySelector('.sa-logo'),glyph=node.querySelector('.sa-glyph'),logo=startupSnapshot?.logo;
  if(image&&glyph){
    // SVG elements do not implement HTMLElement.hidden, so both marks are
    // switched through the attribute the page stylesheet keys on.
    image.onerror=()=>{image.setAttribute('hidden','');glyph.removeAttribute('hidden');};
    if(logo){image.src=logo.url;image.removeAttribute('hidden');glyph.setAttribute('hidden','');}
    else {image.removeAttribute('src');image.setAttribute('hidden','');glyph.removeAttribute('hidden');}
  }
  startupVideoLayer(node,value);
}
function startupReplay(){
  const host=startupEl('sa-preview'),template=document.getElementById('sa-template');
  if(!host||!template)return;
  try{host.querySelector('.sa-video')?.pause();}catch(e){}
  const node=template.content.firstElementChild.cloneNode(true);
  node.removeAttribute('id');node.removeAttribute('aria-hidden');
  startupApply(node,startupValues());
  host.replaceChildren(node);
}
function startupSyncPreview(){
  const node=startupEl('sa-preview')?.firstElementChild;if(!node)return;
  startupApply(node,startupValues());
}
function startupRenderLogo(){
  const host=startupEl('sa-logo-preview'),logo=startupSnapshot?.logo;
  if(!host)return;
  host.replaceChildren();
  if(logo){const img=el('img');img.src=logo.url;img.alt='当前 Logo';host.append(img);}
  else{
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#i-chat');
    svg.append(use);host.append(svg);
  }
  startupEl('sa-logo-remove').hidden=!logo;
}
function startupRender(){
  const snapshot=startupSnapshot,plugin=snapshot?.plugin;
  if(!snapshot)return;
  const status=startupEl('sa-status');
  status.textContent=!plugin?'未安装':plugin.enabled?'已启用':'已停用';status.className='tag '+(plugin?.enabled?'ok':'');
  startupEl('sa-install').hidden=!!plugin;startupEl('sa-toggle').hidden=!plugin;
  startupEl('sa-toggle').textContent=plugin?.enabled?'停用插件':'启用插件';
  startupEl('sa-hint').textContent=!plugin?'启动动画以插件形式提供。安装后即可自定义，并随时启用或停用。':plugin.enabled?(snapshot.enabled?'打开工作台时会播放下面这段动画。':'配置里的“显示启动动画”已关闭，保存后不会播放。'):'插件已停用，打开工作台时不会播放动画。启用后按已保存的样式播放。';
  startupEl('sa-stage-tag').textContent=plugin?.enabled&&snapshot.enabled?'已启用 · '+(snapshot.source==='video'?'我的视频':startupPresetLabels[snapshot.preset]):'预览';
  startupEl('sa-save-tag').textContent=plugin?(plugin.enabled?'已启用':'已停用'):'未安装';
  const config=plugin?.config||{};
  startupEl('sa-title').value=config.title??snapshot.title??'';
  startupEl('sa-subtitle').value=config.subtitle??snapshot.subtitle??'';
  startupEl('sa-caption').value=config.caption??snapshot.caption??'';
  startupEl('sa-accent').value=snapshot.accent||'#8b7cf6';
  startupEl('sa-accent-value').textContent=snapshot.accent||'#8b7cf6';
  startupEl('sa-min').value=String(snapshot.min_ms||1800);
  startupEl('sa-exit').value=snapshot.exit||'fade';
  startupEl('sa-enabled').checked=snapshot.enabled===true;
  startupEl('sa-progress').checked=snapshot.show_progress!==false;
  startupEl('sa-skip').checked=snapshot.skippable!==false;
  startupEl('sa-once').checked=snapshot.once_per_session===true;
  startupSetChip(startupEl('sa-source-chips'),snapshot.source||'preset');
  startupSetChip(startupEl('sa-fit-chips'),snapshot.video_fit||'cover');
  startupEl('sa-video-loop').checked=snapshot.video_loop!==false;
  startupEl('sa-video-overlay').checked=snapshot.video_overlay!==false;
  startupSetChip(startupEl('sa-preset-chips'),snapshot.preset||'orbit');
  startupSetChip(startupEl('sa-theme-chips'),snapshot.theme||'ink');
  startupCounts();startupRenderLogo();startupRenderVideo();startupSyncOptions();startupReplay();startupDirty=false;
  startupEl('sa-form-state').textContent=plugin?'':'安装插件后才能保存自定义。';
  startupEl('sa-save').disabled=!plugin;
  startupEl('sa-logo-upload').disabled=!plugin;
  startupEl('sa-video-upload').disabled=!plugin;
  startupEl('sa-reset').disabled=!plugin;
}
async function loadStartup(){
  const root=startupEl('view-startup');if(!root)return;
  startupBuildChips();
  try{startupSnapshot=await api('/startup-animation');startupError(null);startupRender();}
  catch(error){startupSnapshot=null;startupError(error);startupEl('sa-hint').textContent='无法读取启动动画插件：'+error.message;}
}
async function startupApplyResult(result){
  if(result&&typeof result==='object'&&Object.hasOwn(result,'enabled')){startupSnapshot=result;startupRender();}
  else await loadStartup();
  void loadPlugins();
}
function startupBusySet(value){
  startupBusy=value;
  for(const node of startupEl('view-startup')?.querySelectorAll('button,input,select')||[])node.disabled=value;
  if(!value&&startupSnapshot){startupEl('sa-save').disabled=!startupSnapshot.plugin;startupEl('sa-logo-upload').disabled=!startupSnapshot.plugin;startupEl('sa-video-upload').disabled=!startupSnapshot.plugin;startupEl('sa-reset').disabled=!startupSnapshot.plugin;}
}
function startupMarkDirty(){startupDirty=true;startupEl('sa-form-state').textContent='有未保存的修改，保存后下次打开工作台生效。';}
if(startupEl('view-startup')){
startupEl('sa-install').onclick=async()=>{
  if(startupBusy)return;startupBusySet(true);startupError(null);
  try{await api('/plugins/install',{kind:'startup-animation'});await loadStartup();notify('启动动画插件已安装。');}
  catch(error){startupError(error);}
  finally{startupBusySet(false);}
};
startupEl('sa-toggle').onclick=async()=>{
  const plugin=startupSnapshot?.plugin;if(startupBusy||!plugin)return;startupBusySet(true);startupError(null);
  try{await api('/plugins/toggle',{id:plugin.id,revision:plugin.revision,enabled:!plugin.enabled});await loadStartup();notify(plugin.enabled?'启动动画插件已停用。':'启动动画插件已启用。');}
  catch(error){startupError(error);}
  finally{startupBusySet(false);}
};
const startupForm=startupEl('sa-form');
startupForm.oninput=()=>{startupCounts();startupSyncPreview();startupMarkDirty();};
startupForm.onchange=()=>{startupCounts();startupSyncPreview();startupMarkDirty();};
startupEl('sa-min').oninput=()=>{startupCounts();startupMarkDirty();};
startupEl('sa-accent').oninput=()=>{startupEl('sa-accent-value').textContent=startupEl('sa-accent').value;startupSyncPreview();startupMarkDirty();};
startupEl('sa-exit').onchange=()=>{startupReplay();startupMarkDirty();};
startupEl('sa-replay').onclick=()=>startupReplay();
startupForm.onsubmit=async event=>{
  event.preventDefault();if(startupBusy||!startupSnapshot?.plugin)return;
  startupBusySet(true);startupError(null);
  try{const result=await api('/startup-animation/action',{action:'save',...startupValues()});await startupApplyResult(result);notify('启动动画已保存，下次打开工作台时生效。');}
  catch(error){startupError(error);}
  finally{startupBusySet(false);}
};
startupEl('sa-reset').onclick=()=>{
  startupEl('sa-title').value='Limen';startupEl('sa-subtitle').value='信号与回应之间';startupEl('sa-caption').value='正在启动本机工作台';
  startupEl('sa-accent').value='#8b7cf6';startupEl('sa-accent-value').textContent='#8b7cf6';
  startupEl('sa-min').value='1800';startupEl('sa-exit').value='fade';
  startupEl('sa-enabled').checked=true;startupEl('sa-progress').checked=true;startupEl('sa-skip').checked=true;startupEl('sa-once').checked=false;
  startupSetChip(startupEl('sa-source-chips'),'preset');startupSetChip(startupEl('sa-fit-chips'),'cover');
  startupEl('sa-video-loop').checked=true;startupEl('sa-video-overlay').checked=true;
  startupSetChip(startupEl('sa-preset-chips'),'orbit');startupSetChip(startupEl('sa-theme-chips'),'ink');
  startupCounts();startupSyncOptions();startupReplay();startupMarkDirty();notify('已填入默认值，保存后生效。');
};
startupEl('sa-logo-upload').onclick=()=>startupEl('sa-logo-file').click();
startupEl('sa-logo-file').onchange=async()=>{
  const file=startupEl('sa-logo-file').files[0];if(!file||startupBusy)return;
  startupBusySet(true);startupError(null);
  try{
    if(file.size>2*1024*1024)throw new Error('Logo 不能超过 2 MiB，请先压缩后再上传。');
    const source=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('无法读取图片文件。'));reader.readAsDataURL(file);});
    const result=await api('/startup-animation/action',{action:'upload-logo',data:source});
    await startupApplyResult(result);notify('Logo 已更新。');
  }catch(error){startupError(error);}
  finally{startupEl('sa-logo-file').value='';startupBusySet(false);}
};
startupEl('sa-logo-remove').onclick=async()=>{
  if(startupBusy||!startupSnapshot?.logo)return;
  if(!await confirmAction('移除自定义 Logo？','移除后会使用内置的对话气泡标记，图片文件从本机删除。'))return;
  startupBusySet(true);startupError(null);
  try{const result=await api('/startup-animation/action',{action:'remove-logo'});await startupApplyResult(result);notify('自定义 Logo 已移除。');}
  catch(error){startupError(error);}
  finally{startupBusySet(false);}
};
startupEl('sa-video-upload').onclick=()=>startupEl('sa-video-file').click();
startupEl('sa-video-file').onchange=async()=>{
  const file=startupEl('sa-video-file').files[0];if(!file||startupBusy)return;
  startupBusySet(true);startupError(null);
  try{
    if(file.size>40*1024*1024)throw new Error('视频不能超过 40 MiB，请先压缩后再上传。');
    const type=file.type||'video/mp4';
    if(!/^(?:video\/(?:mp4|webm|x-m4v|quicktime)|application\/octet-stream)$/i.test(type))throw new Error('请选择 MP4 或 WebM 视频。');
    const response=await fetch(base+'/startup-animation/video',{
      method:'POST',headers:{'Content-Type':type,'X-File-Name':encodeURIComponent(file.name)},
      body:file,signal:AbortSignal.timeout(90000)});
    const result=await response.json();
    if(!response.ok)throw new Error(result.message||'视频上传失败，请稍后重试。');
    await startupApplyResult(result);notify('视频已上传并切换为片头，下次打开工作台生效。');
  }catch(error){startupError(error);}
  finally{startupEl('sa-video-file').value='';startupBusySet(false);}
};
startupEl('sa-video-remove').onclick=async()=>{
  if(startupBusy||!startupSnapshot?.video)return;
  if(!await confirmAction('移除启动视频？','移除后会回到内置动画，视频文件从本机删除。'))return;
  startupBusySet(true);startupError(null);
  try{const result=await api('/startup-animation/action',{action:'remove-video'});await startupApplyResult(result);notify('启动视频已移除，已切回内置动画。');}
  catch(error){startupError(error);}
  finally{startupBusySet(false);}
};
}
`;
