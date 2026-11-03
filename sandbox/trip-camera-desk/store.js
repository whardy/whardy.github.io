const KEY='trip-camera-desk-v1';
export const MAX_BOARD_CAMERAS=500;
const text=(value,max=120)=>String(value??'').trim().slice(0,max);
const uid=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function cleanPoint(point){
  if(!point||!['number','string'].includes(typeof point.lat)||!['number','string'].includes(typeof point.lon)||String(point.lat).trim()===''||String(point.lon).trim()===''||!Number.isFinite(Number(point.lat))||!Number.isFinite(Number(point.lon))||Math.abs(Number(point.lat))>85||Math.abs(Number(point.lon))>180)return null;
  return {name:text(point.name||point.label||'Map point',220),lat:Number(point.lat),lon:Number(point.lon)};
}
export function cleanTrip(trip){
  if(!trip||!Array.isArray(trip.points)||trip.points.length<2||trip.points.length>8)return null;
  const points=trip.points.map(cleanPoint);if(points.some(p=>!p))return null;
  return {id:text(trip.id||uid(),80),name:text(trip.name||`${points[0].name} → ${points.at(-1).name}`),points,avoidTolls:!!trip.avoidTolls,avoidHighways:!!trip.avoidHighways,corridorMeters:Math.max(100,Math.min(16093,Number(trip.corridorMeters)||1609)),updatedAt:new Date().toISOString()};
}
export function cleanBoard(board){
  if(!board||!Array.isArray(board.cameraIds))return null;
  return {id:text(board.id||uid(),80),name:text(board.name||'My watchboard'),cameraIds:[...new Set(board.cameraIds.filter(id=>typeof id==='string'&&/^[A-Z]{2}:[a-z0-9_-]+:.{1,180}$/.test(id)))].slice(0,MAX_BOARD_CAMERAS)};
}
export function normalizeLibrary(value){
  const trips=(Array.isArray(value?.trips)?value.trips:[]).slice(0,50).map(cleanTrip).filter(Boolean);
  const boards=(Array.isArray(value?.boards)?value.boards:[]).slice(0,30).map(cleanBoard).filter(Boolean);
  if(!boards.length)boards.push({id:'default',name:'My watchboard',cameraIds:[]});
  return {version:1,trips,boards,activeBoardId:boards.some(b=>b.id===value?.activeBoardId)?value.activeBoardId:boards[0].id};
}
export function loadLibrary(){try{return normalizeLibrary(JSON.parse(localStorage.getItem(KEY)||'{}'));}catch{return normalizeLibrary({});}}
export function saveLibrary(library){try{localStorage.setItem(KEY,JSON.stringify(library));return true;}catch{return false;}}
export function mergeLibrary(library,incoming){
  const clean=normalizeLibrary(incoming);
  for(const board of clean.boards){if(library.boards.length>=30)break;let id=board.id;if(library.boards.some(b=>b.id===id))id=uid();library.boards.push({...board,id});}
  for(const trip of clean.trips){if(library.trips.length>=50)break;let id=trip.id;if(library.trips.some(t=>t.id===id))id=uid();library.trips.push({...trip,id});}
  return library;
}
export function encodeShare(payload){
  const bytes=new TextEncoder().encode(JSON.stringify(payload));
  if(bytes.length>18000)throw new Error('This share is too large for a reliable link. Export it as JSON instead.');
  let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function decodeShare(encoded){
  if(typeof encoded!=='string'||encoded.length>26000)throw new Error('Invalid or oversized share link.');
  const raw=atob(encoded.replace(/-/g,'+').replace(/_/g,'/'));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0))));
}
export function newId(){return uid();}
