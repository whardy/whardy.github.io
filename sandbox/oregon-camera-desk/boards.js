export const KEY='oregon-camera-desk-boards-v1';
const uid=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
const name=v=>String(v||'My watchboard').trim().slice(0,100)||'My watchboard';
export function cleanBoard(v){if(!v||!Array.isArray(v.cameraIds))return null;return {id:String(v.id||uid()).slice(0,100),name:name(v.name),cameraIds:[...new Set(v.cameraIds.filter(id=>typeof id==='string'&&/^[a-zA-Z0-9:_-]{1,180}$/.test(id)))].slice(0,500)};}
export function normalizeLibrary(v){const boards=(Array.isArray(v?.boards)?v.boards:[]).slice(0,30).map(cleanBoard).filter(Boolean);if(!boards.length)boards.push({id:'default',name:'My watchboard',cameraIds:[]});return {version:1,boards,activeBoardId:boards.some(b=>b.id===v?.activeBoardId)?v.activeBoardId:boards[0].id};}
export function loadLibrary(){try{return normalizeLibrary(JSON.parse(localStorage.getItem(KEY)||'{}'));}catch{return normalizeLibrary({});}}
export function saveLibrary(v){try{localStorage.setItem(KEY,JSON.stringify(v));return true;}catch{return false;}}
export function mergeLibrary(target,v){if(!v||!Array.isArray(v.boards))throw new Error('Choose an Oregon Camera Desk JSON export with a boards array.');if(v.boards.length>30)throw new Error('Import supports at most 30 boards.');const incoming=v.boards.map(cleanBoard);if(incoming.some(b=>!b))throw new Error('Invalid board: cameraIds must be an array.');let count=0;for(const board of incoming){if(target.boards.length>=30)break;target.boards.push({...board,id:uid()});count++;}return count;}
export function encodeShare(v){const bytes=new TextEncoder().encode(JSON.stringify(v));if(bytes.length>12000)throw new Error('This board is too large for a reliable link. Export JSON instead.');let binary='';for(const b of bytes)binary+=String.fromCharCode(b);return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export function decodeShare(v){if(typeof v!=='string'||v.length>18000)throw new Error('Share link is too large.');return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))));}
export function newBoard(boardName){return {id:uid(),name:name(boardName),cameraIds:[]};}
export function tripShare(board){return {type:'board',board:{name:board.name,cameraIds:board.cameraIds.map(id=>`OR:tripcheck:${id}`)}};}
