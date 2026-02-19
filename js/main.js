// js/main.js
import { DataStore } from "./core/dataStore.js";
import { Input } from "./core/input.js";
import { UI } from "./ui/ui.js";
import { loadSave, writeSave, clearSave, saveExists } from "./core/storage.js";
import { randInt, weightedPick, uuid, clamp } from "./core/utils.js";
import { BattleEngine } from "./battle/battleEngine.js";

const TILE_SIZE = 32; // canvas tile size (fixed)
const CANVAS_W = 640;
const CANVAS_H = 480;

const TILE = {
  WALL:"#",
  GRASS:".",
  GROUND:"G",
  ROAD:"R",
  TREE:"T",
  WATER:"W",
  LAVA:"L",
  EXIT:"E",
  HOUSE:"H",
  CENTER:"C",
  SHOP:"S",
  PLAYER_START:"P",
};

const TILE_DEF = {
  "#": {pass:false, type:"WALL", color:"#25314b"},
  "G": {pass:true,  type:"GROUND", color:"#18253b"},
  "R": {pass:true,  type:"ROAD", color:"#3a4b6b"},
  ".": {pass:true,  type:"GRASS", color:"#163b2c", encounter:"GRASS"},
  "T": {pass:false, type:"TREE",  color:"#114028", interact:"TREE"},
  "W": {pass:false, type:"WATER", color:"#143a62", interact:"WATER"},
  "L": {pass:false, type:"LAVA",  color:"#562017", interact:"LAVA"},
  "E": {pass:true,  type:"EXIT",  color:"#6b5a2c"},
  "H": {pass:false, type:"HOUSE", color:"#4b2b2b"},
  "C": {pass:true,  type:"CENTER",color:"#2c6b5a"},
  "S": {pass:true,  type:"SHOP",  color:"#2c3b6b"},
  "P": {pass:true,  type:"GROUND",color:"#18253b"},
};

function keyToDir(k){
  if(k==="ArrowUp" || k==="w" || k==="W") return {dx:0,dy:-1};
  if(k==="ArrowDown"|| k==="s" || k==="S") return {dx:0,dy:1};
  if(k==="ArrowLeft"|| k==="a" || k==="A") return {dx:-1,dy:0};
  if(k==="ArrowRight"||k==="d" || k==="D") return {dx:1,dy:0};
  return null;
}

function deepCopy(obj){
  return JSON.parse(JSON.stringify(obj));
}

