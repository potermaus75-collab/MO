// js/core/storage.js
const SAVE_KEY = "monster_web_game_save_v1";

export function loadSave(){
  try{
    const raw = localStorage.getItem(SAVE_KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  }catch(e){
    console.warn("Failed to load save:", e);
    return null;
  }
}

export function writeSave(save){
  localStorage.setItem(SAVE_KEY, JSON.stringify(save));
}

export function clearSave(){
  localStorage.removeItem(SAVE_KEY);
}

export function saveExists(){
  return !!localStorage.getItem(SAVE_KEY);
}
