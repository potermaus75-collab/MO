// js/core/utils.js
export function clamp(v, min, max){
  return Math.max(min, Math.min(max, v));
}

export function rand(){
  return Math.random();
}

export function randInt(min, maxInclusive){
  const r = Math.floor(Math.random() * (maxInclusive - min + 1)) + min;
  return r;
}

export function choice(arr){
  return arr[Math.floor(Math.random() * arr.length)];
}

export function weightedPick(entries){
  const total = entries.reduce((s,e)=>s + (e.weight ?? 1), 0);
  let r = Math.random() * total;
  for(const e of entries){
    r -= (e.weight ?? 1);
    if(r <= 0) return e;
  }
  return entries[entries.length - 1];
}

export function uuid(){
  // Lightweight UUID v4 (good enough for local saves)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c=>{
    const r = Math.random()*16|0;
    const v = c==="x" ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}

export function sleep(ms){
  return new Promise(res=>setTimeout(res, ms));
}

export function formatPct(v){
  return `${Math.round(v*100)}%`;
}
