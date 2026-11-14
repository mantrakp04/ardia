import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, reporter, session } from "../../../scripts/lib/instance.mjs";

const [appArg, outputArg] = process.argv.slice(2);
if (!appArg) throw new Error("usage: node sidebar-scale-test.mjs <Debug Ardia.app> [output directory]");
const output = outputArg ? resolve(outputArg) : mkdtempSync(join(tmpdir(), "ac-sidebar-scale-"));
mkdirSync(output, { recursive: true });
const only = process.argv.find(a => a.startsWith("--only="))?.slice(7);
const rep = reporter(join(output, "results.log"), { name: "sidebar-scale-test" });
const ids = ["p1", "p2", "p3", "p4", "p5", ...Array.from({ length: 10 }, (_, n) => `t${n}`)];
const fixture = session({ tabs: ids.map((id) => ({ id, url: "about:blank", title: `Scale ${id}`, customTitle: `Scale ${id}`, pinned: id.startsWith("p") })), windows: [{ id: "w1", activeTabIds: { default: "t0" } }] });
const helpers = `
const st = () => ac.store.getState();
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const controller = () => globalThis.sidebarDrag;
const items = () => [...controller().items.values()];
const frame = (item) => new Promise(r => item && item.view ? (item.header || item.view).measureInWindow((x,y,w,h) => r({x,y,w,h})) : r(null));
const act = (action) => ac.engine.call("windows.list").then(ws => ac.engine.call("windows.dev", {window: ws.find(w=>w.hasRoot).window, action}));
`;
const check = (name, fn) => !only || name.includes(only) ? rep.check(name, fn) : Promise.resolve();
let app;
try {
  app = await launch(resolve(appArg), { data: join(output, "data"), session: fixture, onboarded: true });
  const run = body => app.eval(helpers + body, { timeout: 30000 });
  const frames = [];
  await run('return act("fakeActiveClicks");');
  const drag = async (source, target, edge = "before") => {
    const points = await run(`return Promise.all([frame(items().find(i=>${source})),frame(items().find(i=>${target}))]);`);
    assert.ok(points.every(p => p && p.w > 0), JSON.stringify(points));
    const [a,b] = points;
    const sx = Math.round(a.x + Math.min(a.w/2, 45)), sy = Math.round(a.y+a.h/2);
    const tx = Math.round(b.x + (edge === "tile" ? 3 : Math.min(b.w/2,45))), ty = Math.round(edge === "before" ? b.y+1 : b.y+b.h/2);
    const path = [[sx,sy],[sx+3,sy-14],[sx+7,sy-25],[tx,Math.round((sy+ty)/2)],[tx,ty],[tx,ty],[tx,ty]].map(p=>p.join(",")).join(";");
    console.log("drag",source,points,path);
    const trace = await run(`const trace=[];const timer=setInterval(()=>{const d=controller().session;if(d)trace.push({sources:d.sources.map(i=>i.key),drop:d.drop,pointer:d.pointer,folder:d.regionFrames.get("folder"),away:controller().marks.getState().folderAway});},120);return ac.shell.devSetPointer("w1", {x:${sx},y:${sy}}).then(()=>wait(100)).then(()=>act(${JSON.stringify("drag:"+path)})).then(()=>wait(1500)).then(()=>{ let tries=0; const settled=()=>!controller().session ? wait(300) : ++tries>30 ? Promise.reject(new Error("native drag did not finish")) : wait(100).then(settled); return settled(); }).then(()=>wait(800)).then(()=>{clearInterval(timer);return trace;});`);
    rep.log(JSON.stringify(trace));
  };
  for (const scale of [80,120]) for (const addressBar of ["toolbar","sidebar"]) {
    const name = `${scale}-${addressBar}`;
    await run(`st().updateSettings({sidebarScale:${scale},addressBar:${JSON.stringify(addressBar)},appearance:"light",sidebarWidth:260}); controller().scroll.scrollTo({y:0,animated:false}); return wait(700);`);
    await check(`${name}: native row reorder`, async()=>{
      const order = await run('return st().windows.w1.tabIds.filter(id=>!st().tabs[id].pin && !Object.values(st().groups).some(g=>g.tabIds.includes(id)));');
      const [first,second,third] = order;
      await drag(`i.kind==="row" && i.tabIds.includes(${JSON.stringify(third)})`,`i.kind==="row" && i.tabIds.includes(${JSON.stringify(first)})`);
      const result=await run('return st().windows.w1.tabIds;');
      assert.ok(result.indexOf(third)<result.indexOf(first), result.join());
    });
    await check(`${name}: native tile reorder`,async()=>{
      await drag('i.kind==="tile" && i.tabIds.includes("p3")','i.kind==="tile" && i.tabIds.includes("p1")',"tile");
      const result=await run('return st().windows.w1.tabIds;');
      assert.ok(result.indexOf("p3")<result.indexOf("p1"), result.join());
      await run('st().placeTabs(["p3"],{pinned:true,beforeId:"p4"}); return wait(400);');
    });
    await check(`${name}: nested groups and native group reorder`,async()=>{
      await run('if (!globalThis.scaleOuter) { globalThis.scaleOuter=st().createGroup(["t6","t7"],{name:"Outer group"}); globalThis.scaleInner=st().createGroup(["t8","t9"],{name:"Inner group"}); st().moveGroup(scaleInner,{pinned:false,parentId:scaleOuter}); } st().updateGroup(scaleOuter,{collapsed:false,pinned:false}); return wait(500);');
      const measured=await run('return Promise.all([ac.sidebarRows.measureRow("w1","t6"),ac.sidebarRows.measureRow("w1","t8")]);');
      assert.ok(measured[0] && measured[1] && measured[1].x>measured[0].x, JSON.stringify(measured));
      frames.push({name,nested:measured});
      await run('st().updateGroup(scaleOuter,{collapsed:true}); return wait(500);');
      await drag('i.kind==="group" && i.groupId===scaleOuter','i.kind==="row" && i.tabIds.includes("t0")');
      const order=await run('return st().windows.w1.tabIds;');
      assert.ok(order.indexOf("t6")<order.indexOf("t0"),order.join());
      await run('st().moveGroup(scaleOuter,{pinned:false,beforeId:null}); return wait(400);');
    });
    await check(`${name}: folder-panel drag reorder`,async()=>{
      await run('st().placeTabs(["p4","p5"],{pinned:true,tileFolder:{id:"scale-folder",name:"Scale folder"},beforeId:null}); return wait(500);');
      const f=await run('return frame(items().find(i=>i.kind==="tile" && i.folderId==="scale-folder"));');
      assert.ok(f);
      const x=Math.round(f.x+f.w/2),y=Math.round(f.y+f.h/2);
      await run(`return act("mouse:down:${x},${y}").then(()=>wait(80)).then(()=>act("mouse:up:${x},${y}")).then(()=>wait(700));`);
      await run(`return ac.shell.devSnapshotWindow("w1",${JSON.stringify(join(output,name+"-before-folder.png"))});`);
      await drag('i.section==="folder" && i.kind==="row" && i.tabIds.includes("p5")','i.section==="folder" && i.kind==="row" && i.tabIds.includes("p4")');
      const order=await run('return st().windows.w1.tabIds;');
      assert.ok(order.indexOf("p5")<order.indexOf("p4"),order.join());
      await run(`return ac.shell.devSnapshotWindow("w1",${JSON.stringify(join(output,name+"-folder.png"))});`);
      await run('st().placeTabs(["p4","p5"],{pinned:true,beforeId:null}); return wait(500);');
    });
    await run(`return ac.shell.devSnapshotWindow("w1",${JSON.stringify(join(output,name+".png"))});`);
  }
  writeFileSync(join(output,"geometry.json"),JSON.stringify(frames,null,2));
} catch(error) { rep.record("setup",{error}); }
finally { await app?.quit(); }
process.exit(rep.summary()?0:1);
