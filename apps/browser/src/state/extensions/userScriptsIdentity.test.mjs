import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

for (const [name, engines, expected] of [
  ["a Space reassigned since the saved status", { "": { ok: true } }, ["work"]],
  ["a legacy status containing names only", null, ["", "work"]],
  ["a renamed Space with a matching engine", { work: { ok: true } }, [""]],
  ["a failed engine outcome", { "": { ok: true }, work: { error: "retry" } }, ["work"]],
]) test(`scripts verify the engine after restart: ${name}`, () => {
  const script = `
    import assert from 'node:assert/strict';
    const calls=[];
    const installed=new Map();
    const saved={version:1,generation:5,spaces:{Personal:{ok:true}},engines:${JSON.stringify(engines)}};
    globalThis.acTestUserScripts={watching:[],writes:[],status:JSON.stringify(saved),change:null,read:async()=>({state:'ready',generation:5,path:'/tmp/scripts/extension',token:'same'}),engine:{
      list:async(profile)=>installed.get(profile)??[],
      install:async(path,profile)=>{calls.push(profile);installed.set(profile,[{id:'abc',enabled:true,path,errors:[]}]);return 'abc';},
      reload:async()=>{},uninstall:async()=>{}
    }};
    const {useBrowser}=await import(${JSON.stringify(new URL("../browser/store.ts", import.meta.url).href)});
    useBrowser.getState().hydrate({});
    const s=useBrowser.getState();
    useBrowser.setState({profiles:{default:{id:'default',name:'Personal',engineId:''},work:{id:'work',name:'Work',engineId:'work'}},spaces:{default:{...s.spaces.default,profileId:'work'}},settings:{...s.settings,cliControl:true}});
    const {startUserScripts}=await import(${JSON.stringify(new URL("./userScripts.ts", import.meta.url).href)});
    startUserScripts();
    for(let i=0;i<20;i++)await new Promise(setImmediate);
    assert.deepEqual(calls.sort(),${JSON.stringify(expected)}.sort());
    const status=globalThis.acTestUserScripts.writes.at(-1);
    assert.deepEqual(status.engines,{'':{ok:true},work:{ok:true}});
    assert.deepEqual(status.spaces,{Personal:{ok:true},'Personal (2)':{ok:true}});
  `;
  const result = execFileSync(process.execPath, ["--no-warnings", "--import", new URL("../../test-loader.mjs", import.meta.url).pathname, "--input-type=module", "-e", script], { timeout: 10000, encoding: "utf8" });
  assert.equal(result, "");
});
