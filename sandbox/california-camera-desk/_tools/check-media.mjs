import assert from 'node:assert/strict';
import {createMediaManager} from '../media.js';

// Exercise the real media coordinator without contacting camera servers. The
// fake browser supplies visibility and video outcomes; no playback policy is
// assumed from this test in place of browser/device verification.
const originals=new Map();
const replace=(key,value)=>{originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});};
const observers=[],documentEvents=new Map(),videos=[],outcomes=[],images=[],intervals=[];
let timerId=0;const timers=new Map();
class Element {
  constructor(tag='div') {this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.dataset={};this.attributes=new Map();this.textContent='';this.hidden=false;this.listeners=new Map();const classes=new Set();this.classList={add:(...v)=>v.forEach(x=>classes.add(x)),remove:(...v)=>v.forEach(x=>classes.delete(x)),contains:v=>classes.has(v),toggle:(v,on)=>{if(on??!classes.has(v))classes.add(v);else classes.delete(v);}};}
  append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
  prepend(node){node.remove();node.parentElement=this;this.children.unshift(node);}
  replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];this.append(...nodes);}
  remove(){if(this.parentElement){const parent=this.parentElement;parent.children=parent.children.filter(x=>x!==this);this.parentElement=null;}}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  setAttribute(key,value){this.attributes.set(key,String(value));}
  getAttribute(key){return this.attributes.get(key)??null;}
  hasAttribute(key){return this.attributes.has(key);}
  removeAttribute(key){this.attributes.delete(key);if(key==='src')this.src='';}
  addEventListener(type,callback,options={}){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add({callback,once:options.once});}
  emit(type){for(const listener of [...(this.listeners.get(type)||[])]){listener.callback({type,target:this});if(listener.once)this.listeners.get(type).delete(listener);}}
}
class Video extends Element {
  constructor(){super('video');this.controls=false;this.muted=false;this.defaultMuted=false;this.playsInline=false;this.autoplay=false;this.paused=true;this.currentTime=0;this.readyState=0;this.playCalls=0;videos.push(this);}
  canPlayType(){return 'probably';}
  set src(value){this._src=value;if(value)this.atSource={controls:this.controls,muted:this.muted,defaultMuted:this.defaultMuted,playsInline:this.playsInline,autoplay:this.autoplay,inlineAttribute:this.hasAttribute('playsinline'),mutedAttribute:this.hasAttribute('muted')};}
  get src(){return this._src||'';}
  play(){this.playCalls++;const result=outcomes.shift();if(result==='blocked'){const error=new Error('Autoplay blocked');error.name='NotAllowedError';return Promise.reject(error);}this.paused=false;this.currentTime=1;this.readyState=4;this.emit('playing');return Promise.resolve();}
  pause(){this.paused=true;}
  load(){}
}
class VisibilityObserver {
  constructor(callback){this.callback=callback;this.targets=new Set();observers.push(this);}
  observe(target){this.targets.add(target);}
  unobserve(target){this.targets.delete(target);}
  disconnect(){this.targets.clear();}
}
const document={hidden:false,createElement:tag=>tag==='video'?new Video():new Element(tag),addEventListener(type,callback){if(!documentEvents.has(type))documentEvents.set(type,new Set());documentEvents.get(type).add(callback);}};
replace('document',document);replace('window',{Hls:{isSupported:()=>false}});replace('navigator',{userAgent:'iPhone test browser'});replace('matchMedia',()=>({matches:false}));replace('IntersectionObserver',VisibilityObserver);replace('Image',class extends Element{constructor(){super('img');this.naturalWidth=640;images.push(this);}});
replace('setTimeout',(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;});replace('clearTimeout',id=>timers.delete(id));replace('setInterval',callback=>{intervals.push(callback);return intervals.length;});
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
function visible(container,value){for(const observer of observers)if(observer.targets.has(container))observer.callback([{target:container,isIntersecting:value}]);}
function tabHidden(value){document.hidden=value;for(const callback of documentEvents.get('visibilitychange')||[])callback();}
const wv=id=>({id:`WV:wv511:${id}`,state:'WV',name:id,videoUrl:`https://vtc1.roadsummary.com/rtplive/${id}/playlist.m3u8`,imageUrl:null,disabled:false});
const ca=id=>({id:`CA:caltrans:D03:${id}`,state:'CA',name:id,videoUrl:`https://example.com/${id}/playlist.m3u8`,imageUrl:null,videoStatus:'available',disabled:false});
const md={id:'MD:mdot:sample',state:'MD',name:'Maryland sample',videoUrl:'https://strmr3.sha.maryland.gov/rtplive/sample/playlist.m3u8',imageUrl:null,disabled:false};
const videoIn=container=>container.children.find(node=>node.tagName==='VIDEO');
const playCount=()=>videos.reduce((sum,video)=>sum+video.playCalls,0);
const managers=[];
function manager(options){const m=createMediaManager(options);managers.push(m);return m;}

