const KEY='nevada-camera-desk-library-v1';
export const newId=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
const text=(v,n=100)=>String(v??'').trim().slice(0,n);
export function normalizeLibrary(input){
  const boards=(Array.isArray(input?.boards)?input.boards:[]).slice(0,30).filter(b=>b&&Array.isArray(b.cameraIds)).map(b=>({id:text(b.id||newId(),80),name:text(b.name||'My Nevada board'),cameraIds:[...new Set(b.cameraIds.filter(id=>typeof id==='string'&&id.length<=220&&/^[A-Za-z0-9:_./-]+$/.test(id)))].slice(0,500)}));
  if(!boards.length)boards.push({id:'default',name:'My Nevada board',cameraIds:[]});
  const unique=[];for(const b of boards){if(unique.some(x=>x.id===b.id))b.id=newId();unique.push(b);}
  return {version:1,boards:unique,activeBoardId:unique.some(b=>b.id===input?.activeBoardId)?input.activeBoardId:unique[0].id};
}
export function loadLibrary(){try{return normalizeLibrary(JSON.parse(localStorage.getItem(KEY)||'{}'));}catch{return normalizeLibrary({});}}
export function saveLibrary(value){try{localStorage.setItem(KEY,JSON.stringify(normalizeLibrary(value)));return true;}catch{return false;}}
export function mergeLibrary(library,input){const clean=normalizeLibrary(input);for(const board of clean.boards){if(library.boards.length>=30)break;library.boards.push({...board,id:newId()});}return library;}
export function encodeShare(value){const bytes=new TextEncoder().encode(JSON.stringify(value));if(bytes.length>18000)throw new Error('This board is too large for a reliable link. Use JSON export instead.');let raw='';for(const b of bytes)raw+=String.fromCharCode(b);return btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export function decodeShare(value){if(typeof value!=='string'||value.length>26000)throw new Error('Invalid or oversized shared board.');const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return JSON.parse(new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0))));}
