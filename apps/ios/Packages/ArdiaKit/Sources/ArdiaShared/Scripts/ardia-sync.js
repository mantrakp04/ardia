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
globalThis.ArdiaSync = __require("packages/sync/src/companion/index.ts");
})();