try {
  // Visible WV entries start automatically, configure native inline/muted
  // attributes before playback, and remain under the same global video cap.
  const m=manager();const scope=new Element();const a=new Element(),b=new Element(),c=new Element(),manual=new Element();scope.append(a,b,c,manual);
  m.snapshot(a,wv('A'));m.snapshot(b,wv('B'));m.snapshot(c,wv('C'));
  visible(a,true);visible(b,true);visible(c,true);await flush();
  assert.equal(m.count,2);assert.ok(videoIn(a)&&videoIn(b));assert.equal(videoIn(c),undefined);
  for(const video of [videoIn(a),videoIn(b)]){assert.equal(video.controls,false);assert.equal(video.muted,true);assert.equal(video.defaultMuted,true);assert.equal(video.playsInline,true);assert.equal(video.autoplay,true);for(const attr of ['muted','playsinline','webkit-playsinline','autoplay'])assert.ok(video.hasAttribute(attr),attr);assert.equal(video.playCalls,1);assert.deepEqual(video.atSource,{controls:false,muted:true,defaultMuted:true,playsInline:true,autoplay:true,inlineAttribute:true,mutedAttribute:true},'WV autoplay configuration must exist before assigning the native source');}
  const manualPlayer=m.play(manual,md);await flush();
  assert.ok(manualPlayer);assert.equal(m.count,2);assert.equal(videoIn(manual).controls,true,'Other states retain native controls');assert.equal([a,b,c].filter(videoIn).length,1,'Manual stream evicts one automatic preview');
  manualPlayer.stop();await flush();assert.equal(m.count,2);assert.equal([a,b,c].filter(videoIn).length,2,'Released capacity is refilled automatically');
  m.dispose(scope);await flush();assert.equal(m.count,0);assert.equal(scope.children.filter(videoIn).length,0);

  // Offscreen and hidden-tab cleanup retains the registration needed to resume.
  const resume=manager();resume.setLimit(1);const resumeScope=new Element(),preview=new Element();resumeScope.append(preview);resume.snapshot(preview,wv('RESUME'));
  visible(preview,true);await flush();const originalVideo=videoIn(preview);assert.ok(originalVideo);
  visible(preview,false);await flush();assert.equal(resume.count,0);assert.equal(videoIn(preview),undefined);
  visible(preview,true);await flush();assert.equal(resume.count,1);assert.notEqual(videoIn(preview),originalVideo);
  tabHidden(true);await flush();assert.equal(resume.count,0);
  tabHidden(false);await flush();assert.equal(resume.count,1);
  resume.setWVAutoplay(false);await flush();assert.equal(resume.count,0);visible(preview,false);visible(preview,true);await flush();assert.equal(resume.count,0,'Autoplay-off survives visibility changes');
  resume.setWVAutoplay(true);await flush();assert.equal(resume.count,1);
  resume.stopAll();await flush();assert.equal(resume.count,0,'Stop-all does not immediately refill');await flush();assert.equal(resume.count,0);
  resume.dispose(resumeScope);await flush();assert.equal(resume.count,0);

  // A blocked autoplay attempt and a bad source are not retried by scheduled
  // refill work. An explicit Refresh can release the blocked retry state.
  const failures=manager();const failureScope=new Element(),blocked=new Element(),badSource=new Element();failureScope.append(blocked,badSource);
  outcomes.push('blocked');failures.snapshot(blocked,wv('BLOCKED'));const beforeBlocked=playCount();visible(blocked,true);await flush();
  assert.equal(failures.count,0);assert.equal(playCount()-beforeBlocked,1);for(let i=0;i<3;i++){visible(blocked,true);await flush();}assert.equal(playCount()-beforeBlocked,1,'Policy rejection must not loop');
  failures.refresh();await flush();assert.equal(failures.count,1,'Explicit retry may start a previously blocked preview');
  visible(blocked,false);await flush();failures.snapshot(badSource,wv('BAD'));visible(badSource,true);await flush();const bad=videoIn(badSource);assert.ok(bad);const beforeError=playCount();
  bad.error={code:4,message:'Invalid source'};bad.emit('error');await flush();assert.equal(failures.count,0);assert.equal(videoIn(badSource),undefined);for(let i=0;i<3;i++){visible(badSource,true);await flush();}assert.equal(playCount(),beforeError,'Media failure must not trigger a retry loop');
  failures.dispose(failureScope);await flush();assert.equal(failures.count,0);

  // A modal owns autoplay capacity while it is open; closing it restores the
  // still-visible wall rather than orphaning either stream registration.
  const modalManager=manager();modalManager.setLimit(1);const wall=new Element(),dialog=new Element(),root=new Element();root.append(wall,dialog);
  modalManager.snapshot(wall,wv('WALL'));visible(wall,true);await flush();assert.ok(videoIn(wall));
  modalManager.setAutoplayScope(dialog);modalManager.snapshot(dialog,wv('DIALOG'));visible(dialog,true);await flush();assert.equal(videoIn(wall),undefined);assert.ok(videoIn(dialog));assert.equal(modalManager.count,1);
  modalManager.dispose(dialog);modalManager.setAutoplayScope(null);await flush();assert.ok(videoIn(wall));assert.equal(modalManager.count,1);
  modalManager.dispose(root);await flush();assert.equal(modalManager.count,0);
  // California has its own preference but shares video capacity, inline
  // configuration and manual priority. Disabling it must not pause WV.
  const california=manager();const caRoot=new Element(),caView=new Element(),wvView=new Element();caRoot.append(caView,wvView);
  california.snapshot(caView,ca('CA'));california.snapshot(wvView,wv('WV'));
  visible(caView,true);visible(wvView,true);await flush();assert.equal(california.count,2);assert.equal(videoIn(caView).controls,false);assert.ok(videoIn(caView).classList.contains('ca-inline-video'));
  california.setCAAutoplay(false);await flush();assert.equal(california.count,1);assert.ok(videoIn(wvView));assert.equal(videoIn(caView),undefined);
  california.setCAAutoplay(true);await flush();assert.equal(california.count,2);
  california.dispose(caRoot);await flush();assert.equal(california.count,0);

  // A dated failed CA video check does not auto-request it; the snapshot is
  // still usable and an explicit play action remains possible.
  const unavailableManager=manager();const unavailable=new Element();unavailableManager.snapshot(unavailable,{...ca('FAILED'),videoStatus:'unavailable',imageUrl:'https://example.com/current.jpg',snapshotUpdateSeconds:300});
  visible(unavailable,true);await flush();assert.equal(unavailableManager.count,0);assert.equal(videoIn(unavailable),undefined);assert.ok(images.at(-1).src.includes('current.jpg'));
  images.at(-1).onload();unavailableManager.dispose(unavailable);

  // A newly failing automatic CA stream returns to an actual decoded
  // snapshot registration and does not retry the bad stream automatically.
  const fallbackManager=manager();const fallbackView=new Element();fallbackManager.snapshot(fallbackView,{...ca('FALLBACK'),imageUrl:'https://example.com/fallback.jpg'});
  visible(fallbackView,true);await flush();const failedVideo=videoIn(fallbackView);assert.ok(failedVideo);
  const beforeFallback=images.length;failedVideo.error={code:4,message:'Failed segment'};failedVideo.emit('error');await flush();
  assert.equal(fallbackManager.count,0);assert.equal(images.length,beforeFallback+1,'Stream failure must enqueue the snapshot fallback');
  const fallbackImage=images.at(-1);fallbackImage.onload();assert.ok(fallbackView.children.includes(fallbackImage),'Successful fallback image is rendered');
  visible(fallbackView,true);await flush();assert.equal(fallbackManager.count,0,'A successful snapshot must not retry failed video');fallbackManager.dispose(fallbackView);

  // Snapshot requests respect a provider's five-minute nominal interval.
  // Force refresh is deliberately separate from scheduled refresh.
  const snapshotManager=manager();const snapshotView=new Element();const interval=intervals.at(-1),originalNow=Date.now;let now=1000000;
  Date.now=()=>now;
  try {
    snapshotManager.snapshot(snapshotView,{...ca('SNAPSHOT'),videoUrl:null,imageUrl:'https://example.com/five-minute.jpg',snapshotUpdateSeconds:300});visible(snapshotView,true);await flush();images.at(-1).onload();
    const requestCount=images.length;now+=60000;interval();await flush();assert.equal(images.length,requestCount,'One-minute scheduler must not ignore the nominal interval');
    now+=240000;interval();await flush();assert.equal(images.length,requestCount+1,'Provider interval permits one scheduled refresh');images.at(-1).onload();
    snapshotManager.refresh();await flush();assert.equal(images.length,requestCount+2,'Explicit Refresh remains available');images.at(-1).onload();
    snapshotManager.dispose(snapshotView);
  } finally {Date.now=originalNow;}
  assert.equal(observers.reduce((sum,observer)=>sum+observer.targets.size,0),0,'Disposed views must not retain visibility observations');
  assert.equal(timers.size,0,'Connection timeouts must be cleared after stop/dispose');
  console.log('Passed WV and CA autoplay: muted inline/no native controls, shared stream cap, manual priority, offscreen/tab resume, blocked/source failure retry guards, autoplay toggle, stop-all hold, modal scope, independent CA preference, snapshot fallback and nominal refresh intervals, and disposal cleanup.');
} finally {
  for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
}
