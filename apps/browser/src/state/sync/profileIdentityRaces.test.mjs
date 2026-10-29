import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { Clock, emptyScope, syncScope } from "@ardia/sync";
import { useBrowser } from "../browser/store.ts";
import { historyOf } from "../history/history.ts";
import { startHistory, reloadHistory } from "../history/engineSync.ts";
import { startBookmarks, reloadBookmarks } from "../bookmarks/engineSync.ts";
import { createProfileSync } from "./profileSync.ts";
import { emptyDoc } from "./syncDoc.ts";
import * as stub from "../../test-native/index.ts";
const S=()=>useBrowser.getState();
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture() {
  S().hydrate({});stub.docs.clear();stub.historyDbs.clear();stub.bookmarkDbs.clear();stub.bookmarkOpsSent.length=0;
  const profile=S().createProfile({name:"Work"});
  const space=S().createSpace({name:"Work",profileId:profile});
  stub.chromeVisit("","https://personal.test/","Personal");
  stub.chromeVisit(profile,"https://work.test/","Work");
  for(const [engine,key,name] of [["","11111111-1111-4111-8111-111111111111","Personal"],[profile,"22222222-2222-4222-8222-222222222222","Work"]]) stub.chromeBookmarkEdit(engine,[{op:"add",id:key,k:"u",t:name,u:`https://${name.toLowerCase()}.test/`,a:1,parent:"bar",index:0}]);
  const stopHistory=startHistory();const stopBookmarks=startBookmarks();
  await reloadHistory();await reloadBookmarks();
  const doc=emptyDoc();doc.enabled=true;
  for(const key of Object.keys(doc.types))doc.types[key]=key==="bookmarks"||key==="history";
  doc.profiles={default:{syncId:"personal",enabled:true,topAppsEnabled:false},[profile]:{syncId:"work",enabled:false,topAppsEnabled:false}};
  const factory=createProfileSync(()=>doc);
  return {profile,space,doc,factory,stop:()=>{stopHistory();stopBookmarks();factory.clear();}};
}
function transportFolder() {
  const files=new Map();let count=0;
  const out={readHook:null,transport:{
    write:async(scope,payload)=>{const id=`f${++count}`;files.set(id,{scope,payload});return id;},
    read:async(scope,known)=>{await out.readHook?.();const shown=[...files].filter(([,file])=>file.scope===scope);return {files:shown.filter(([id])=>!known.includes(id)).map(([id,file])=>({id,payload:file.payload})),pending:[],damaged:[],present:shown.map(([id])=>id)};},
    remove:async(_scope,ids)=>{for(const id of ids)files.delete(id);},
  }};return out;
}

test("a cycle paused at transport read cannot publish an unsynced reassigned Profile into the old scope",async()=>{
  const f=await fixture();const folder=transportFolder();const state=emptyScope();const clock=new Clock("A");
  const run=()=>syncScope({scope:"data:personal",state,transport:folder.transport,adapters:f.factory.adapters("default"),clock,device:"A"});
  try {
    await run();
    const entered=deferred(),resume=deferred();
    folder.readHook=async()=>{entered.resolve();await resume.promise;};
    const cycle=run();await entered.promise;
    S().assignSpaceProfile("default",f.profile);
    resume.resolve();await cycle;
    assert.ok(state.records["h:https://personal.test/"]?.v,"original history must not become a deletion");
    assert.equal(state.records["h:https://work.test/"],undefined,"Work's history consent is off");
    assert.equal(state.records["bm:22222222-2222-4222-8222-222222222222"],undefined,"Work's bookmarks consent is off");
  } finally {f.stop();}
});

test("native visits while a Profile has no Spaces retain old history and never sync false deletions",async()=>{
  const f=await fixture();f.doc.profiles[f.profile].enabled=true;f.doc.types.bookmarks=false;
  const state=emptyScope(),folder=transportFolder(),clock=new Clock("A");
  const run=()=>syncScope({scope:"data:work",state,transport:folder.transport,adapters:f.factory.adapters(f.profile),clock,device:"A"});
  try {
    await run();
    S().assignSpaceProfile(f.space,"default");
    stub.chromeVisit(f.profile,"https://new.test/","New");await tick();
    S().assignSpaceProfile(f.space,f.profile);
    await run();
    assert.deepEqual({visibleOld:historyOf(S(), f.space).some(row=>row.url==="https://work.test/"),remoteOld:!!state.records["h:https://work.test/"]?.v,nativeOld:stub.chromeHistory(f.profile).has("https://work.test/")},{visibleOld:true,remoteOld:true,nativeOld:true});
  } finally {f.stop();}
});

test("joining a Profile while a native bookmark write waits preserves the pending edit",async()=>{
  const f=await fixture();const native=stub.ardiaCoreNativeModules.ArdiaBookmarks;const original=native.call.bind(native);const entered=deferred(),resume=deferred();
  const patch=mock.method(native,"call",async(name,profile,args)=>{if(name==="apply"&&profile===""){entered.resolve();await resume.promise;}return original(name,profile,args);});
  let id;
  try {
    id=S().addBookmark({spaceId:"default",url:"https://pending.test/",title:"Pending"});
    await entered.promise;
    S().assignSpaceProfile(f.space,"default");
    const kept=!!S().bookmarks.nodes[id];
    resume.resolve();await reloadBookmarks();await tick();
    assert.deepEqual({kept,local:!!S().bookmarks.nodes[id],native:stub.chromeBookmarks("").has(id),removed:stub.bookmarkOpsSent.some(op=>op.id===id&&op.op==="remove")},{kept:true,local:true,native:true,removed:false});
  } finally {resume.resolve();patch.mock.restore();f.stop();}
});

test("history apply cannot write its completed native result into a newly reassigned Space",async()=>{
  const f=await fixture();
  const adapters=f.factory.adapters("default");const history=adapters.find(adapter=>adapter.prefix==="h:");const bookmarks=adapters.find(adapter=>adapter.prefix==="bm:");
  const native=stub.ardiaCoreNativeModules.ArdiaHistory,original=native.call.bind(native),entered=deferred(),resume=deferred();
  const patch=mock.method(native,"call",async(name,profile,args)=>{if(name==="add"&&profile===""){entered.resolve();await resume.promise;}return original(name,profile,args);});
  try {
    const key="h:https://remote.test/";
    const applying=history.apply(new Map([[key,{t:"Remote",n:1,vt:[Date.now()]}]]),new Set([key]),()=>undefined,{known:()=>true});
    await entered.promise;
    S().assignSpaceProfile("default",f.profile);
    resume.resolve();
    assert.equal(await applying,false);
    assert.ok(!historyOf(S(), "default").some(row=>row.url==="https://remote.test/"));
    assert.ok(stub.chromeHistory("").has("https://remote.test/"));
    assert.ok(!stub.chromeHistory(f.profile).has("https://remote.test/"));
    assert.equal(await history.extract(()=>undefined),null);
    assert.equal(await bookmarks.extract(()=>undefined),null);
    assert.equal(await bookmarks.apply(new Map(),new Set(),()=>undefined,{}),false);
    S().assignSpaceProfile("default","default");
    f.doc.profiles.default.enabled=false;
    assert.equal(await history.extract(()=>undefined),null);
    assert.equal(await bookmarks.extract(()=>undefined),null);
  } finally {resume.resolve();patch.mock.restore();f.stop();}
});
