import assert from 'node:assert/strict';
import {createMediaManager} from '../media.js';

// Exercise the real media coordinator without contacting camera servers. The
// fake browser supplies visibility and video outcomes; no playback policy is
// assumed from this test in place of browser/device verification.
const originals=new Map();const originalDateNow=Date.now;
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
  // Source cadence applies to both successful and failed Oregon retrievals.
  let now=1_000_000;Date.now=()=>now;
  const snapshotManager=manager(),snapshotRoot=new Element(),oregonView=new Element();snapshotRoot.append(oregonView);
  const oregon={id:'OR:tripcheck:4674',state:'OR',name:'Border view',imageUrl:'https://www.tripcheck.com/roadcams/cams/test.jpg',snapshotUpdateSeconds:300};
  const startImages=images.length;snapshotManager.snapshot(oregonView,oregon);visible(oregonView,true);await flush();assert.equal(images.length,startImages+1);
  images.at(-1).onload();assert.match(oregonView.children.find(node=>node.className==='media-time').textContent,/capture time unknown/);
  now+=60_000;intervals.forEach(callback=>callback());assert.equal(images.length,startImages+1,'Oregon must not inherit the generic 60-second interval');
  now+=240_000;intervals.forEach(callback=>callback());assert.equal(images.length,startImages+2);images.at(-1).onerror();
  now+=60_000;intervals.forEach(callback=>callback());assert.equal(images.length,startImages+2,'Source cadence also limits failed-image retries');
  now+=240_000;intervals.forEach(callback=>callback());assert.equal(images.length,startImages+3);
  visible(oregonView,false);assert.equal(snapshotManager.debug().running,0,'Offscreen images cancel active requests');
  snapshotManager.dispose(snapshotRoot);
  const concurrentManager=manager(),concurrentRoot=new Element();const activeViews=[];const beforeConcurrent=images.length;
  for(let i=0;i<6;i++){const view=new Element();concurrentRoot.append(view);activeViews.push(view);concurrentManager.snapshot(view,{...oregon,id:oregon.id+i});visible(view,true);}
  assert.equal(images.length,beforeConcurrent+4);assert.equal(concurrentManager.debug().running,4);assert.equal(concurrentManager.debug().queued,2);
  images[beforeConcurrent].onload();assert.equal(images.length,beforeConcurrent+5);assert.equal(concurrentManager.debug().running,4);
  tabHidden(true);assert.equal(concurrentManager.debug().running,0);assert.equal(concurrentManager.debug().queued,0);concurrentManager.dispose(concurrentRoot);tabHidden(false);await flush();
  Date.now=originalDateNow;
  console.log('Passed Oregon snapshot cadence, failure backoff, capture-time labeling, four-request concurrency, offscreen cancellation, and hidden-tab cleanup.');
  assert.equal(observers.reduce((sum,observer)=>sum+observer.targets.size,0),0,'Disposed views must not retain visibility observations');
  assert.equal(timers.size,0,'Connection timeouts must be cleared after stop/dispose');
  console.log('Passed WV autoplay: muted inline/no native controls, shared stream cap, manual priority, offscreen/tab resume, blocked/source failure retry guards, autoplay toggle, stop-all hold, modal scope, and disposal cleanup.');
} finally {
  Date.now=originalDateNow;
  for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
}
