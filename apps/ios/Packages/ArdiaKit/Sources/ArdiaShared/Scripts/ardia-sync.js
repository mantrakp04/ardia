"use strict";
(function () {
const __factories = new Map();
const __cache = new Map();
const __define = (path, factory) => __factories.set(path, factory);
const __export = (target, name, get) => Object.defineProperty(target, name, { get, enumerable: true, configurable: true });
const __exportAll = (target, source) => { for (const name of Object.keys(source)) if (name !== "default" && !(name in target)) __export(target, name, () => source[name]); };
const __require = (path) => {
  if (__cache.has(path)) return __cache.get(path);
  const exports = {};
  __cache.set(path, exports);
  __factories.get(path)(exports, __require);
  return exports;
};
__define("packages/sync/src/companion/index.ts", function (exports, __require) {
  __exportAll(exports, __require("packages/sync/src/canon.ts"));
  __exportAll(exports, __require("packages/sync/src/hlc.ts"));
  __exportAll(exports, __require("packages/sync/src/order.ts"));
  __exportAll(exports, __require("packages/sync/src/scope.ts"));
  __exportAll(exports, __require("packages/sync/src/companion/cycle.ts"));






});
__define("packages/sync/src/canon.ts", function (exports, __require) {
  __export(exports, "canonical", () => canonical);
function canonical(value         )         {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value         )          {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out                          = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value                           )[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

});
__define("packages/sync/src/hlc.ts", function (exports, __require) {
  __export(exports, "hlcWall", () => hlcWall);
  __export(exports, "Clock", () => Clock);
                         

const WALL_DIGITS = 9;
const COUNTER_DIGITS = 4;

const formatHLC = (wall        , counter        , device        )      =>
  `${Math.max(0, Math.floor(wall)).toString(36).padStart(WALL_DIGITS, "0")}.${counter.toString(36).padStart(COUNTER_DIGITS, "0")}.${device}`;

function parseHLC(h     )                                                    {
  const [wall = "0", counter = "0", ...device] = h.split(".");
  return { wall: parseInt(wall, 36), counter: parseInt(counter, 36), device: device.join(".") };
}

const hlcWall = (h     ) => parseInt(h.slice(0, WALL_DIGITS), 36);

class Clock {
          wall = 0;
          counter = 0;
           device        ;
                   now              ;

  constructor(device        , last             , now               = Date.now) {
    this.device = device;
    this.now = now;
    if (last) this.observe(last);
  }

  tick()      {
    const t = this.now();
    if (t > this.wall) {
      this.wall = t;
      this.counter = 0;
    } else {
      this.counter++;
    }
    return formatHLC(this.wall, this.counter, this.device);
  }

  at(time        )      {
    return formatHLC(Math.min(time, this.now()), 0, this.device);
  }

  observe(h     ) {
    const { wall, counter } = parseHLC(h);
    if (wall > this.wall || (wall === this.wall && counter > this.counter)) {
      this.wall = wall;
      this.counter = counter;
    }
  }

  get last()      {
    return formatHLC(this.wall, this.counter, this.device);
  }
}

});
__define("packages/sync/src/order.ts", function (exports, __require) {
  __export(exports, "assignPositions", () => assignPositions);
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;
const digit = (c                    ) => (c === undefined ? 0 : DIGITS.indexOf(c));

function positionBetween(a        , b               )         {
  if (b !== null && a >= b) throw new Error(`positionBetween: ${a} >= ${b}`);
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + positionBetween(a.slice(n), b.slice(n));
  }
  const da = digit(a[0]);
  const db = b !== null ? digit(b[0]) : BASE;
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)] ;
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[da]  + positionBetween(a.slice(1), null);
}

function assignPositions(existing                        )           {
  const tails           = [];
  const previous = new Array        (existing.length).fill(-1);
  existing.forEach((p, i) => {
    if (p === undefined || !p || p.endsWith("0")) return;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (existing[tails[mid] ]  < p) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[i] = tails[lo - 1] ;
    tails[lo] = i;
  });
  const keep = new Set        ();
  for (let i = tails.length ? tails[tails.length - 1]  : -1; i >= 0; i = previous[i] ) keep.add(i);

  const out = new Array        (existing.length);
  for (const i of keep) out[i] = existing[i] ;
  let before = "";
  for (let i = 0; i < existing.length; i++) {
    if (keep.has(i)) {
      before = out[i] ;
      continue;
    }
    let next                = null;
    for (let j = i + 1; j < existing.length; j++) {
      if (keep.has(j)) {
        next = out[j] ;
        break;
      }
    }
    out[i] = positionBetween(before, next);
    before = out[i] ;
  }
  return out;
}

});
__define("packages/sync/src/scope.ts", function (exports, __require) {
  __export(exports, "emptyScope", () => emptyScope);
  __export(exports, "covered", () => covered);
  __export(exports, "ingestSnapshot", () => ingestSnapshot);
  __export(exports, "visible", () => visible);
  __export(exports, "publish", () => publish);
  __export(exports, "flush", () => flush);
  __export(exports, "restoreJournal", () => restoreJournal);
  __export(exports, "writtenSeq", () => writtenSeq);
  __export(exports, "pull", () => pull);
  __export(exports, "compact", () => compact);
  __export(exports, "syncScope", () => syncScope);
const { canonical } = __require("packages/sync/src/canon.ts");
const { hlcWall } = __require("packages/sync/src/hlc.ts");

                                                   
                                                           
                                                   

                                                                                                
                            
       
                   
                 
             
                             
                               
                                      
  
                                              

                                                                                                                  

                          
                                      
                               
                      
                             
                                  
                                  
                                  
                                        
              
               
                      
                               
                  
                        
                                                 
                     
                  
  

const emptyScope = ()             => ({
  records: {},
  base: {},
  unapplied: [],
  vv: {},
  extra: {},
  files: {},
  damaged: {},
  seq: 0,
  outbox: [],
  seen: {},
  joined: false,
  snapshotAt: 0,
  pending: 0,
});

                            
                                                         
                                                         
                                                      
 

                       
                                           
                    
                                         
                    
  

                          
                               
                                    
                                       
                                          
  

                            
                              
              
                  
                  
  

                          
                 
          
                                   
                                     
                
                                    
                                     
                                            
                                                    
                                                                                                                                                              
                                                
                              
                             
 

                            
                                                                  
                        
                             
                           
                      
                         
                                                  
  

const DEFAULTS                                          = {
  expired: () => false,
  tombstoneTTL: 45 * 86_400_000,
  compactAfterFiles: 40,
  compactInterval: 10 * 60_000,
  pruneGrace: 60 * 60_000,
  damagedGiveUp: 86_400_000,
};

const covered = (vv                        , [device, seq]        ) => (vv[device] ?? 0) >= seq;

function markApplied(state            , device        , seq        ) {
  if (covered(state.vv, [device, seq])) return;
  const extra = new Set(state.extra[device] ?? []);
  extra.add(seq);
  let top = state.vv[device] ?? 0;
  while (extra.delete(top + 1)) top++;
  state.vv[device] = top;
  if (extra.size) state.extra[device] = [...extra].sort((a, b) => a - b);
  else delete state.extra[device];
}

const isApplied = (state            , [device, seq]        ) =>
  covered(state.vv, [device, seq]) || (state.extra[device]?.includes(seq) ?? false);

function see(state            , device        , at        ) {
  if (!(device in state.seen) || at > state.seen[device] ) state.seen[device] = at;
}

function mergeRecord(state            , key        , record            , clock       )          {
  clock.observe(record.h);
  const current = state.records[key];
  if (current && current.h >= record.h) return false;
  state.records[key] = record;
  return true;
}

function ingestLog(state            , file         , clock       , changed             ) {
  see(state, file.device, file.at);
  if (isApplied(state, [file.device, file.seq])) return;
  for (const op of file.ops) {
    if (mergeRecord(state, op.k, { h: op.h, v: op.v, o: [file.device, file.seq] }, clock)) changed.add(op.k);
  }
  markApplied(state, file.device, file.seq);
}

function ingestSnapshot(state            , file              , clock       , changed             ) {
  for (const [device, at] of Object.entries(file.seen)) see(state, device, at);
  see(state, file.device, file.at);
  for (const [key, record] of Object.entries(file.records)) {
    if (!(key in state.records) && isApplied(state, record.o)) continue;
    if (mergeRecord(state, key, record, clock)) changed.add(key);
  }
  for (const [key, record] of Object.entries(state.records)) {
    if (!(key in file.records) && covered(file.vv, record.o)) {
      delete state.records[key];
      changed.add(key);
    }
  }
  for (const [device, seq] of Object.entries(file.vv)) {
    if (seq > (state.vv[device] ?? 0)) {
      state.vv[device] = seq;
      const extra = (state.extra[device] ?? []).filter((s) => s > seq);
      for (let top = seq; extra[0] === top + 1; top++) state.vv[device] = extra.shift() ;
      if (extra.length) state.extra[device] = extra;
      else delete state.extra[device];
    }
  }
}

function visible(state            , prefix        )                       {
  const out = new Map                 ();
  for (const [key, record] of Object.entries(state.records)) {
    if (record.v !== null && key.startsWith(prefix)) out.set(key, record.v);
  }
  return out;
}

const parseBase = (json                    ) => (json === undefined ? undefined : (JSON.parse(json)           ));

const settling = new WeakMap                            ();
const waitingAfterPull = new WeakMap                     ();

function settleWhenDurable(state            , settle            ) {
  const queue = settling.get(state);
  if (queue) queue.push(settle);
  else settling.set(state, [settle]);
}

function settleDurable(state            ) {
  const queue = settling.get(state);
  if (!queue) return;
  settling.delete(state);
  for (const settle of queue) settle();
}

async function publishAdapter(state            , adapter         , clock       , device        , now        )                       {
  const published = new Set        ();
  if (adapter.adoptRemoteOnJoin && !state.joined) return published;
  if (adapter.publishAfterPull && waitingAfterPull.get(state) !== false) return published;
  let pending                     = null;
  const queued = (key        ) => (pending ??= new Set([...state.outbox, ...(state.journal ?? []).flatMap((f) => f.ops)].map((op) => op.k))).has(key);
  const extraction = await adapter.extract((key) => parseBase(state.base[key]), queued, now, (key) => key in state.records, (key) => state.records[key]?.v, (key) => state.records[key]?.h);
  if (!extraction) return published;
  const put = (key        , value         ) => {
    const known = state.records[key];
    const editedAt = !known && value !== null ? adapter.editedAt?.(value) : undefined;
    const h = editedAt !== undefined ? clock.at(editedAt) : clock.tick();
    if (known && known.h >= h) return;
    state.records[key] = { h, v: value, o: [device, state.seq + 1] };
    state.outbox.push({ k: key, h, v: value });
    published.add(key);
  };
  for (const [key, value] of extraction.values) {
    if (value === null || value === undefined) throw new Error(`[sync] ${key}: a live value can't be null`);
    const json = canonical(value);
    if (state.base[key] === json && !extraction.republish?.(key)) continue;
    state.base[key] = json;
    put(key, value);
  }
  for (const key of Object.keys(state.base)) {
    if (!key.startsWith(adapter.prefix) || extraction.values.has(key) || extraction.ignore?.(key)) continue;
    delete state.base[key];
    put(key, null);
  }
  const { published: settle } = extraction;
  if (settle && published.size) settleWhenDurable(state, () => settle(published));
  return published;
}

async function publish(state            , adapters           , clock       , device        , now = Date.now())                       {
  const published = new Set        ();
  for (const adapter of adapters) for (const key of await publishAdapter(state, adapter, clock, device, now)) published.add(key);
  return published;
}

async function flush(state            , transport           , scope        , device        , now        , options               = {}) {
  if (state.outbox.length) {
    state.seq++;
    (state.journal ??= []).push({ v: 1, kind: "log", device, seq: state.seq, at: now, ops: state.outbox });
    state.outbox = [];
  }
  if (!state.journal?.length) return;
  if (options.persist) {
    await options.persist(state.journal);
    settleDurable(state);
  }
  while (state.journal.length) {
    const file = state.journal[0] ;
    const id = await transport.write(scope, JSON.stringify(file));
    state.files[id] = { d: file.device, k: "log", s: file.seq, at: file.at };
    state.journal.shift();
    markApplied(state, file.device, file.seq);
    see(state, file.device, now);
  }
  delete state.journal;
  settleDurable(state);
}

function restoreJournal(state            , batches           , clock       , written = 0) {
  const saved = state.seq;
  for (const file of [...batches].sort((a, b) => a.seq - b.seq)) {
    if (file.seq <= state.seq) continue;
    if (file.seq === saved + 1) state.outbox = [];
    for (const op of file.ops) {
      mergeRecord(state, op.k, { h: op.h, v: op.v, o: [file.device, file.seq] }, clock);
      if (op.v === null) delete state.base[op.k];
      else state.base[op.k] = canonical(op.v);
    }
    state.seq = file.seq;
    if (file.seq <= written) markApplied(state, file.device, file.seq);
    else (state.journal ??= []).push(file);
  }
  state.seq = Math.max(state.seq, written);
}

const writtenSeq = (state            ) => state.seq - (state.journal?.length ?? 0);

async function pull(state            , transport           , scope        , clock       , now        , options               = {}) {
  const { damagedGiveUp } = { ...DEFAULTS, ...options };
  const listing = await transport.read(scope, Object.keys(state.files));
  const changed = new Set        ();
  const parsed                                   = [];
  const bad = (id        ) => {
    state.damaged[id] = Math.min(state.damaged[id] ?? now, now);
    if (now - state.damaged[id]  > damagedGiveUp) {
      state.files[id] = { d: "", k: "bad", at: now };
      delete state.damaged[id];
    }
  };
  for (const { id, payload } of listing.files) {
    try {
      const file = JSON.parse(payload)            ;
      if (file.v !== 1 || (file.kind !== "log" && file.kind !== "snapshot")) throw new Error("unknown file");
      parsed.push({ id, file });
    } catch {
      bad(id);
    }
  }
  for (const { id } of listing.damaged) bad(id);
  parsed.sort((a, b) => (a.file.kind === b.file.kind ? 0 : a.file.kind === "snapshot" ? -1 : 1));
  for (const { id, file } of parsed) {
    if (file.kind === "snapshot") {
      ingestSnapshot(state, file, clock, changed);
      state.files[id] = { d: file.device, k: "snapshot", vv: file.vv, at: file.at };
    } else {
      ingestLog(state, file, clock, changed);
      state.files[id] = { d: file.device, k: "log", s: file.seq, at: file.at };
    }
    delete state.damaged[id];
  }
  const present = new Set(listing.present);
  for (const id of Object.keys(state.files)) if (!present.has(id)) delete state.files[id];
  for (const id of Object.keys(state.damaged)) if (!present.has(id)) delete state.damaged[id];
  state.pending = listing.pending.length;
  const pendingSince                         = {};
  for (const id of listing.pending) pendingSince[id] = Math.min(state.pendingSince?.[id] ?? now, now);
  if (listing.pending.length) state.pendingSince = pendingSince;
  else delete state.pendingSince;
  const downloading = Object.values(pendingSince).some((at) => now - at <= damagedGiveUp);
  waitingAfterPull.set(state, downloading || Object.keys(state.damaged).length > 0);
  return changed;
}

async function applyAdapter(state            , adapter         , keys             , now        , horizon        )                   {
  const mine = new Set([...keys].filter((k) => k.startsWith(adapter.prefix)));
  if (!mine.size) return true;
  const view = visible(state, adapter.prefix);
  const applyAs = (state.applyAs ??= {});
  applyAs[adapter.prefix] ??= state.joined ? "joined" : "joining";
  let ok                 = false;
  try {
    ok = await adapter.apply(view, mine, (key) => parseBase(state.base[key]), { known: (key) => key in state.records, now, horizon, joined: applyAs[adapter.prefix] === "joined" });
  } catch (error) {
    console.warn(`[sync] applying ${adapter.prefix} failed`, error);
  }
  if (ok === false) return false;
  applyAs[adapter.prefix] = "joined";
  for (const key of mine) {
    if (view.has(key)) state.base[key] = canonical(view.get(key));
    else delete state.base[key];
  }
  return true;
}

async function compact(state            , transport           , scope        , device        , now        , options               = {}, force = false) {
  const o = { ...DEFAULTS, ...options };
  const count = Object.keys(state.files).length;
  const newestSnapshot = Math.max(state.snapshotAt, ...Object.values(state.files).filter((f) => f.k === "snapshot").map((f) => f.at));
  if (!force && (count <= o.compactAfterFiles || now - newestSnapshot < o.compactInterval)) return false;
  await flush(state, transport, scope, device, now, options);
  const records                             = {};
  const tombstoneTTL = Object.keys(state.extra).length ? 2 * o.tombstoneTTL : o.tombstoneTTL;
  for (const [key, record] of Object.entries(state.records)) {
    const drop = record.v === null ? now - hlcWall(record.h) > tombstoneTTL : o.expired(key, record.v, now);
    if (drop) delete state.records[key];
    else records[key] = record;
  }
  const vv = { ...state.vv };
  const file               = { v: 1, kind: "snapshot", device, at: now, vv, seen: { ...state.seen }, records };
  const id = await transport.write(scope, JSON.stringify(file));
  state.files[id] = { d: device, k: "snapshot", vv, at: now };
  state.snapshotAt = now;
  const dominated = (other                        ) => Object.entries(other).every(([d, s]) => (vv[d] ?? 0) >= s);
  const prune = Object.entries(state.files)
    .filter(([fileId, f]) => {
      if (fileId === id || now - f.at < o.pruneGrace) return false;
      if (f.k === "log") return covered(vv, [f.d, f.s ?? Infinity]);
      if (f.k === "snapshot") return dominated(f.vv ?? {});
      return false;
    })
    .map(([fileId]) => fileId);
  if (prune.length) {
    await transport.remove(scope, prune);
    for (const fileId of prune) delete state.files[fileId];
  }
  return true;
}

                                                                                                      

async function syncScope(args   
                
                    
                       
                      
               
                 
                     
                         
 )                       {
  const { scope, state, transport, adapters, clock, device, options } = args;
  const now = args.now ?? Date.now;
  let published = (await publish(state, adapters, clock, device, now())).size;
  await flush(state, transport, scope, device, now(), options);
  const changed = await pull(state, transport, scope, clock, now(), options);
  const keys = new Set([...state.unapplied, ...changed]);
  const unapplied           = [];
  for (const adapter of adapters) {
    const late = await publishAdapter(state, adapter, clock, device, now());
    published += late.size;
    for (const key of late) keys.delete(key);
    if (!(await applyAdapter(state, adapter, keys, now(), 2 * (options?.tombstoneTTL ?? DEFAULTS.tombstoneTTL)))) unapplied.push(...[...keys].filter((k) => k.startsWith(adapter.prefix)));
  }
  state.unapplied = [...unapplied, ...[...keys].filter((k) => !adapters.some((a) => k.startsWith(a.prefix)))];
  if (!state.awaitRemote || Object.keys(state.seen).some((d) => d !== device)) {
    state.joined = true;
    delete state.awaitRemote;
  }
  await flush(state, transport, scope, device, now(), options);
  const compacted = await compact(state, transport, scope, device, now(), options);
  return { published, changed: changed.size, pending: state.pending, compacted };
}

});
__define("packages/sync/src/companion/cycle.ts", function (exports, __require) {
  __export(exports, "companionLoad", () => companionLoad);
  __export(exports, "companionUnload", () => companionUnload);
  __export(exports, "companionStateUnsaved", () => companionStateUnsaved);
  __export(exports, "runCompanionCycle", () => runCompanionCycle);
  __export(exports, "companionView", () => companionView);
  __export(exports, "companionSend", () => companionSend);
  __export(exports, "companionRemovalsDone", () => companionRemovalsDone);
  __export(exports, "companionAcknowledge", () => companionAcknowledge);
  __export(exports, "companionAddBookmark", () => companionAddBookmark);
  __export(exports, "companionRemoveBookmark", () => companionRemoveBookmark);
const { Clock } = __require("packages/sync/src/hlc.ts");
const { emptyScope, restoreJournal, syncScope, visible } = __require("packages/sync/src/scope.ts");
const { bookmarksAdapter, deviceAdapter, deviceTabsAdapter, historyAdapter, historyExpired, HISTORY_WINDOW_MS, isWebUrl, sendsAdapter } = __require("packages/sync/src/companion/adapters.ts");
const { buildView, dataOwner, defaultProfileId, liveProfiles } = __require("packages/sync/src/companion/view.ts");

                                                           

                    
                        
                                                 
                                                
                                                 
                                                             
                                                         
  

                              
       
                 
                       
                                     
                       
              
                          
                                                 
                               
                                                   
                                             
                                      
                                           
  

                          
               
               
                     
                           
                               
                        
  

                                                                                                                                 
                                                                               

                           
                      
              
                       
                            
                      
                    
                  
                  
                 
  

const APP = "app";
const GHOST_MS = 30 * 86_400_000;

function removalsOf(c                )            {
  const fallback = defaultProfileId(liveProfiles(c.scopes[APP]));
  return Object.entries(c.removals ?? {})
    .filter(([, urls]) => urls.length)
    .sort(([a], [z]) => (a < z ? -1 : 1))
    .map(([profile, urls]) => ({ profile, urls: [...urls].sort(), unassigned: profile === fallback }));
}

const dueOf = (c                ) => [...new Set(Object.values(c.due ?? {}).flatMap((urls) => Object.keys(urls)))].sort();
const profileScope = (syncId        ) => `p:${syncId}`;

let companion                        = null;
let savedJSON = "";
let savedPrint = "";
let viewJSON = "";

const host = ()       => {
  const h = (globalThis                     ).__host;
  if (!h) throw new Error("the sync host isn't registered");
  return h;
};

function loaded()                 {
  if (!companion) throw new Error("the companion isn't loaded");
  return companion;
}

const freshState = (device        )                 => ({ v: 1, device, clock: null, scopes: {}, sends: [], acks: [], bookmarks: [], floors: {}, pulled: {} });

function companionLoad(input                                                                                                                                   ) {
  if (!input.state && !input.fresh) throw new Error("no saved state for this device");
  if (input.state && (input.state.v !== 1 || input.state.device !== input.device || !input.state.scopes || typeof input.state.scopes !== "object")) {
    throw new Error("the saved state belongs to another device or version");
  }
  const state = input.state ?? freshState(input.device);
  state.sends ??= [];
  state.acks ??= [];
  state.bookmarks ??= [];
  state.floors ??= {};
  state.pulled ??= {};
  state.scopes ??= {};
  state.visited ??= {};
  state.due ??= {};
  state.removals ??= {};
  state.ghosts ??= [];
  for (const id of input.ghosts ?? []) if (id !== input.device && !state.ghosts.some((g) => g.id === id)) state.ghosts.push({ id, since: Date.now() });
  const clock = new Clock(input.device, state.clock);
  let restored = false;
  for (const [scope, batches] of Object.entries(input.journal ?? {})) {
    const mine = (Array.isArray(batches) ? batches : []).filter((f) => f && f.device === input.device);
    if (!mine.length) continue;
    restoreJournal((state.scopes[scope] ??= emptyScope()), mine, clock, 0);
    restored = true;
  }
  if (restored) state.clock = clock.last;
  companion = state;
  savedJSON = "";
  savedPrint = "";
  viewJSON = "";
  return { device: state.device, scopes: Object.keys(state.scopes).length };
}

function companionUnload() {
  companion = null;
  savedJSON = "";
  savedPrint = "";
  viewJSON = "";
  return true;
}

function companionStateUnsaved() {
  savedJSON = "";
  savedPrint = "";
  return true;
}

function fingerprint(c                )         {
  const scopes = Object.keys(c.scopes)
    .sort()
    .map((name) => {
      const s = c.scopes[name] ;
      return [name, s.seq, s.journal?.length ?? 0, s.outbox.length, Object.keys(s.files).length, s.pending, Object.keys(s.damaged).length, s.unapplied.length, s.joined, JSON.stringify(s.vv), JSON.stringify(s.extra), JSON.stringify(s.seen)].join("|");
    });
  return JSON.stringify([c.clock, scopes, c.sends, c.acks, c.bookmarks, c.floors, c.pulled, c.visited, c.due, c.removals, c.ghosts]);
}

function save(force = false)          {
  const c = loaded();
  const print = fingerprint(c);
  if (!force && savedJSON && print === savedPrint) return true;
  const json = JSON.stringify(c);
  if (json === savedJSON) {
    savedPrint = print;
    return true;
  }
  const seqs = Object.fromEntries(Object.entries(c.scopes).map(([scope, s]) => [scope, s.seq]));
  if (host().saveState(json, JSON.stringify(seqs)) !== "ok") return false;
  savedJSON = json;
  savedPrint = print;
  return true;
}

const transport            = {
  read: async (scope, known) => JSON.parse(host().read(scope, JSON.stringify(known)))           ,
  write: async (scope, payload) => host().write(scope, payload),
  remove: async (scope, ids) => {
    host().remove(scope, JSON.stringify(ids));
  },
};

const persistJournal =
  (scope        ) =>
  async (batches           )                => {
    if (host().persistJournal(scope, JSON.stringify(batches.map((batch) => JSON.stringify(batch)))) !== "ok") throw new Error("couldn't save the sync journal");
  };

const scopeOptions = (scope        , profile         )               => ({
  persist: persistJournal(scope),
  compactAfterFiles: Infinity,
  ...(profile ? { expired: historyExpired } : {}),
});

function dropFrom                                          (list     , scope        , keys             )      {
  return keys.size ? list.filter((x) => x.scope !== scope || !keys.has(x.key)) : list;
}

function profileOf(app                        , profiles             , fallback               , p                           )                {
  if (p && profiles.has(p)) return p;
  return fallback;
}

async function runCompanionCycle(input            )                       {
  const c = loaded();
  const now = () => input.now ?? Date.now();
  const empty = { received: [], historyRemoved: removalsOf(c), visitsDue: dueOf(c), published: 0, changed: 0, pending: 0 };
  const status = host().chainStatus()               ;
  if (status !== "ok") return { status, ...empty, saved: save(false) };
  const clock = new Clock(c.device, c.clock, now);
  const device = c.device;
  const retiring = !!input.retiring;
  let published = 0;
  let changed = 0;
  let pending = 0;
  const run = async (scope        , adapters           , profile         ) => {
    const state = (c.scopes[scope] ??= emptyScope());
    const result = await syncScope({ scope, state, transport, adapters, clock, device, now, options: scopeOptions(scope, profile) });
    state.unapplied = state.unapplied.filter((k) => adapters.some((a) => k.startsWith(a.prefix)));
    c.pulled[scope] = true;
    published += result.published;
    changed += result.changed;
    pending += result.pending;
    return state;
  };

  c.ghosts = (c.ghosts ?? []).filter((g) => now() - g.since < GHOST_MS);
  const ghosts = c.ghosts.map((g) => g.id);
  const app = await run(APP, [deviceAdapter(device, input.name, retiring, ghosts)], false);
  if (retiring) {
    for (const scope of Object.keys(c.scopes).filter((s) => s.startsWith("p:"))) await run(scope, [deviceTabsAdapter(device, input.name, [], true, ghosts)], true);
  } else {
    const profiles = liveProfiles(app);
    const ids = new Set(profiles.keys());
    const fallback = defaultProfileId(profiles);
    const owner = new Map([...ids].map((id) => [id, dataOwner(app, id)]));
    const tabsOf = new Map                    ();
    for (const t of input.tabs ?? []) {
      const p = profileOf(app, ids, fallback, t.p);
      if (p) tabsOf.set(p, [...(tabsOf.get(p) ?? []), t]);
    }
    const visitsOf = new Map                                        ();
    const visited = (c.visited ??= {});
    for (const v of input.visits ?? []) {
      const p = profileOf(app, ids, fallback, v.p);
      if (!p || typeof v.u !== "string" || !Array.isArray(v.vt)) continue;
      const o = owner.get(p) ?? p;
      visitsOf.set(o, [...(visitsOf.get(o) ?? []), { ...v, p }]);
      const newest = Math.max(...v.vt.filter((t) => Number.isFinite(t)));
      const mine = (visited[profileScope(o)] ??= {});
      if (Number.isFinite(newest) && newest > (mine[v.u] ?? -Infinity)) mine[v.u] = newest;
    }
    for (const id of [...ids].sort()) {
      const scope = profileScope(id);
      const ownsData = owner.get(id) === id;
      const floors = (c.floors[scope] ??= {});
      for (const [url, at] of Object.entries(floors)) if (at < now() - HISTORY_WINDOW_MS) delete floors[url];
      const mine = (visited[scope] ??= {});
      for (const [url, at] of Object.entries(mine)) if (at < now() - HISTORY_WINDOW_MS) delete mine[url];
      let extracts = 0;
      const state = (c.scopes[scope] ??= emptyScope());
      const adapters            = [
        deviceTabsAdapter(device, input.name, input.tabs ? (tabsOf.get(id) ?? []) : null, false, ghosts),
        sendsAdapter({
          scope,
          sends: () => c.sends,
          acks: () => c.acks,
          drop: (s, keys) => {
            c.sends = dropFrom(c.sends, s, keys);
            c.acks = dropFrom(c.acks, s, keys);
          },
        }),
        ...(ownsData
          ? [
              historyAdapter({
                visits: visitsOf.get(id) ?? [],
                profiles: [...ids].filter((p) => owner.get(p) === id).sort(),
                state,
                floors,
                visited: mine,
                due: (url) => {
                  (c.due [scope] ??= {})[url] = true;
                },
                removed: (p, url) => {
                  const list = (c.removals [p] ??= []);
                  if (!list.includes(url)) list.push(url);
                },
                ready: () => !!input.visits && (!!c.pulled[scope] || ++extracts > 1),
              }),
              bookmarksAdapter({
                scope,
                state,
                ops: () => c.bookmarks,
                drop: (s, keys) => {
                  c.bookmarks = dropFrom(c.bookmarks, s, keys);
                },
              }),
            ]
          : []),
      ];
      await run(scope, adapters, true);
      if (!Object.keys(floors).length) delete c.floors[scope];
      if (!Object.keys(mine).length) delete visited[scope];
    }
    const fetched = new Set(input.fetchedDue ?? []);
    for (const [scope, urls] of Object.entries(c.due ?? {})) {
      for (const url of Object.keys(urls)) if (fetched.has(url) || !(url in (visited[scope] ?? {}))) delete urls[url];
      if (!Object.keys(urls).length) delete c.due [scope];
    }
  }
  c.clock = clock.last;

  const received             = [];
  if (!retiring) {
    const acked = new Set(c.acks.map((a) => `${a.scope}\n${a.key}`));
    const names = new Map([...visible(app, "dev:")].map(([k, v]) => [k.slice(4), typeof (v                   )?.n === "string" ? ((v                 ).n          ) : null]));
    for (const id of liveProfiles(app).keys()) {
      const scope = profileScope(id);
      const state = c.scopes[scope];
      if (!state) continue;
      for (const [k, v] of visible(state, "send:")) {
        const s = v             ;
        if (!s || s.to !== device || s.from === device || acked.has(`${scope}\n${k}`)) continue;
        if (typeof s.u !== "string" || !isWebUrl(s.u)) {
          c.acks.push({ scope, key: k });
          continue;
        }
        received.push({ profile: id, key: k, u: s.u, t: typeof s.t === "string" ? s.t : "", from: String(s.from ?? ""), fromName: names.get(String(s.from)) ?? null, at: Number(s.at) || 0 });
      }
    }
    received.sort((a, z) => a.at - z.at || (a.key < z.key ? -1 : 1));
  }

  const out              = {
    status,
    received,
    historyRemoved: removalsOf(c),
    visitsDue: dueOf(c),
    published,
    changed,
    pending,
    saved: save(published > 0 || changed > 0),
  };
  if (!retiring) {
    const view = buildView(c.scopes, device);
    const json = JSON.stringify(view);
    if (json !== viewJSON) {
      viewJSON = json;
      out.view = view;
    }
  }
  return out;
}

function companionView()       {
  const c = loaded();
  const view = buildView(c.scopes, c.device);
  viewJSON = JSON.stringify(view);
  return view;
}

const scopeFor = (profile        ) => profileScope(dataOwner(loaded().scopes[APP], profile));
const isLive = (profile        ) => liveProfiles(loaded().scopes[APP]).has(profile);
const refused = { saved: false, refused: true }         ;

function companionSend(input                                                                                ) {
  const c = loaded();
  if (!isLive(input.profile)) return refused;
  const key = `send:${input.key}`;
  if (!c.sends.some((s) => s.key === key)) {
    c.sends.push({ scope: profileScope(input.profile), key, value: { u: input.u, t: input.t, to: input.to, from: c.device, at: input.at } });
  }
  return { saved: save(true) };
}

function companionRemovalsDone(input                                                  ) {
  const c = loaded();
  for (const { profile, urls } of input.items) {
    const left = (c.removals?.[profile] ?? []).filter((url) => !urls.includes(url));
    if (left.length) c.removals [profile] = left;
    else delete c.removals?.[profile];
  }
  return { saved: save(true) };
}

function companionAcknowledge(input                                               ) {
  const c = loaded();
  for (const { profile, key } of input.items) {
    const scope = profileScope(profile);
    if (!c.acks.some((a) => a.scope === scope && a.key === key)) c.acks.push({ scope, key });
  }
  return { saved: save(true) };
}

function companionAddBookmark(input                                                                    ) {
  const c = loaded();
  if (!isLive(input.profile)) return refused;
  const scope = scopeFor(input.profile);
  if (!c.bookmarks.some((o) => o.scope === scope && o.key === input.key)) {
    c.bookmarks.push({ scope, op: "add", key: input.key, value: { k: "u", p: "other", t: input.t, u: input.u, a: input.at } });
  }
  return { saved: save(true) };
}

function companionRemoveBookmark(input                                  ) {
  const c = loaded();
  if (!isLive(input.profile)) return refused;
  const scope = scopeFor(input.profile);
  c.bookmarks = c.bookmarks.filter((o) => !(o.scope === scope && o.key === input.key));
  c.bookmarks.push({ scope, op: "remove", key: input.key });
  return { saved: save(true) };
}

});
__define("packages/sync/src/companion/adapters.ts", function (exports, __require) {
  __export(exports, "DAY_MS", () => DAY_MS);
  __export(exports, "HISTORY_WINDOW_MS", () => HISTORY_WINDOW_MS);
  __export(exports, "SEND_LIFETIME_MS", () => SEND_LIFETIME_MS);
  __export(exports, "MAX_DEVICE_TABS", () => MAX_DEVICE_TABS);
  __export(exports, "MAX_VISIT_TIMES", () => MAX_VISIT_TIMES);
  __export(exports, "isWebUrl", () => isWebUrl);
  __export(exports, "historyExpired", () => historyExpired);
  __export(exports, "lastVisitOf", () => lastVisitOf);
  __export(exports, "dayOf", () => dayOf);
  __export(exports, "deviceAdapter", () => deviceAdapter);
  __export(exports, "deviceTabsAdapter", () => deviceTabsAdapter);
  __export(exports, "historyAdapter", () => historyAdapter);
  __export(exports, "sendsAdapter", () => sendsAdapter);
  __export(exports, "bookmarksAdapter", () => bookmarksAdapter);
const { assignPositions } = __require("packages/sync/src/order.ts");
const { hlcWall } = __require("packages/sync/src/hlc.ts");
const { visible } = __require("packages/sync/src/scope.ts");

const DAY_MS = 86_400_000;
const HISTORY_WINDOW_MS = 90 * DAY_MS;
const SEND_LIFETIME_MS = 7 * DAY_MS;
const MAX_DEVICE_TABS = 30;
const MAX_VISIT_TIMES = 50;
const SAME_VISIT_MS = 1;

                                                                              
                                                                                          
                                                                  
                                                                                       
                                                                                                       

                                                                               
                                                                                   

                                                                           
                                                 
                        
                                                                                                   
                                                 

const isWebUrl = (url        ) => /^https?:\/\//i.test(url);

const historyExpired = (key        , value         , now        ) =>
  key.startsWith("h:") && lastVisitOf(value                ) < now - HISTORY_WINDOW_MS;

const lastVisitOf = (v                                 ) => (v && Array.isArray(v.vt) ? Math.max(0, ...v.vt) : 0);

const dayOf = (at        ) => new Date(at).toISOString().slice(0, 10).replaceAll("-", "");

function deviceAdapter(device        , name        , retiring         , ghosts           = [])          {
  const key = `dev:${device}`;
  const old = new Set(ghosts.map((g) => `dev:${g}`));
  return {
    prefix: "dev:",
    extract: (_base, _queued, now) => ({
      values: retiring ? new Map() : new Map([[key, { n: name, k: "phone", f: ["send"], s: dayOf(now) }                      ]]),
      ignore: (k) => k !== key && !old.has(k),
    }),
    apply: () => true,
  };
}

function deviceTabsAdapter(device        , name        , tabs                   , retiring         , ghosts           = [])          {
  const key = `tabs:${device}`;
  const old = new Set(ghosts.map((g) => `tabs:${g}`));
  const ignore = (k        ) => k !== key && !old.has(k);
  return {
    prefix: "tabs:",
    extract: () => {
      if (retiring) return { values: new Map(), ignore };
      if (!tabs) return old.size ? { values: new Map(), ignore: (k) => !old.has(k) } : null;
      const recent = tabs
        .filter((t) => isWebUrl(t.u))
        .sort((a, z) => z.at - a.at)
        .slice(0, MAX_DEVICE_TABS)
        .map((t) => ({ u: t.u, t: t.t }));
      return { values: new Map([[key, { n: name, k: "phone", tabs: recent }                          ]]), ignore };
    },
    apply: () => true,
  };
}

const near = (times          , t        ) => times.some((k) => Math.abs(k - t) <= SAME_VISIT_MS);

function unionTimes(a          , b          )           {
  const out           = [];
  for (const t of [...a, ...b].sort((x, y) => x - y)) if (!out.length || t - out[out.length - 1]  > SAME_VISIT_MS) out.push(t);
  return out.slice(-MAX_VISIT_TIMES);
}

                              
                                         
                     
                    
                                 
                                  
                             
                                                  
                       
  

function historyAdapter(ctx                )          {
  return {
    prefix: "h:",
    extract: (_base, _queued, now, _known, remote, stamp) => {
      if (!ctx.ready()) return null;
      const since = now - HISTORY_WINDOW_MS;
      const byUrl = new Map                                                                                   ();
      for (const v of ctx.visits) {
        if (!isWebUrl(v.u) || !Array.isArray(v.vt)) continue;
        const entry = byUrl.get(v.u) ?? { title: "", times: [], profiles: new Set(), newest: 0 };
        const times = v.vt.filter((t) => Number.isFinite(t) && t >= since);
        if (!times.length) continue;
        entry.times.push(...times);
        entry.profiles.add(v.p);
        const newest = Math.max(...times);
        if (newest >= entry.newest) {
          entry.newest = newest;
          if (v.t) entry.title = v.t;
        }
        byUrl.set(v.u, entry);
      }
      const values = new Map                 ();
      for (const [url, entry] of byUrl) {
        const key = `h:${url}`;
        const known = remote(key)                                   ;
        if (known === null) {
          const h = stamp(key);
          const deletedAt = Math.min(h ? hlcWall(h) : 0, now);
          if (deletedAt > (ctx.floors[url] ?? -Infinity)) ctx.floors[url] = deletedAt;
        }
        const floor = ctx.floors[url] ?? -Infinity;
        const local = unionTimes([], entry.times.filter((t) => t > floor));
        if (!local.length) {
          for (const p of entry.profiles) ctx.removed(p, url);
          continue;
        }
        if (!known) {
          values.set(key, { t: entry.title, n: local.length, vt: local }                       );
          continue;
        }
        const knownTimes = Array.isArray(known.vt) ? known.vt.filter((t) => Number.isFinite(t)) : [];
        const oldestKept = knownTimes.length >= MAX_VISIT_TIMES ? Math.min(...knownTimes) : -Infinity;
        const missing = local.filter((t) => t >= oldestKept && !near(knownTimes, t));
        if (!missing.length) continue;
        const vt = unionTimes(knownTimes, local);
        values.set(key, {
          t: entry.title || (typeof known.t === "string" ? known.t : ""),
          n: Math.max(typeof known.n === "number" ? known.n : 0, local.length, vt.length),
          vt,
        }                       );
      }
      return { values, ignore: (k) => !values.has(k) };
    },
    editedAt: (v) => lastVisitOf(v                ),
    apply: (visible, changed, base, records) => {
      for (const key of changed) {
        const url = key.slice(2);
        const value = visible.get(key)                            ;
        if (value) {
          const mine = ctx.visited[url];
          const times = Array.isArray(value.vt) ? value.vt : [];
          const oldestKept = times.length >= MAX_VISIT_TIMES ? Math.min(...times) : -Infinity;
          if (mine !== undefined && mine >= oldestKept && mine > (ctx.floors[url] ?? -Infinity) && !near(times, mine)) ctx.due(url);
          continue;
        }
        const tombstone = ctx.state.records[key];
        const before = base(key)                            ;
        if (!tombstone && before && lastVisitOf(before) < records.now - HISTORY_WINDOW_MS) continue;
        const deletedAt = Math.min(tombstone ? hlcWall(tombstone.h) : records.now, records.now);
        if (deletedAt > (ctx.floors[url] ?? -Infinity)) ctx.floors[url] = deletedAt;
        for (const p of ctx.profiles) ctx.removed(p, url);
      }
      return true;
    },
  };
}

                           
                
                             
                    
                                                   
  

function sendsAdapter(ctx             )          {
  return {
    prefix: "send:",
    extract: (_base, _queued, now, _known, remote) => {
      const values = new Map                 ();
      const tombstones = new Set        ();
      const gone = new Set        ();
      for (const s of ctx.sends()) {
        if (s.scope !== ctx.scope) continue;
        const record = remote(s.key);
        if (record === null) gone.add(s.key);
        else if (now - s.value.at >= SEND_LIFETIME_MS) {
          if (record === undefined) gone.add(s.key);
          else tombstones.add(s.key);
        } else values.set(s.key, s.value);
      }
      for (const a of ctx.acks()) {
        if (a.scope !== ctx.scope) continue;
        const record = remote(a.key);
        if (record === null || record === undefined) gone.add(a.key);
        else tombstones.add(a.key);
      }
      if (gone.size) ctx.drop(ctx.scope, gone);
      return {
        values,
        ignore: (k) => !tombstones.has(k),
        published: (keys) => ctx.drop(ctx.scope, new Set([...keys].filter((k) => tombstones.has(k)))),
      };
    },
    apply: () => true,
  };
}

                               
                
                    
                          
                                                   
  

const sameValue = (a         , b         ) => JSON.stringify(a) === JSON.stringify(b);

function bookmarksAdapter(ctx                 )          {
  return {
    prefix: "bm:",
    extract: (base, _queued, _now, _known, remote) => {
      const ops = ctx.ops().filter((o) => o.scope === ctx.scope);
      if (!ops.length) return { values: new Map(), ignore: () => true };
      const view = visible(ctx.state, "bm:");
      const values = new Map                 ();
      const deletes = new Set        ();
      const settled = new Set        ();
      const children = new Map                  ();
      for (const [k, v] of view) {
        const parent = (v                 ).p;
        if (typeof parent === "string") children.set(parent, [...(children.get(parent) ?? []), k.slice(3)]);
      }
      const otherPositions = [...view]
        .filter(([, v]) => (v                 ).p === "other" && typeof (v                 ).pos === "string")
        .map(([k, v]) => [(v                 ).pos, k]         )
        .sort((a, z) => (a[0] < z[0] ? -1 : a[0] > z[0] ? 1 : a[1] < z[1] ? -1 : 1))
        .map(([pos]) => pos                      );
      for (const o of ops) {
        const key = `bm:${o.key}`;
        if (o.op === "add") {
          if (o.value.pos === undefined) {
            o.value.pos = assignPositions([...otherPositions, undefined]).at(-1) ;
            otherPositions.push(o.value.pos);
          }
          const record = remote(key);
          if (record !== undefined && (record === null || sameValue(record, o.value))) {
            settled.add(o.key);
            continue;
          }
          values.set(key, o.value);
        } else {
          if (remote(key) === null || remote(key) === undefined || base(key) === undefined) {
            settled.add(o.key);
            continue;
          }
          const stack = [o.key];
          while (stack.length) {
            const at = stack.pop() ;
            if (deletes.has(`bm:${at}`)) continue;
            deletes.add(`bm:${at}`);
            stack.push(...(children.get(at) ?? []));
          }
        }
      }
      for (const k of deletes) values.delete(k);
      if (settled.size) ctx.drop(ctx.scope, settled);
      return {
        values,
        ignore: (k) => !values.has(k) && !deletes.has(k),
        published: (keys) => ctx.drop(ctx.scope, new Set([...keys].map((k) => k.slice(3)))),
      };
    },
    apply: () => true,
  };
}

});
__define("packages/sync/src/companion/view.ts", function (exports, __require) {
  __export(exports, "MAX_HISTORY_ITEMS", () => MAX_HISTORY_ITEMS);
  __export(exports, "liveProfiles", () => liveProfiles);
  __export(exports, "defaultProfileId", () => defaultProfileId);
  __export(exports, "dataOwner", () => dataOwner);
  __export(exports, "pinnedArea", () => pinnedArea);
  __export(exports, "bookmarkTree", () => bookmarkTree);
  __export(exports, "historyList", () => historyList);
  __export(exports, "buildView", () => buildView);
const { visible } = __require("packages/sync/src/scope.ts");
const { fromLegacy } = __require("packages/sync/src/companion/legacy.ts");
const { lastVisitOf } = __require("packages/sync/src/companion/adapters.ts");

const MAX_HISTORY_ITEMS = 2_000;

                            
                                                                                          

                                                                                                                                        
                                                                          
                                                                                                                          
                                                                                             
                                                                                
                                                                                    
                                                                                                                                   
                                                                                                                                                            
                                                                                            
                           
                 
               
                       
                      
                     
                          
                        
                               
                                                                     
                            
                         
  
                                                                                                                                                     
                                                                                                 

const str = (v         , fallback = "") => (typeof v === "string" ? v : fallback);
const optStr = (v         ) => (typeof v === "string" && v ? v : null);
const kindOf = (v         )       => (v === "phone" ? "phone" : "mac");
const byPosThenKey =                                         (a   , z   ) => (a.pos < z.pos ? -1 : a.pos > z.pos ? 1 : a.key < z.key ? -1 : a.key > z.key ? 1 : 0);

function liveProfiles(app                        )                             {
  const out = new Map                       ();
  if (!app) return out;
  for (const [k, v] of visible(app, "prof:")) if (v && typeof v === "object") out.set(k.slice(5), v                 );
  return out;
}

function defaultProfileId(profiles                            )                {
  const ids = [...profiles.keys()].sort();
  return ids.find((id) => profiles.get(id) .d === true) ?? ids[0] ?? null;
}

function dataOwner(app                        , syncId        )         {
  if (!app) return syncId;
  const profiles = liveProfiles(app);
  const path = [syncId];
  for (let at = syncId; ; ) {
    const owner = (app.records[`share:${at}`]?.v                                      )?.o;
    if (typeof owner !== "string" || owner === at || !profiles.has(owner)) return at;
    const loop = path.indexOf(owner);
    if (loop >= 0) return path.slice(loop).sort()[0] ;
    path.push(owner);
    at = owner;
  }
}

function hex(n         ) {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
  return Math.round(v * 255).toString(16).padStart(2, "0").toUpperCase();
}

function colorsOf(look         )                  {
  if (!look || typeof look !== "object" || !Array.isArray((look                       ).stops)) return null;
  const out           = [];
  for (const stop of (look                        ).stops.slice(0, 16)) {
    if (out.length >= 3) break;
    const c = (stop                                              )?.color;
    if (!c || ![c.r, c.g, c.b].every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 4)) continue;
    const alpha = typeof c.a === "number" && Number.isFinite(c.a) ? Math.min(1, Math.max(0, c.a)) : 1;
    out.push(`#${hex(c.r)}${hex(c.g)}${hex(c.b)}${alpha < 1 ? hex(alpha) : ""}`);
  }
  return out.length ? out : null;
}

function themeOf(app            , syncId        , profile               )                   {
  const record = app.records[`pth:${syncId}`]?.v                                              ;
  const theme = record ? (record.preset === true ? null : record.t) : profile.th;
  const colors = colorsOf(theme);
  if (!colors) return null;
  return { colors, darkColors: colorsOf((theme                      ).dark) };
}

function deviceTabs(scope                        , me        , devices                         )                   {
  if (!scope) return [];
  const out                   = [];
  for (const [k, v] of visible(scope, "tabs:")) {
    const deviceId = k.slice(5);
    const device = devices.get(deviceId);
    const value = v                   ;
    if (deviceId === me || !device || !Array.isArray(value?.tabs)) continue;
    const seen = new Set        ();
    const tabs                                   = [];
    for (const t of value.tabs) {
      const url = fromLegacy(str(t?.u));
      const title = str(t?.t);
      if (!url || seen.has(`${url}\n${title}`)) continue;
      seen.add(`${url}\n${title}`);
      tabs.push({ url, title });
    }
    if (!tabs.length) continue;
    out.push({ deviceId, deviceName: device.name || str(value.n) || "Unknown Device", kind: value.k ? kindOf(value.k) : device.kind, tabs });
  }
  return out.sort((a, z) => (devices.get(z.deviceId) .lastSeen ?? 0) - (devices.get(a.deviceId) .lastSeen ?? 0) || (a.deviceId < z.deviceId ? -1 : 1));
}

function sendTargets(scope                        , me        , devices                         )           {
  if (!scope) return [];
  return [...devices.values()]
    .filter((d) => d.id !== me && d.canReceiveTabs && d.id in scope.seen)
    .sort((a, z) => scope.seen[z.id]  - scope.seen[a.id]  || (a.id < z.id ? -1 : 1))
    .map((d) => d.id);
}

                                                                                                    
                                                                                       

function pinnedArea(scope                        )                        {
  if (!scope) return { tiles: [], sections: [] };
  const records = (prefix        ) => visible(scope, prefix);
  const pins = new Map                  ();
  for (const [k, v] of records("pin:t:")) if (v && typeof v === "object") pins.set(k.slice(6), fromLegacy(v            ));
  const groupValues = new Map                   ();
  for (const [k, v] of records("pin:g:")) if (v && typeof v === "object") groupValues.set(k.slice(6), v             );
  const nestValues = new Map                   ();
  for (const [k, v] of records("pinn:g:")) if (v && typeof v === "object") nestValues.set(k.slice(7), v             );
  const rows = new Set([...records("pinrow:")].filter(([, v]) => v === 1).map(([k]) => k.slice(7)));
  const order = records("pord:g:");
  const all = new Set([...groupValues.keys(), ...nestValues.keys()]);
  const parent = new Map                       ();
  for (const id of all) {
    const p = nestValues.get(id)?.p;
    parent.set(id, typeof p === "string" && p !== id && all.has(p) ? p : null);
  }
  for (const start of [...all].sort()) {
    const path           = [];
    for (let at                = start; at; at = parent.get(at) ?? null) {
      const loop = path.indexOf(at);
      if (loop >= 0) {
        parent.set(path.slice(loop).sort()[0] , null);
        break;
      }
      path.push(at);
    }
  }
  const chainUp = (id        ) => {
    const out           = [];
    for (let g                = id; g && !out.includes(g); g = parent.get(g) ?? null) out.push(g);
    return out;
  };
  const groupOf = new Map                       ();
  for (const [key, v] of pins) groupOf.set(key, typeof v.g === "string" && all.has(v.g) ? v.g : null);
  for (const [k, v] of records("pinn:t:")) {
    const key = k.slice(7);
    const inner = (v                   )?.g;
    const g = groupOf.get(key);
    if (!g || typeof inner !== "string" || !all.has(inner)) continue;
    if (chainUp(inner).at(-1) === chainUp(g).at(-1)) groupOf.set(key, inner);
  }
  const tabOf = (key        )                => {
    const v = pins.get(key) ;
    return { key, title: optStr(v.t) ?? str(v.ti), url: str(v.u), icon: optStr(v.i) };
  };
  const pos = (v                               , key        ) => (typeof v?.pos === "string" ? v.pos : `￿${key}`);
  const standalone = [...pins.keys()].filter((k) => groupOf.get(k) === null).map((key) => ({ key, pos: pos(pins.get(key), key) }));
  const roots = [...all].filter((id) => !parent.get(id)).map((key) => ({ key, pos: pos(groupValues.get(key), key) }));
  const areaSlots = [...standalone.map((s) => ({ ...s, group: false })), ...roots.map((r) => ({ ...r, group: true }))].sort(byPosThenKey);

  const kids = new Map                                                                          ();
  const placed = new Set        ();
  const members = [...pins.keys()]
    .filter((k) => groupOf.get(k))
    .map((key) => ({ key, pos: pos(pins.get(key), key), chain: chainUp(groupOf.get(key) ).reverse() }))
    .sort(byPosThenKey);
  for (const m of members) {
    m.chain.forEach((g, i) => {
      if (i === 0 || placed.has(g)) return;
      placed.add(g);
      kids.set(m.chain[i - 1] , [...(kids.get(m.chain[i - 1] ) ?? []), { group: true, key: g }]);
    });
    const leaf = m.chain.at(-1) ;
    kids.set(leaf, [...(kids.get(leaf) ?? []), { group: false, key: m.key }]);
  }
  const lookOf = (id        )            => (parent.get(id) ? (nestValues.get(id) ?? groupValues.get(id)) : (groupValues.get(id) ?? nestValues.get(id))) ?? {};
  const groupView = (id        )                  => {
    const look = lookOf(id);
    return {
      key: id,
      name: str(look.n),
      icon: optStr(look.i),
      color: optStr(look.c),
      items: (kids.get(id) ?? []).map((x) => (x.group ? { group: groupView(x.key) } : { tab: tabOf(x.key) })),
    };
  };

  const folderOf = new Map                ();
  for (const [k, v] of records("tilefold:")) {
    if (k.startsWith("tilefold:n:")) continue;
    const f = (v                   )?.f;
    if (typeof f === "string" && f) folderOf.set(k.slice(9), f);
  }
  const folderName = (id        ) => str((scope.records[`tilefold:n:${id}`]?.v                                      )?.n);
  const tileKeys = areaSlots.filter((s) => !s.group && !rows.has(s.key)).map((s) => s.key);
  const folderMembers = new Map                  ();
  for (const key of tileKeys) {
    const f = folderOf.get(key);
    if (f) folderMembers.set(f, [...(folderMembers.get(f) ?? []), key]);
  }
  const tiles                   = [];
  const emitted = new Set        ();
  for (const key of tileKeys) {
    const f = folderOf.get(key);
    const inFolder = f ? folderMembers.get(f)  : [];
    if (!f || inFolder.length < 2) {
      tiles.push({ ...tabOf(key), folder: null });
      continue;
    }
    if (emitted.has(f)) continue;
    emitted.add(f);
    const tabs = inFolder.map(tabOf);
    tiles.push({ key: `tilefold:${f}`, title: folderName(f) || "Folder", url: tabs[0] .url, icon: null, folder: tabs });
  }

  const blocks = areaSlots.filter((s) => (s.group ? !!kids.get(s.key)?.length : rows.has(s.key)));
  const rowKeys = new Set(blocks.filter((b) => !b.group).map((b) => b.key));
  const anchorOf = (group        ) => {
    const v = order.get(`pord:g:${group}`)                               ;
    if (v === undefined) return undefined;
    return typeof v?.a === "string" ? v.a : null;
  };
  let ordered = blocks;
  if (blocks.some((b) => b.group && anchorOf(b.key) !== undefined)) {
    const placedAfter = new Map                              ();
    const last                = [];
    for (const g of blocks.filter((b) => b.group)) {
      const a = anchorOf(g.key);
      if (a === null || (a !== undefined && rowKeys.has(a))) placedAfter.set(a, [...(placedAfter.get(a) ?? []), g]);
      else last.push(g);
    }
    ordered = [...(placedAfter.get(null) ?? []), ...blocks.filter((b) => !b.group).flatMap((r) => [r, ...(placedAfter.get(r.key) ?? [])]), ...last];
  }
  const sections = ordered.map((b)                    => (b.group ? { group: groupView(b.key) } : { tab: tabOf(b.key) }));
  return { tiles, sections };
}

function bookmarkTree(scope                        )                 {
  if (!scope) return [];
  const values = new Map                       ();
  for (const [k, v] of visible(scope, "bm:")) {
    const b = v                 ;
    if (b && typeof b === "object" && (b.k === "u" || b.k === "f")) values.set(k.slice(3), fromLegacy(b));
  }
  const parentOf = new Map                ();
  for (const [key, v] of values) {
    const p = typeof v.p === "string" ? v.p : "other";
    parentOf.set(key, p === "bar" || p === "other" ? p : values.get(p)?.k === "f" ? p : "other");
  }
  for (const key of [...values.keys()].sort()) {
    const seen = new Set([key]);
    for (let at = parentOf.get(key) ; parentOf.has(at); at = parentOf.get(at) ) {
      if (seen.has(at)) {
        parentOf.set(key, "other");
        break;
      }
      seen.add(at);
    }
  }
  const children = new Map                  ();
  for (const key of values.keys()) children.set(parentOf.get(key) , [...(children.get(parentOf.get(key) ) ?? []), key]);
  const sorted = (parent        ) =>
    (children.get(parent) ?? []).map((key) => ({ key, pos: str(values.get(key) .pos) })).sort(byPosThenKey).map((x) => x.key);
  const node = (key        , root                        )               => {
    const v = values.get(key) ;
    const folder = v.k === "f";
    return {
      key,
      title: str(v.t),
      url: folder ? null : str(v.u),
      added: typeof v.a === "number" && Number.isFinite(v.a) ? v.a : 0,
      root,
      children: folder ? sorted(key).map((k) => node(k, null)) : null,
    };
  };
  return [...sorted("bar").map((k) => node(k, "bar")), ...sorted("other").map((k) => node(k, "other"))];
}

function historyList(scope                        )                {
  if (!scope) return [];
  const out                = [];
  for (const [k, v] of visible(scope, "h:")) {
    const h = v                ;
    if (!h || typeof h !== "object" || !Array.isArray(h.vt) || !h.vt.length) continue;
    out.push({ url: fromLegacy(k.slice(2)), title: str(h.t), visits: typeof h.n === "number" ? h.n : h.vt.length, lastVisit: lastVisitOf(h) });
  }
  return out.sort((a, z) => z.lastVisit - a.lastVisit || (a.url < z.url ? -1 : 1)).slice(0, MAX_HISTORY_ITEMS);
}

function searchOf(app            )                    {
  const setting = (name        ) => {
    const record = app.records[`set:${name}`]?.v                                      ;
    return record && typeof record === "object" ? fromLegacy(record.v) : undefined;
  };
  const engine = setting("searchEngine");
  const customUrl = setting("customSearchUrl");
  const custom = setting("customSearchEngines");
  if (engine === undefined && customUrl === undefined && custom === undefined) return null;
  const engines = Array.isArray(custom)
    ? custom
        .filter((e) => e && typeof e === "object" && ["id", "name", "keyword", "url"].every((f) => typeof (e                           )[f] === "string"))
        .map((e) => {
          const { id, name, keyword, url } = e                          ;
          return { id: id , name: name , keyword: keyword , url: url  };
        })
    : [];
  return { engineId: typeof engine === "string" && engine ? engine : "google", customURL: optStr(customUrl), customEngines: engines };
}

function buildView(scopes                            , me        )       {
  const app = scopes.app;
  if (!app) return { devices: [], profiles: [], search: null };
  const lastSeen = new Map                ();
  for (const scope of Object.values(scopes)) {
    for (const [device, at] of Object.entries(scope.seen)) lastSeen.set(device, Math.max(at, lastSeen.get(device) ?? 0));
  }
  const devices = new Map                    ();
  for (const [k, v] of visible(app, "dev:")) {
    const id = k.slice(4);
    const d = v               ;
    devices.set(id, {
      id,
      name: str(d?.n) || "Unknown Device",
      kind: kindOf(d?.k),
      lastSeen: lastSeen.get(id) ?? null,
      isCurrent: id === me,
      canReceiveTabs: Array.isArray(d?.f) && d.f.includes("send"),
    });
  }
  const deviceList = [...devices.values()].sort((a, z) => Number(z.isCurrent) - Number(a.isCurrent) || (z.lastSeen ?? 0) - (a.lastSeen ?? 0) || (a.id < z.id ? -1 : 1));
  const profiles = liveProfiles(app);
  const defaultId = defaultProfileId(profiles);
  const profileList                = [...profiles].map(([syncId, p]) => {
    const own = scopes[`p:${syncId}`];
    const data = scopes[`p:${dataOwner(app, syncId)}`];
    return {
      syncId,
      name: str(p.n) || "Profile",
      color: optStr(p.c),
      icon: optStr(p.i),
      isDefault: syncId === defaultId,
      theme: themeOf(app, syncId, p),
      sendTargets: sendTargets(own, me, devices),
      deviceTabs: deviceTabs(own, me, devices),
      pinned: pinnedArea(own),
      bookmarks: bookmarkTree(data),
      history: historyList(data),
    };
  });
  profileList.sort((a, z) => Number(z.isDefault) - Number(a.isDefault) || a.name.localeCompare(z.name) || (a.syncId < z.syncId ? -1 : 1));
  return { devices: deviceList, profiles: profileList, search: searchOf(app) };
}

});
__define("packages/sync/src/companion/legacy.ts", function (exports, __require) {
  __export(exports, "fromLegacyUrl", () => fromLegacyUrl);
  __export(exports, "fromLegacy", () => fromLegacy);
const LEGACY_URLS                     = [
  ["netnyahoo://yahu", "ardia://game"],
  ["chrome://yahu", "chrome://game"],
  ["netnyahoo://", "ardia://"],
];

function fromLegacyUrl(url        )         {
  const lower = url.toLowerCase();
  for (const prefix of ["", "view-source:"]) {
    for (const [old, now] of LEGACY_URLS) {
      if (!lower.startsWith(prefix + old)) continue;
      const rest = url.slice(prefix.length + old.length);
      if (!old.endsWith("://") && rest && !"/?#".includes(rest[0] )) continue;
      return url.slice(0, prefix.length) + now + rest;
    }
  }
  return url;
}

function fromLegacy   (value   )    {
  if (typeof value === "string") return fromLegacyUrl(value)     ;
  if (Array.isArray(value)) return value.map(fromLegacy)     ;
  if (value && typeof value === "object") {
    const out                          = {};
    for (const [key, v] of Object.entries(value                           )) out[key] = fromLegacy(v);
    return out     ;
  }
  return value;
}

});
globalThis.ArdiaSync = __require("packages/sync/src/companion/index.ts");
})();