class GameApp{
  constructor(){
    this.data = new DataStore();
    this.input = new Input();
    this.ui = new UI();

    this.canvas = document.getElementById("mapCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;

    this.mode = "BOOT"; // TITLE, WORLD, BATTLE
    this.save = null;

    this.map = null;
    this.npcs = [];
    this.player = {x:2,y:2, dir:{dx:0,dy:1}};

    this._moveCooldown = 0;
    this._encounterCooldownSteps = 0;

    this.battle = null; // {engine, context}

    // buttons
    this.ui.btnMenu.addEventListener("click", ()=>this.openMenu());
    this.ui.btnSave.addEventListener("click", ()=>this.saveNow());
    this.ui.btnReset.addEventListener("click", ()=>this.resetAll());

    window.addEventListener("keydown", (e)=>{
      if(e.key === "Enter"){
        this.handleConfirm();
      }else if(e.key === "m" || e.key === "M"){
        if(this.mode === "WORLD" && !this.ui.panelIsOpen()) this.openMenu();
      }else if(e.key === "Escape"){
        if(this.ui.panelIsOpen()) this.ui.hidePanel();
      }
    });
  }

  async start(){
    this.ui.toast("데이터 로딩 중...");
    await this.data.loadAll();
    this.ui.toast("로딩 완료");

    // Load or create save
    const existing = loadSave();
    if(existing && existing.version === this.data.config.version){
      this.save = existing;
    }else if(existing){
      // Simple forward-compat: accept old save, but bump version
      this.save = existing;
      this.save.version = this.data.config.version;
    }

    if(!this.save){
      this.mode = "TITLE";
      this.showTitle();
    }else{
      this.enterWorldFromSave();
    }

    requestAnimationFrame((t)=>this.loop(t));
  }

  loop(ts){
    const dt = 1/60;

    if(this.mode === "WORLD"){
      this.updateWorld(dt);
      this.renderWorld();
    }else if(this.mode === "TITLE"){
      this.renderTitleBackground();
    }else if(this.mode === "BATTLE"){
      // battle UI is DOM-driven; background still shows
      this.renderTitleBackground();
      // keep headers in sync
      this.syncBattleHeader();
    }else{
      this.renderTitleBackground();
    }

    requestAnimationFrame((t)=>this.loop(t));
  }

  renderTitleBackground(){
    // simple animated background
    const ctx = this.ctx;
    ctx.clearRect(0,0,CANVAS_W,CANVAS_H);
    ctx.fillStyle = "#060b16";
    ctx.fillRect(0,0,CANVAS_W,CANVAS_H);

    ctx.fillStyle = "rgba(90,209,255,0.08)";
    for(let i=0;i<40;i++){
      const x = (i*53 + (Date.now()/30)) % CANVAS_W;
      const y = (i*29 + (Date.now()/60)) % CANVAS_H;
      ctx.fillRect(x, y, 6, 6);
    }
  }

  // --- Save
  newSave(){
    const cfg = this.data.config;
    const startMap = this.data.regions[0].startingMap;
    const map = this.data.getMap(startMap);
    return {
      version: cfg.version,
      createdAt: new Date().toISOString(),
      playerName: "플레이어",
      regionId: this.data.regions[0].id,
      mapId: startMap,
      x: map.start.x,
      y: map.start.y,
      gold: cfg.startingGold,
      inventory: Object.fromEntries(cfg.startingInventory.map(it=>[it.code, it.qty])),
      party: [],
      box: [],
      defeatedNpcs: [],
      gotStarter: false,
      seenDex: {},
      caughtDex: {},
    };
  }

  saveNow(){
    if(!this.save){
      this.ui.toast("저장할 데이터가 없다.");
      return;
    }
    // update position
    if(this.mode === "WORLD"){
      this.save.mapId = this.map.id;
      this.save.x = this.player.x;
      this.save.y = this.player.y;
    }
    writeSave(this.save);
    this.ui.toast("저장 완료");
  }

  resetAll(){
    if(confirm("정말로 저장 데이터를 모두 삭제할까?")){
      clearSave();
      location.reload();
    }
  }

  // --- Title
  showTitle(){
    this.mode = "TITLE";
    this.ui.setLocationLabel("몬스터 원정대");

    const canContinue = saveExists();
    const html = `
      <div class="card">
        <div style="font-size:18px;font-weight:800;">몬스터 원정대 (웹 프로토타입)</div>
        <div class="smallText" style="margin-top:6px;">
          방향키/WASD 이동 · Enter 상호작용 · M 메뉴<br/>
          수풀(초록) 위를 걸으면 조우, 나무/물/용암은 Enter로 조사해 조우할 수 있다.
        </div>
      </div>

      <div class="row">
        <div class="card">
          <div style="font-weight:800;">새 게임</div>
          <div class="smallText">스타터를 선택하고 아쿠리아 지방을 여행한다.</div>
          <button id="btnNewGame" class="btn" style="margin-top:10px;width:100%;">새 게임 시작</button>
        </div>

        <div class="card">
          <div style="font-weight:800;">이어하기</div>
          <div class="smallText">${canContinue ? "저장된 데이터를 불러온다." : "저장 데이터가 없다."}</div>
          <button id="btnContinue" class="btn" style="margin-top:10px;width:100%;" ${canContinue ? "" : "disabled"}>이어하기</button>
        </div>
      </div>
    `;
    this.ui.showPanel("시작", html);

    document.getElementById("btnNewGame").addEventListener("click", ()=>{
      this.save = this.newSave();
      this.ui.hidePanel();
      this.enterWorldFromSave();
      // prompt starter immediately
      this.ui.toast("연구소장에게 말을 걸어 스타터를 선택해봐.");
    });

    const btnContinue = document.getElementById("btnContinue");
    if(btnContinue){
      btnContinue.addEventListener("click", ()=>{
        const loaded = loadSave();
        if(!loaded){
          this.ui.toast("저장 데이터가 없다.");
          return;
        }
        this.save = loaded;
        this.save.version = this.data.config.version;
        this.ui.hidePanel();
        this.enterWorldFromSave();
      });
    }
  }

  // --- World
  enterWorldFromSave(){
    const map = this.data.getMap(this.save.mapId);
    this.map = map;
    this.npcs = this.data.getNPCs(map.id);

    this.player.x = this.save.x ?? map.start.x;
    this.player.y = this.save.y ?? map.start.y;

    this.mode = "WORLD";
    this.ui.hideBattle();
    this.ui.hidePanel();
    this.ui.setLocationLabel(`${map.name}`);

    this._encounterCooldownSteps = 0;
  }

  tileAt(x,y){
    if(x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return TILE.WALL;
    return this.map.tiles[y][x];
  }

  isPassable(x,y){
    const ch = this.tileAt(x,y);
    const def = TILE_DEF[ch] ?? TILE_DEF["#"];
    // NPC blocks movement
    const npc = this.getNpcAt(x,y);
    if(npc) return false;
    return def.pass;
  }

  getNpcAt(x,y){
    for(const n of this.npcs){
      if(n.x===x && n.y===y){
        // already defeated trainer: still exists but doesn't block? In Pokémon they remain.
        // We'll keep them blocking and allow talk.
        return n;
      }
    }
    return null;
  }

  updateWorld(dt){
    // If panel or dialogue is open, don't move.
    if(this.ui.panelIsOpen()) return;

    if(this._moveCooldown > 0){
      this._moveCooldown -= dt;
      return;
    }

    const k = this.input.consumeLastKey();
    if(!k) return;

    const dir = keyToDir(k);
    if(dir){
      this.player.dir = dir;
      const nx = this.player.x + dir.dx;
      const ny = this.player.y + dir.dy;

      if(this.isPassable(nx, ny)){
        this.player.x = nx;
        this.player.y = ny;
        this._moveCooldown = 0.09;

        // keep save position in sync
        this.save.mapId = this.map.id;
        this.save.x = this.player.x;
        this.save.y = this.player.y;

        // step-based encounters on grass
        const tile = this.tileAt(nx, ny);
        const def = TILE_DEF[tile] ?? {};
        if(def.encounter === "GRASS"){
          this._handleStepEncounter("GRASS");
        }

        // exits
        if(tile === TILE.EXIT){
          this._handleExit(nx, ny);
        }

        // locks
        this._handleLocks(nx, ny);
      }
    }
  }

  _handleLocks(x,y){
    if(!this.map.locks) return;
    const lock = this.map.locks.find(l=>l.x===x && l.y===y);
    if(lock){
      this.ui.toast(lock.message ?? "막혀 있다.");
    }
  }

  _handleExit(x,y){
    const exit = (this.map.exits ?? []).find(e=>e.x===x && e.y===y);
    if(!exit){
      this.ui.toast("이동할 수 없는 출구다.");
      return;
    }
    this.map = this.data.getMap(exit.toMap);
    this.npcs = this.data.getNPCs(this.map.id);
    this.player.x = exit.toX;
    this.player.y = exit.toY;
    this.ui.setLocationLabel(`${this.map.name}`);
    this.ui.toast(`${this.map.name}에 도착했다.`);

    // sync save
    this.save.mapId = this.map.id;
    this.save.x = this.player.x;
    this.save.y = this.player.y;
  }

  _handleStepEncounter(kind){
    if(!this.map.encounters?.[kind]) return;
    if(this._encounterCooldownSteps > 0){
      this._encounterCooldownSteps -= 1;
      return;
    }
    const enc = this.map.encounters[kind];
    if(Math.random() < enc.rate){
      this._encounterCooldownSteps = this.data.config.wildEncounterStepCooldown ?? 2;
      const enemy = this.rollWild(enc.tableId);
      this.startBattle({mode:"WILD", enemyParty:[enemy], allowCapture:true, reward:{gold: randInt(10,30)}});
    }
  }

  rollWild(tableId){
    const table = this.data.getSpawnTable(tableId);
    const pick = weightedPick(table);
    const lvl = randInt(pick.minLevel, pick.maxLevel);
    return this.makeMonsterInstance({formId: pick.formId, level: lvl, isWild:true});
  }

  makeMonsterInstance({formId, level, isWild=false}){
    const natureId = randInt(1, this.data.natures.length);
    const iv = {hp: randInt(0,15), atk: randInt(0,15), def: randInt(0,15), spd: randInt(0,15)};
    const ev = {hp:0, atk:0, def:0, spd:0};

    const inst = {
      instanceId: uuid(),
      formId,
      nickname: null,
      level,
      exp: 0,
      natureId,
      iv,
      ev,
      affection: 0,
      battlesTotal: 0,
      trainingStyleId: 1,
      currentHp: null,
      isWild,
    };

    // mark seen
    const form = this.data.getForm(formId);
    this.save.seenDex[String(form.dex_no)] = true;

    return inst;
  }

  renderWorld(){
    const ctx = this.ctx;
    ctx.clearRect(0,0,CANVAS_W,CANVAS_H);

    // tiles
    for(let y=0;y<this.map.height;y++){
      for(let x=0;x<this.map.width;x++){
        const ch = this.map.tiles[y][x];
        const def = TILE_DEF[ch] ?? TILE_DEF["#"];
        ctx.fillStyle = def.color;
        ctx.fillRect(x*TILE_SIZE, y*TILE_SIZE, TILE_SIZE, TILE_SIZE);

        // subtle grid
        ctx.strokeStyle = "rgba(255,255,255,0.03)";
        ctx.strokeRect(x*TILE_SIZE, y*TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }

    // NPCs
    for(const npc of this.npcs){
      ctx.fillStyle = this.save.defeatedNpcs.includes(npc.id) ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.75)";
      ctx.fillRect(npc.x*TILE_SIZE+8, npc.y*TILE_SIZE+8, TILE_SIZE-16, TILE_SIZE-16);
    }

    // Player
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(this.player.x*TILE_SIZE+10, this.player.y*TILE_SIZE+10, TILE_SIZE-20, TILE_SIZE-20);
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.strokeRect(this.player.x*TILE_SIZE+10, this.player.y*TILE_SIZE+10, TILE_SIZE-20, TILE_SIZE-20);
  }

  async handleConfirm(){
    // Dialogue priority
    if(this.ui.advanceDialogue()) return;

    if(this.mode !== "WORLD") return;
    if(this.ui.panelIsOpen()) return;

    // Check NPC in front
    const tx = this.player.x + this.player.dir.dx;
    const ty = this.player.y + this.player.dir.dy;
    const npc = this.getNpcAt(tx, ty);
    if(npc){
      await this.talkToNpc(npc);
      return;
    }

    // Check tile interaction on current tile (center/shop)
    const here = this.tileAt(this.player.x, this.player.y);
    if(here === TILE.CENTER){
      this.healParty();
      return;
    }
    if(here === TILE.SHOP){
      this.openShop();
      return;
    }

    // Check adjacent interactable tile (tree/water/lava)
    const adj = [
      {x: this.player.x+1, y:this.player.y},
      {x: this.player.x-1, y:this.player.y},
      {x: this.player.x, y:this.player.y+1},
      {x: this.player.x, y:this.player.y-1},
    ];

    for(const p of adj){
      const ch = this.tileAt(p.x, p.y);
      const def = TILE_DEF[ch] ?? null;
      if(def?.interact){
        await this.tryInteractEncounter(def.interact);
        return;
      }
    }

    this.ui.toast("아무 일도 일어나지 않았다.");
  }

  async talkToNpc(npc){
    const alreadyDefeated = this.save.defeatedNpcs.includes(npc.id);

    // Special scripts
    if(npc.script === "STARTER_CHOICE"){
      if(this.save.gotStarter){
        await this.ui.dialogue(["여행은 순조롭나? 몬스터를 모아보자."], `${npc.title} ${npc.name}`);
      }else{
        await this.ui.dialogue(npc.dialogue, `${npc.title} ${npc.name}`);
        this.openStarterChoice();
      }
      return;
    }
    if(npc.script === "HEAL_CENTER"){
      await this.ui.dialogue(npc.dialogue, `${npc.title} ${npc.name}`);
      this.healParty();
      return;
    }

    // Trainer battle
    if(npc.battle && !alreadyDefeated){
      await this.ui.dialogue(npc.dialogue, `${npc.title} ${npc.name}`);
      const enemyParty = npc.battle.team.map(t=>this.makeMonsterInstance({formId:t.formId, level:t.level, isWild:false}));
      this.startBattle({mode:"TRAINER", enemyParty, allowCapture:false, reward:npc.battle.reward, trainerNpcId:npc.id});
      return;
    }

    // After defeated or normal NPC
    if(npc.battle && alreadyDefeated){
      await this.ui.dialogue(["좋은 승부였어. 다음에 또 보자."], `${npc.title} ${npc.name}`);
      return;
    }

    await this.ui.dialogue(npc.dialogue ?? ["..."], `${npc.title ?? ""} ${npc.name}`.trim());
  }

  async tryInteractEncounter(kind){
    const enc = this.map.encounters?.[kind];
    if(!enc){
      this.ui.toast("여기서는 아무것도 찾을 수 없다.");
      return;
    }

    // Special gating: lava needs HEAT_GEAR after boss, but for prototype allow without as low chance
    if(kind === "LAVA"){
      const hasHeatGear = (this.save.inventory["HEAT_GEAR"] ?? 0) > 0;
      if(!hasHeatGear){
        this.ui.toast("용암 열기가 너무 강하다... (내열 장비가 필요)");
        return;
      }
    }

    if(Math.random() < enc.rate){
      const enemy = this.rollWild(enc.tableId);
      this.startBattle({mode:"WILD", enemyParty:[enemy], allowCapture:true, reward:{gold: randInt(15,45)}});
    }else{
      this.ui.toast("아무것도 나타나지 않았다.");
    }
  }

  // --- Starter
  openStarterChoice(){
    const choices = this.data.config.starterChoices;
    const cards = choices.map(c=>{
      const f = this.data.getForm(c.formId);
      const el = this.data.byElementId.get(f.element_id)?.name_kr ?? "무속성";
      return `
        <div class="card">
          <div style="font-weight:900;">${f.name_kr} <span class="badge">${el}</span></div>
          <div class="smallText" style="margin-top:6px;white-space:pre-wrap;">${(f.description_kr ?? "").split("\n").slice(0,2).join("\n")}</div>
          <button class="btn" data-form="${c.formId}" style="margin-top:10px;width:100%;">이 몬스터 선택</button>
        </div>
      `;
    }).join("");

    const html = `
      <div class="card">
        <div style="font-weight:900;">스타터 선택</div>
        <div class="smallText">선택한 몬스터는 파티에 추가되며, 이후에도 포획으로 동료를 늘릴 수 있다.</div>
      </div>
      <div class="row">${cards}</div>
    `;
    this.ui.showPanel("스타터 선택", html);

    this.ui.elPanelBody.querySelectorAll("button[data-form]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const formId = Number(btn.dataset.form);
        this.pickStarter(formId);
      });
    });
  }

