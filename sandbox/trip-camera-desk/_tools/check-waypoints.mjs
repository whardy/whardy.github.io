import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createCameraMap,validWaypoint} from '../map.js';
import {cleanPoint} from '../store.js';

// Exercise the actual map controller with incomplete route drafts. The Leaflet
// substitute rejects invalid marker positions just as the browser library does.
const original=new Map();const install=(key,value)=>{original.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});};
const added=[];const bounds={pad(){return this;},getSouth:()=>30,getWest:()=>-130,getNorth:()=>50,getEast:()=>-65};
const map={fitBounds(){},on(){},off(){},getBounds:()=>bounds,invalidateSize(){},stop(){},remove(){}};
const group=()=>({addTo(){return this;},clearLayers(){}});
const L={map:()=>map,tileLayer:()=>({addTo(){}}),layerGroup:group,control:()=>({addTo(){this.onAdd();}}),DomEvent:{disableClickPropagation(){}},divIcon:value=>value,marker(position,options){assert.ok(position.every(Number.isFinite),'Leaflet must never receive null/invalid route coordinates');const record={position,options};added.push(record);return {addTo(){return this;},bindTooltip(){return this;}};}};
const element={setAttribute(){},addEventListener(){},classList:{remove(){},add(){}}};
install('window',{L});install('document',{getElementById:()=>({}),createElement:()=>({setAttribute(){},append(){}})});install('requestAnimationFrame',()=>1);install('cancelAnimationFrame',()=>{});
try{
 const controller=createCameraMap(element);
 const invalid=[null,{lat:null,lon:null},{lat:'',lon:''},{lat:NaN,lon:-122},{lat:false,lon:-122},{lat:45,lon:Infinity},{lat:90,lon:-122}];
 for(const point of invalid)assert.ok(!validWaypoint(point));
 controller.setPoints([{key:'from',name:'Unconfirmed start',lat:null,lon:null},{key:'to',name:'Seattle',lat:47.6062,lon:-122.3321}]);
 assert.equal(added.length,1);assert.deepEqual(added[0].position,[47.6062,-122.3321]);assert.match(added[0].options.icon.html,/>B</,'A missing start must not rename the destination marker');
 controller.setRoutes([],null,[{name:'Portland',lat:'45.52',lon:'-122.675'},...invalid]);
 assert.deepEqual(added.at(-1).position,[45.52,-122.675]);
 const before=added.length;controller.setPoints(invalid);controller.setPoints(null);controller.setRoutes([],null,null);assert.equal(added.length,before);
 await Promise.resolve();controller.destroy();
}finally{for(const [key,descriptor]of original){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}

// Submit coordinate text through the real application helper, retaining the
// waypoint keys while resolving both edited inputs in one action.
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const helpers=source.split('\n').filter(line=>line.startsWith('function parseCoordinates(')||line.startsWith('function resolveTypedCoordinates(')).join('\n');
const inputs={from:{value:'45.52, -122.675'},to:{value:'47.6062, -122.3321'}};
const model={points:[{key:'from',name:'Draft start',lat:null,lon:null},{key:'to',name:'Draft destination',lat:null,lon:null}]};let setCalls=0;
const context={model,cleanPoint,inputFor:key=>inputs[key],cameraMap:{setPoints(points){setCalls++;assert.equal(points,model.points);}}};
vm.runInNewContext(helpers+'\nglobalThis.resolve=resolveTypedCoordinates;',context);context.resolve();
assert.ok(model.points.every(cleanPoint));assert.equal(model.points[0].key,'from');assert.equal(model.points[1].key,'to');assert.equal(setCalls,1);
model.points[0].lat=model.points[0].lon=null;inputs.from.value='Unconfirmed address';context.resolve();assert.equal(cleanPoint(model.points[0]),null,'Unconfirmed place text stays a draft and must prompt for selection');
assert.match(source,/const valid=cleanTrip\(trip\);if\(!valid\)/,'Saved-trip loading validates locations before modifying the draft');
console.log('Passed actual map/controller draft regression: null/blank/NaN waypoints stay off Leaflet, destination labels survive missing starts, coordinate submission resolves both fields, invalid place text remains actionable, and saved trips are validated.');
