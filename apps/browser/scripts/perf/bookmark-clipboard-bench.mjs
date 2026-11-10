import { readFile } from 'node:fs/promises';
const { useBrowser } = await import('../../src/state/browser/store.ts');
const { ensureRoots, rootIdsFor, newBookmarkId } = await import('../../src/state/bookmarks/bookmarks.ts');
const { copyBookmarkNodes, cutBookmarkNodes, pasteBookmarkNodes } = await import('../../src/state/bookmarks/bookmarkClipboard.ts');
const S=()=>useBrowser.getState();S().hydrate({});
const personal=S().profiles.default;useBrowser.setState({profiles:{...S().profiles,work:{...personal,id:'work',name:'Work',dataId:'work'}},profileOrder:[...S().profileOrder,'work']});
const fixture=process.argv[2]??'/tmp/ardia-bookmark-bench/links-32000.json';
const rows=JSON.parse(await readFile(fixture,'utf8'));
const [b1,r1]=ensureRoots(S().bookmarks,personal.dataId??'default');
const wp=S().profiles.work;const [b2,r2]=ensureRoots(b1,wp.dataId??'work');
const src=newBookmarkId(),same=newBookmarkId(),cross=newBookmarkId(),ids=rows.map(()=>newBookmarkId());
const nodes={...b2.nodes,[r1.other]:{...b2.nodes[r1.other],children:[src,same]},[r2.other]:{...b2.nodes[r2.other],children:[cross]},[src]:{kind:'folder',id:src,parentId:r1.other,title:'Source',children:ids,addedAt:1},[same]:{kind:'folder',id:same,parentId:r1.other,title:'Same profile',children:[],addedAt:1},[cross]:{kind:'folder',id:cross,parentId:r2.other,title:'Other profile',children:[],addedAt:1}};
for(let i=0;i<rows.length;i++)nodes[ids[i]]={kind:'url',id:ids[i],parentId:src,title:rows[i].title,url:rows[i].url,favicon:null,addedAt:i};
const base={nodes};useBrowser.setState({bookmarks:base});
const counts=[5,100,500,1000,2000,4000,8000,16000,32000],out=[];
const summary=a=>{const b=[...a].sort((x,y)=>x-y);return {p50:b[Math.floor(b.length*.5)],p95:b[Math.ceil(b.length*.95)-1],n:b.length}};
for(const n of counts){const selected=ids.slice(0,n),selectedSet=new Set(selected),copy=[],pasteSame=[],pasteCross=[],cut=[],cutPasteSame=[],cutPasteCross=[];let valid=true;
 for(let r=0;r<3;r++){
  useBrowser.setState({bookmarks:base});let t=performance.now();copyBookmarkNodes(selected);copy.push(performance.now()-t);
  t=performance.now();let made=pasteBookmarkNodes('default',same,0);pasteSame.push(performance.now()-t);
  const b=S().bookmarks,children=b.nodes[same].children.slice(0,n);if(made.length!==n||children.length!==n||children.some((id,i)=>id===selected[i])||new Set(children).size!==n)valid=false;
  useBrowser.setState({bookmarks:base});copyBookmarkNodes(selected);t=performance.now();made=pasteBookmarkNodes('work',cross,0);pasteCross.push(performance.now()-t);if(made.length!==n||new Set(made).size!==n||made.some(id=>selectedSet.has(id)))valid=false;
  useBrowser.setState({bookmarks:base});t=performance.now();cutBookmarkNodes(selected);cut.push(performance.now()-t);if(S().bookmarks.nodes[src].children.length!==32000-n)valid=false;
  t=performance.now();made=pasteBookmarkNodes('default',same,0);cutPasteSame.push(performance.now()-t);if(made.length!==n||made.some((id,i)=>id!==selected[i]))valid=false;
  useBrowser.setState({bookmarks:base});cutBookmarkNodes(selected);t=performance.now();made=pasteBookmarkNodes('work',cross,0);cutPasteCross.push(performance.now()-t);if(made.length!==n||made.some((id,i)=>id!==selected[i]))valid=false;
 }
 out.push({selected:n,copy:summary(copy),pasteCopySame:summary(pasteSame),pasteCopyCross:summary(pasteCross),cut:summary(cut),pasteCutSame:summary(cutPasteSame),pasteCutCross:summary(cutPasteCross),valid});console.log(JSON.stringify(out.at(-1)));
}
console.log(JSON.stringify(out));