  pickStarter(formId){
    const level = 5;
    const inst = this.makeMonsterInstance({formId, level, isWild:false});
    inst.currentHp = null; // full
    this.save.party = [inst];
    // starter is owned -> caught
    const form = this.data.getForm(formId);
    this.save.caughtDex[String(form.dex_no)] = true;
    this.save.gotStarter = true;
    this.ui.hidePanel();
    this.ui.toast("스타터를 얻었다! 수풀에서 야생 몬스터를 찾아보자.");
  }

  // --- Party & Items
  healParty(){
    if(!this.save.party.length){
      this.ui.toast("파티가 비어 있다.");
      return;
    }
    for(const m of this.save.party){
      const b = this._computeMaxHp(m);
      m.currentHp = b;
    }
    this.ui.toast("파티가 모두 회복됐다.");
  }

  _computeMaxHp(instance){
    const form = this.data.getForm(instance.formId);
    const rarity = this.data.getRarity(form.rarity_id);
    const nature = this.data.getNature(instance.natureId);
    const lvl = instance.level;
    const iv = instance.iv;
    const ev = instance.ev;
    return Math.floor((form.base_hp + iv.hp + ev.hp/4) * rarity.stat_multiplier * nature.hp_mult + lvl*6);
  }

  addItem(code, qty){
    this.save.inventory[code] = (this.save.inventory[code] ?? 0) + qty;
  }

  removeItem(code, qty){
    const cur = this.save.inventory[code] ?? 0;
    this.save.inventory[code] = Math.max(0, cur - qty);
  }

  openShop(){
    const items = ["CAPTURE_ORB","SUPER_ORB","HEAL_GEL"].map(c=>this.data.getItemByCode(c)).filter(Boolean);
    const rows = items.map(it=>{
      return `
        <div class="card">
          <div style="font-weight:800;">${it.name}</div>
          <div class="smallText">${it.description ?? ""}</div>
          <div class="kv"><span>가격</span><b>${it.price ?? 0} G</b></div>
          <button class="btn" data-buy="${it.code}" style="margin-top:10px;width:100%;">구매</button>
        </div>
      `;
    }).join("");

    const html = `
      <div class="card">
        <div style="font-weight:900;">잡화점</div>
        <div class="smallText">현재 소지금: <b>${this.save.gold} G</b></div>
      </div>
      <div class="row">${rows}</div>
    `;
    this.ui.showPanel("상점", html);

    this.ui.elPanelBody.querySelectorAll("button[data-buy]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const code = btn.dataset.buy;
        const it = this.data.getItemByCode(code);
        const price = it.price ?? 0;
        if(this.save.gold < price){
          this.ui.toast("소지금이 부족하다.");
          return;
        }
        this.save.gold -= price;
        this.addItem(code, 1);
        this.ui.toast(`${it.name} 구매 완료`);
        this.openShop(); // refresh
      });
    });
  }

  openMenu(){
    const html = this.renderMenuHtml("PARTY");
    this.ui.showPanel("메뉴", html);
    this.wireMenuHandlers();
  }

  renderMenuHtml(tab){
    const tabBtn = (id,label)=>`<button class="btn small" data-tab="${id}" ${tab===id?"disabled":""}>${label}</button>`;

    const header = `
      <div class="card">
        <div class="row">
          <div>
            <div style="font-weight:900;">${this.save.playerName}</div>
            <div class="smallText">소지금: <b>${this.save.gold} G</b></div>
          </div>
          <div style="text-align:right;">
            ${tabBtn("PARTY","파티")}
            ${tabBtn("BAG","가방")}
            ${tabBtn("DEX","도감")}
            ${tabBtn("SET","설정")}
          </div>
        </div>
      </div>
    `;

    if(tab==="PARTY") return header + this.renderPartyTab();
    if(tab==="BAG") return header + this.renderBagTab();
    if(tab==="DEX") return header + this.renderDexTab();
    return header + this.renderSettingsTab();
  }

  renderPartyTab(){
    if(!this.save.party.length){
      return `<div class="card">파티가 비어 있다.</div>`;
    }
    const cards = this.save.party.map((m, idx)=>{
      const form = this.data.getForm(m.formId);
      const el = this.data.byElementId.get(form.element_id)?.name_kr ?? "무속성";
      const maxHp = this._computeMaxHp(m);
      const curHp = m.currentHp ?? maxHp;
      const style = this.data.getTrainingStyle(m.trainingStyleId);
      return `
        <div class="card">
          <div style="font-weight:900;">#${form.dex_no} ${form.name_kr} <span class="badge">${el}</span></div>
          <div class="smallText">${(form.description_kr ?? "").split("\n").slice(0,2).join("\n")}</div>
          <div class="kv"><span>Lv</span><b>${m.level}</b></div>
          <div class="kv"><span>HP</span><b>${curHp}/${maxHp}</b></div>
          <div class="kv"><span>훈련 스타일</span><b>${style?.name_kr ?? "—"}</b></div>
          <div style="margin-top:10px;">
            <button class="btn small" data-style="${idx}-1">공격 훈련</button>
            <button class="btn small" data-style="${idx}-2">수호 훈련</button>
          </div>
        </div>
      `;
    }).join("");
    return `<div class="row">${cards}</div>`;
  }

  renderBagTab(){
    const entries = Object.entries(this.save.inventory).filter(([,q])=>q>0);
    if(!entries.length){
      return `<div class="card">가방이 비어 있다.</div>`;
    }
    const cards = entries.map(([code,qty])=>{
      const it = this.data.getItemByCode(code);
      const name = it?.name ?? it?.name_kr ?? code;
      const desc = it?.description ?? it?.description_kr ?? "";
      const type = it?.type ?? it?.item_type ?? "";
      const usable = (type==="HEAL") ? "사용 가능" : "전투/재료";
      return `
        <div class="card">
          <div style="font-weight:900;">${name} <span class="badge">${usable}</span></div>
          <div class="smallText">${desc}</div>
          <div class="kv"><span>수량</span><b>${qty}</b></div>
          ${type==="HEAL" ? `<button class="btn" data-use-heal="${code}" style="margin-top:10px;width:100%;">파티 1번에게 사용</button>` : ""}
        </div>
      `;
    }).join("");

    return `<div class="row">${cards}</div>`;
  }

  renderDexTab(){
    const seen = Object.keys(this.save.seenDex).length;
    const caught = Object.keys(this.save.caughtDex).length;
    const total = this.data.forms.length;

    const list = this.data.forms
      .slice()
      .sort((a,b)=>a.dex_no - b.dex_no)
      .map(f=>{
        const s = this.save.seenDex[String(f.dex_no)];
        const c = this.save.caughtDex[String(f.dex_no)];
        const mark = c ? "✅" : (s ? "👁️" : "—");
        return `<div class="kv"><span>${mark} #${f.dex_no} ${f.name_kr}</span><b>${this.data.byElementId.get(f.element_id)?.name_kr ?? ""}</b></div>`;
      }).join("");

    return `
      <div class="card">
        <div class="kv"><span>발견</span><b>${seen}/${total}</b></div>
        <div class="kv"><span>포획</span><b>${caught}/${total}</b></div>
      </div>
      <div class="card" style="max-height:420px;overflow:auto;">
        ${list}
      </div>
    `;
  }

  renderSettingsTab(){
    return `
      <div class="card">
        <div style="font-weight:900;">설정</div>
        <div class="smallText">이 프로토타입은 로컬 저장(LocalStorage)을 사용한다. GitHub Pages에서도 동작한다.</div>
        <div style="margin-top:10px;">
          <button class="btn" id="btnSettingsSave">지금 저장</button>
          <button class="btn danger" id="btnSettingsReset">세이브 삭제</button>
        </div>
      </div>
    `;
  }

  wireMenuHandlers(){
    // tab switch
    this.ui.elPanelBody.querySelectorAll("button[data-tab]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const tab = btn.dataset.tab;
        this.ui.showPanel("메뉴", this.renderMenuHtml(tab));
        this.wireMenuHandlers();
      });
    });

    // training style
    this.ui.elPanelBody.querySelectorAll("button[data-style]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const [idx, styleId] = btn.dataset.style.split("-").map(Number);
        if(this.save.party[idx]){
          this.save.party[idx].trainingStyleId = styleId;
          this.ui.toast("훈련 스타일을 변경했다.");
          this.ui.showPanel("메뉴", this.renderMenuHtml("PARTY"));
          this.wireMenuHandlers();
        }
      });
    });

    // use heal on party[0]
    this.ui.elPanelBody.querySelectorAll("button[data-use-heal]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const code = btn.dataset.useHeal;
        const it = this.data.getItemByCode(code);
        if(!it || it.type!=="HEAL"){
          this.ui.toast("이 아이템은 사용할 수 없다.");
          return;
        }
        if((this.save.inventory[code] ?? 0) <= 0){
          this.ui.toast("수량이 부족하다.");
          return;
        }
        if(!this.save.party[0]){
          this.ui.toast("파티가 비어 있다.");
          return;
        }
        const m = this.save.party[0];
        const maxHp = this._computeMaxHp(m);
        const cur = m.currentHp ?? maxHp;
        const heal = Math.floor(maxHp * (it.healRatio ?? 0.35));
        m.currentHp = Math.min(maxHp, cur + heal);
        this.removeItem(code, 1);
        this.ui.toast(`${it.name} 사용`);
        this.ui.showPanel("메뉴", this.renderMenuHtml("BAG"));
        this.wireMenuHandlers();
      });
    });

    // settings buttons
    const sSave = this.ui.elPanelBody.querySelector("#btnSettingsSave");
    if(sSave) sSave.addEventListener("click", ()=>this.saveNow());
    const sReset = this.ui.elPanelBody.querySelector("#btnSettingsReset");
    if(sReset) sReset.addEventListener("click", ()=>this.resetAll());
  }

  // --- Battle
  startBattle({mode, enemyParty, allowCapture, reward, trainerNpcId=null}){
    if(!this.save.party.length){
      this.ui.toast("파티가 비어 있어 전투할 수 없다.");
      return;
    }

    // convert saved instances into battle instances
    const playerParty = this.save.party.map(m=>deepCopy(m));

    // Create engine
    const engine = new BattleEngine(this.data, this.data.config, Math.random);
    engine.init({mode, playerParty, enemyParty, allowCapture, reward});

    this.battle = {engine, trainerNpcId, mode};

    this.mode = "BATTLE";
    this.ui.hidePanel();
    this.ui.showBattle();

    // wire battle action buttons
    this.ui.elBattleActions.querySelectorAll("button[data-action]").forEach(btn=>{
      btn.onclick = ()=>this.onBattleAction(btn.dataset.action);
    });

    this.syncBattleHeader();
    this.ui.appendBattleLog(engine.log.join("\n"));
    engine.log.length = 0;
  }

  syncBattleHeader(){
    if(!this.battle) return;
    const engine = this.battle.engine;
    const p = engine.getActive("PLAYER");
    const e = engine.getActive("ENEMY");
    this.ui.setBattleHeader({
      enemyName: `${e.form.name_kr} Lv${e.level}`,
      enemyHp: e.hp,
      enemyMaxHp: e.statsBase.maxHp,
      playerName: `${p.form.name_kr} Lv${p.level}`,
      playerHp: p.hp,
      playerMaxHp: p.statsBase.maxHp,
    });
  }

  async onBattleAction(action){
    if(!this.battle) return;
    const engine = this.battle.engine;

    if(engine.isFinished()){
      this.finishBattle();
      return;
    }

    if(action === "FIGHT"){
      this.openSkillMenu();
      return;
    }
    if(action === "BAG"){
      this.openBattleBagMenu();
      return;
    }
    if(action === "CAPTURE"){
      this.attemptCaptureInBattle();
      return;
    }
    if(action === "RUN"){
      await engine.playerAction({type:"RUN"});
      this.flushBattleLog();
      if(engine.isFinished()) this.finishBattle();
      return;
    }
  }

  flushBattleLog(){
    const engine = this.battle.engine;
    for(const l of engine.log){
      this.ui.appendBattleLog(l);
    }
    engine.log.length = 0;
    this.syncBattleHeader();
  }

  openSkillMenu(){
    const engine = this.battle.engine;
    const p = engine.getActive("PLAYER");
    const skills = p.activeSkillIds.map(id=>this.data.getSkill(id)).filter(Boolean);

    if(!skills.length){
      this.ui.toast("사용할 기술이 없다.");
      return;
    }

    const html = skills.map(s=>{
      const el = s.element_id ? (this.data.byElementId.get(s.element_id)?.name_kr ?? "") : "무";
      return `<button class="btn" data-skill="${s.skill_id}">${s.name_kr} <span class="badge">${el}</span></button>`;
    }).join("");

    this.ui.showBattleSubmenu(html);

    this.ui.elBattleSubmenu.querySelectorAll("button[data-skill]").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const skillId = Number(btn.dataset.skill);
        this.ui.hideBattleSubmenu();
        await engine.playerAction({type:"SKILL", skillId});
        this.flushBattleLog();
        if(engine.isFinished()) this.finishBattle();
      });
    });
  }

  openBattleBagMenu(){
    const engine = this.battle.engine;
    const healQty = this.save.inventory["HEAL_GEL"] ?? 0;
    if(healQty <= 0){
      this.ui.toast("사용할 회복 아이템이 없다.");
      return;
    }
    const it = this.data.getItemByCode("HEAL_GEL");
    const html = `
      <button class="btn" data-item="HEAL_GEL">${it.name} (${healQty})</button>
      <div class="smallText">회복 아이템은 현재 파티 1번에게 사용된다(프로토타입).</div>
    `;
    this.ui.showBattleSubmenu(html);

    this.ui.elBattleSubmenu.querySelector("button[data-item]").addEventListener("click", async ()=>{
      if((this.save.inventory["HEAL_GEL"] ?? 0) <= 0){
        this.ui.toast("수량이 부족하다.");
        return;
      }
      this.removeItem("HEAL_GEL", 1);
      this.ui.hideBattleSubmenu();
      await engine.playerAction({type:"ITEM", item: it});
      this.flushBattleLog();
      if(engine.isFinished()) this.finishBattle();
    });
  }

  attemptCaptureInBattle(){
    const engine = this.battle.engine;
    if(engine.mode !== "WILD"){
      this.ui.toast("트레이너 배틀에서는 포획할 수 없다.");
      return;
    }
    const qty = this.save.inventory["CAPTURE_ORB"] ?? 0;
    if(qty <= 0){
      this.ui.toast("포획구가 없다.");
      return;
    }
    const ball = this.data.getItemByCode("CAPTURE_ORB");
    this.removeItem("CAPTURE_ORB", 1);
    engine.playerAction({type:"CAPTURE", ballItem: ball}).then(()=>{
      this.flushBattleLog();
      if(engine.isFinished()) this.finishBattle();
    });
  }

  finishBattle(){
    const engine = this.battle.engine;
    const res = engine.result;
    if(!res){
      this.ui.hideBattle();
      this.mode = "WORLD";
      return;
    }

    if(res.winner === "CAPTURE"){
      // add captured monster to party/box
      const capturedFormId = res.capturedFormId;
      const enemy = engine.getActive("ENEMY");
      const inst = this.makeMonsterInstance({formId: capturedFormId, level: enemy.level, isWild:false});
      // mark caught
      const form = this.data.getForm(capturedFormId);
      this.save.caughtDex[String(form.dex_no)] = true;

      if(this.save.party.length < (this.data.config.partySizeMax ?? 6)){
        this.save.party.push(inst);
        this.ui.toast(`${form.name_kr}가 파티에 합류했다.`);
      }else{
        this.save.box.push(inst);
        this.ui.toast(`${form.name_kr}가 박스로 이동했다.`);
      }
    }else if(res.winner === "PLAYER"){
      // trainer defeated tracking
      if(this.battle.trainerNpcId){
        this.save.defeatedNpcs.push(this.battle.trainerNpcId);
      }
      // rewards
      if(res.reward?.gold){
        this.save.gold += res.reward.gold;
        this.ui.toast(`승리! ${res.reward.gold}G 획득`);
      }else{
        this.ui.toast("승리!");
      }
      if(res.reward?.items){
        for(const it of res.reward.items){
          this.addItem(it.code, it.qty);
        }
      }
    }else if(res.winner === "ENEMY"){
      this.ui.toast("패배했다... 치유 센터로 돌아간다.");
      // send to town and heal
      this.save.mapId = "aquaria_town";
      this.save.x = 2;
      this.save.y = 2;
      this.healParty();
    }else if(res.winner === "ESCAPE"){
      this.ui.toast("전투에서 벗어났다.");
    }

    // Persist HP from battle (player active only for prototype)
    // We'll sync party HP to engine player battlers (1:1 order)
    const pb = engine.player.party;
    for(let i=0;i<this.save.party.length && i<pb.length;i++){
      this.save.party[i].currentHp = pb[i].hp;
      this.save.party[i].battlesTotal = (this.save.party[i].battlesTotal ?? 0) + 1;
    }

    // Post-battle EXP (prototype)
    if(res.winner === "PLAYER"){
      const enemyLevel = engine.enemy.party[0].level;
      const expGain = Math.floor(enemyLevel * 18);
      const m = this.save.party[0];
      m.exp = (m.exp ?? 0) + expGain;
      this.ui.toast(`경험치 +${expGain}`);

      this.tryLevelUpAndEvolve(m);
    }

    this.battle = null;
    this.ui.hideBattle();
    this.mode = "WORLD";

    // If defeated, we already rewrote save position -> re-enter world from save (town + heal).
    // Otherwise stay on current map (important: evolution choice panel may be open).
    if(res.winner === "ENEMY"){
      this.enterWorldFromSave();
    }else{
      this.ui.setLocationLabel(`${this.map.name}`);
    }
  }

  tryLevelUpAndEvolve(m){
    // Level up using level_exp table
    let leveled = false;
    while(m.level < this.data.levelExp.length){
      const req = this.data.levelExp[m.level-1]?.expToNext ?? 999999;
      if((m.exp ?? 0) >= req){
        m.exp -= req;
        m.level += 1;
        leveled = true;
        this.ui.toast(`레벨 업! Lv${m.level}`);
      }else{
        break;
      }
    }

    if(!leveled) return;

    // Evolution check (simplified):
    // If there is any evolution with min_level <= level and conditions satisfied, evolve.
    const options = this.data.getEvolutionsFrom(m.formId).filter(e=>{
      const min = e.min_level ?? 999;
      return m.level >= min;
    });

    if(!options.length) return;

    // Filter by conditions
    const viable = options.filter(e=>this.checkEvolutionConditions(m, e));

    if(!viable.length) return;

    if(viable.length === 1){
      this.applyEvolution(m, viable[0].to_form_id);
      return;
    }

    // Branch: ask player via menu
    const html = viable.map(e=>{
      const toForm = this.data.getForm(e.to_form_id);
      return `<button class="btn" data-evo="${e.to_form_id}">${toForm.name_kr}</button>`;
    }).join("");

    this.ui.showPanel("진화 선택", `
      <div class="card">
        <div style="font-weight:900;">진화 분기</div>
        <div class="smallText">육성 방식에 따라 다른 형태로 진화할 수 있다.</div>
      </div>
      <div class="row">${html}</div>
    `);

    this.ui.elPanelBody.querySelectorAll("button[data-evo]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const toId = Number(btn.dataset.evo);
        this.applyEvolution(m, toId);
        this.ui.hidePanel();
      });
    });
  }

  checkEvolutionConditions(instance, evo){
    const conds = this.data.getEvolutionConditions(evo.evolution_id);
    if(!conds.length) return true;

    // All AND for prototype
    for(const c of conds){
      if(c.condition_key === "TRAIN_STYLE"){
        const styleId = c.training_style_id;
        if(styleId && instance.trainingStyleId !== styleId) return false;
      }else if(c.condition_key === "AFFECTION"){
        const need = c.value_int ?? 0;
        if((instance.affection ?? 0) < need) return false;
      }else if(c.condition_key === "BATTLES_TOTAL"){
        const need = c.value_int ?? 0;
        if((instance.battlesTotal ?? 0) < need) return false;
      }else if(c.condition_key === "ITEM"){
        // requires item in inventory, but only for ITEM evolve_type
        const itemId = c.item_id;
        const item = this.data.byItemId.get(itemId);
        if(!item) return false;
        const code = item.code;
        if((this.save.inventory[code] ?? 0) <= 0) return false;
      }else if(c.condition_key === "SEAL"){
        // transcend seals etc not supported here
        return false;
      }
    }

    // If evolve_type == ITEM, we also consume item when applying evolution
    return true;
  }

  applyEvolution(instance, toFormId){
    const fromForm = this.data.getForm(instance.formId);
    const toForm = this.data.getForm(toFormId);
    if(!toForm) return;

    // If this evolution requires item, consume appropriate stone (first matching ITEM condition)
    const evoEdges = this.data.getEvolutionsFrom(instance.formId).filter(e=>e.to_form_id===toFormId);
    if(evoEdges.length){
      const edge = evoEdges[0];
      const conds = this.data.getEvolutionConditions(edge.evolution_id);
      const itemCond = conds.find(c=>c.condition_key==="ITEM" && c.item_id);
      if(itemCond){
        const item = this.data.byItemId.get(itemCond.item_id);
        if(item){
          const code = item.code;
          if((this.save.inventory[code] ?? 0) > 0){
            this.removeItem(code, 1);
            this.ui.toast(`${item.name_kr} 1개 소모`);
          }
        }
      }
    }

    instance.formId = toFormId;
    instance.currentHp = null; // reset to full on evolve for prototype
    this.ui.toast(`${fromForm.name_kr} → ${toForm.name_kr} 진화!`);
  }
}

const game = new GameApp();
game.start();
