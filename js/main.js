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

function genderSymbol(g){
  if(g === "M") return "♂";
  if(g === "F") return "♀";
  return "—";
}

function fmtTimer(ms){
  const t = Math.max(0, Math.floor(ms/1000));
  const h = Math.floor(t/3600);
  const m = Math.floor((t%3600)/60);
  const s = t%60;
  const pad = (n)=>String(n).padStart(2,"0");
  if(h>0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
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

    this.mode = "BOOT"; // TITLE, WORLD, LAND, BATTLE
    this.save = null;

    // DOM-based raising view
    this.landEl = document.getElementById("landView");
    this._landInterval = null;

    this.map = null;
    this.npcs = [];
    this.player = {x:2,y:2, dir:{dx:0,dy:1}};

    this._moveCooldown = 0;
    this._encounterCooldownSteps = 0;

    this.battle = null; // {engine, context}

    // buttons
    this.ui.btnMode.addEventListener("click", ()=>this.toggleMode());
    this.ui.btnMenu.addEventListener("click", ()=>this.openMenu());
    this.ui.btnSave.addEventListener("click", ()=>this.saveNow());
    this.ui.btnReset.addEventListener("click", ()=>this.resetAll());

    // land view interactions (event delegation)
    this.landEl.addEventListener("click", (e)=>this.handleLandClick(e));

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
    try{
      this.ui.toast("데이터 로딩 중...");
      await this.data.loadAll();
      this.ui.toast("로딩 완료");
    }catch(err){
      console.error(err);
      const msg = (err && err.message) ? String(err.message) : String(err);
      const esc = (s)=>s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");

      this.mode = "TITLE";
      this.ui.setLocationLabel("로딩 오류");
      this.ui.showPanel("로딩 오류", `
        <div class="card">
          <div style="font-size:16px;font-weight:800;">데이터 파일을 불러오지 못했다.</div>
          <div class="smallText" style="margin-top:8px;line-height:1.5;">
            에러: <code>${esc(msg)}</code>
          </div>
          <div class="smallText" style="margin-top:10px;line-height:1.6;">
            <b>가장 흔한 원인</b><br/>
            1) GitHub 리포지토리에 <b>data/ 폴더가 누락</b>(특히 data/master/*.json)<br/>
            2) GitHub Pages 설정에서 Source 폴더가 잘못됨(루트가 아닌 다른 폴더를 보고 있음)<br/>
            3) 파일/폴더 이름 대소문자 불일치(예: Data vs data)
          </div>
          <div class="smallText" style="margin-top:10px;line-height:1.6;">
            <b>체크리스트</b><br/>
            - 리포지토리에서 index.html 옆에 <b>css/</b>, <b>js/</b>, <b>data/</b> 폴더가 있는지 확인<br/>
            - 브라우저 개발자도구(F12) → Network 탭에서 <b>404</b>가 나는 JSON 파일이 무엇인지 확인<br/>
            - GitHub Pages 배포 후 캐시 때문에 안 바뀌면 <b>Ctrl+F5</b> 강력 새로고침
          </div>
        </div>
      `);
      this.ui.toast("로딩 실패: data 폴더/Pages 설정을 확인");
      return;
    }

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
      this.migrateSave(this.save);
      this.enterWorldFromSave();
    }

    this.syncModeButton();

    requestAnimationFrame((t)=>this.loop(t));
  }

  loop(ts){
    const dt = 1/60;

    if(this.mode === "WORLD"){
      this.updateWorld(dt);
      this.renderWorld();
    }else if(this.mode === "LAND"){
      // DOM view; keep background subtle
      this.renderTitleBackground();
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

      // Raising-focused home base
      land: {
        habitats: [],
        eggs: [],
        breedingCave: {
          built: false,
          male: null,
          female: null,
          maleOrigin: null,
          femaleOrigin: null,
          state: "IDLE",
          startedAt: null,
          finishAt: null,
          readyEgg: null
        }
      }
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

  // --- Save migration / defaults for raising systems
  migrateSave(save){
    if(!save) return;
    if(!save.land){
      save.land = {
        habitats: [],
        eggs: [],
        breedingCave: {
          built:false,
          male:null,
          female:null,
          maleOrigin:null,
          femaleOrigin:null,
          state:"IDLE",
          startedAt:null,
          finishAt:null,
          readyEgg:null
        }
      };
    }
    // ensure nested structures
    save.land.habitats = Array.isArray(save.land.habitats) ? save.land.habitats : [];
    save.land.eggs = Array.isArray(save.land.eggs) ? save.land.eggs : [];
    if(!save.land.breedingCave) save.land.breedingCave = {built:false, male:null, female:null, maleOrigin:null, femaleOrigin:null, state:"IDLE", startedAt:null, finishAt:null, readyEgg:null};
    const cave = save.land.breedingCave;
    cave.built = !!cave.built;
    cave.male ??= null;
    cave.female ??= null;
    cave.maleOrigin ??= null;
    cave.femaleOrigin ??= null;
    cave.state ??= "IDLE";
    cave.startedAt ??= null;
    cave.finishAt ??= null;
    cave.readyEgg ??= null;

    // normalize habitats
    const cap = this.data.config.land?.habitatCapacity ?? 6;
    for(const h of save.land.habitats){
      h.habitatId ??= uuid();
      h.elementId ??= h.element_id ?? 1;
      h.capacity ??= cap;
      h.envTagIds = Array.isArray(h.envTagIds) ? h.envTagIds : [];
      h.monsters = Array.isArray(h.monsters) ? h.monsters : [];
    }

    // normalize eggs
    for(const e of save.land.eggs){
      e.eggId ??= uuid();
      e.startedAt ??= Date.now();
      e.hatchAt ??= (e.startedAt + this.minutesToMs(30));
      e.eggFormId ??= 1;
      e.source ??= "UNKNOWN";
    }

    // normalize monster instances across all containers
    const visit = (m)=>this.normalizeMonsterInstance(m);
    for(const m of (save.party ?? [])) visit(m);
    for(const m of (save.box ?? [])) visit(m);
    for(const h of save.land.habitats){
      for(const m of h.monsters) visit(m);
    }
    if(cave.male) visit(cave.male);
    if(cave.female) visit(cave.female);
  }

  normalizeMonsterInstance(inst){
    if(!inst) return;
    inst.instanceId ??= uuid();
    inst.nickname ??= null;
    inst.exp ??= 0;
    inst.affection ??= 0;
    inst.battlesTotal ??= 0;
    inst.trainingStyleId ??= 1;
    inst.currentHp ??= null;
    inst.isWild ??= false;
    // New for raising/breeding
    if(!inst.gender){
      const form = this.data.getForm(inst.formId);
      inst.gender = (form && form.stage_id === 1) ? null : (Math.random() < 0.5 ? "M" : "F");
    }
    inst.hunger ??= 70; // 0~100
  }

  // --- Mode switching (World <-> Land)
  syncModeButton(){
    if(!this.ui.btnMode) return;
    const disabled = (this.mode === "BOOT" || this.mode === "TITLE" || this.mode === "BATTLE");
    this.ui.btnMode.disabled = disabled;
    this.ui.btnMode.textContent = (this.mode === "LAND") ? "탐험" : "내 땅";
  }

  toggleMode(){
    if(!this.save){
      this.ui.toast("먼저 새 게임을 시작해라.");
      return;
    }
    if(this.mode === "BATTLE"){
      this.ui.toast("전투 중에는 이동할 수 없다.");
      return;
    }
    if(this.mode === "LAND"){
      this.exitLandToWorld();
      return;
    }
    if(this.mode === "WORLD"){
      this.enterLand();
      return;
    }
    this.ui.toast("지금은 이동할 수 없다.");
  }

  enterLand(){
    if(!this.save) return;
    this.migrateSave(this.save);

    this.mode = "LAND";
    this.ui.hidePanel();
    this.ui.hideBattle();
    this.canvas.classList.add("hidden");
    this.landEl.classList.remove("hidden");
    this.ui.setLocationLabel("내 땅");
    this.renderLand();
    this.startLandTicker();
    this.syncModeButton();
  }

  exitLandToWorld(){
    this.stopLandTicker();
    this.landEl.classList.add("hidden");
    this.canvas.classList.remove("hidden");
    this.enterWorldFromSave();
    this.syncModeButton();
  }

  startLandTicker(){
    this.stopLandTicker();
    this._landInterval = setInterval(()=>{
      if(this.mode !== "LAND") return;
      this.tickLand();
      this.updateLandTimersUI();
    }, 500);
  }

  stopLandTicker(){
    if(this._landInterval){
      clearInterval(this._landInterval);
      this._landInterval = null;
    }
  }

  minutesToMs(minutes){
    const minuteMs = this.data.config.time?.minuteMs ?? 60000;
    return Math.max(0, minutes) * minuteMs;
  }

  elementNameKr(elementId){
    return this.data.byElementId.get(elementId)?.name_kr ?? "무";
  }

  rarityNameKr(rarityId){
    return this.data.getRarity(rarityId)?.name_kr ?? "?";
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
      this.migrateSave(this.save);
      this.ui.hidePanel();
      this.enterWorldFromSave();
      this.syncModeButton();
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
        this.migrateSave(this.save);
        this.ui.hidePanel();
        this.enterWorldFromSave();
        this.syncModeButton();
      });
    }
  }

  // --- World
  enterWorldFromSave(){
    // Ensure world canvas is visible
    this.stopLandTicker();
    this.landEl.classList.add("hidden");
    this.canvas.classList.remove("hidden");

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
      gender: (Math.random() < 0.5 ? "M" : "F"),
      hunger: 70,
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

    // Raising focus: starter starts in your Land habitat (party is empty until you assign one)
    this.save.party = [];
    // starter is owned -> caught
    const form = this.data.getForm(formId);
    this.save.caughtDex[String(form.dex_no)] = true;
    this.save.gotStarter = true;

    // Create starter habitat (free) and place starter
    this.ensureHabitatForElement(form.element_id, {free:true});
    const h = this.getFirstHabitatForElement(form.element_id);
    if(h && h.monsters.length < h.capacity){
      h.monsters.push(inst);
    }else{
      this.save.box.push(inst);
    }

    // Give one starter egg so the incubation loop is visible immediately
    this.addEggToIncubator({elementId: form.element_id, source: "LAB"});

    this.ui.hidePanel();
    this.ui.toast("스타터를 얻었다! 내 땅에서 육성해보자.");

    // Jump to Land view
    this.enterLand();
  }

  // --- Land (Raising / Habitats / Breeding)
  handleLandClick(e){
    if(this.mode !== "LAND") return;
    const t = e.target;

    const monBtn = t.closest("[data-monster]");
    if(monBtn){
      const id = monBtn.dataset.monster;
      this.openMonsterPanel(id);
      return;
    }

    const buildHabBtn = t.closest("[data-open-build-habitat]");
    if(buildHabBtn){
      this.openBuildHabitatPanel();
      return;
    }

    const hatchBtn = t.closest("[data-hatch]");
    if(hatchBtn){
      this.hatchEgg(hatchBtn.dataset.hatch);
      return;
    }

    const buildCaveBtn = t.closest("[data-build-cave]");
    if(buildCaveBtn){
      this.buildBreedingCave();
      return;
    }

    const pickMaleBtn = t.closest("[data-breed-pick]");
    if(pickMaleBtn){
      const slot = pickMaleBtn.dataset.breedPick; // male | female
      this.openBreedPickPanel(slot);
      return;
    }

    const removeBreedBtn = t.closest("[data-breed-remove]");
    if(removeBreedBtn){
      const slot = removeBreedBtn.dataset.breedRemove;
      this.removeFromBreedingCave(slot);
      return;
    }

    const startBreedBtn = t.closest("[data-breed-start]");
    if(startBreedBtn){
      this.startBreeding();
      return;
    }

    const collectBtn = t.closest("[data-breed-collect]");
    if(collectBtn){
      this.collectBreedingEgg();
      return;
    }
  }

  tickLand(){
    if(!this.save) return;
    const cave = this.save.land?.breedingCave;
    if(!cave || !cave.built) return;
    if(cave.state === "BREEDING" && cave.finishAt && Date.now() >= cave.finishAt){
      cave.state = "READY";
      cave.readyEgg = this.makeBreedingEgg();
      this.ui.toast("교배가 완료됐다. 알을 수거할 수 있다.", 2000);
      this.renderLand();
    }
  }

  updateLandTimersUI(){
    if(this.mode !== "LAND") return;
    const now = Date.now();
    // eggs
    this.landEl.querySelectorAll("[data-until]").forEach(el=>{
      const until = Number(el.dataset.until || "0");
      if(!until) return;
      const left = until - now;
      el.textContent = (left <= 0) ? "완료" : fmtTimer(left);
    });
  }

  renderLand(){
    if(!this.save || this.mode !== "LAND") return;
    this.migrateSave(this.save);
    const land = this.save.land;
    const cfgLand = this.data.config.land ?? {};
    const now = Date.now();

    const pills = [
      `<span class="pill">소지금 <b>${this.save.gold}G</b></span>`,
      `<span class="pill">파티 <b>${this.save.party.length}/${this.data.config.partySizeMax ?? 6}</b></span>`,
      `<span class="pill">박스 <b>${this.save.box.length}/${this.data.config.boxSizeMax ?? 60}</b></span>`,
      `<span class="pill">알 <b>${land.eggs.length}</b></span>`,
    ].join(" ");

    const habitatHtml = land.habitats.length ? land.habitats.map(h=>{
      const elName = this.elementNameKr(h.elementId);
      const envNames = (h.envTagIds ?? []).map(id=>this.data.getEnvTag(id)?.name_kr ?? `ENV_${id}`).join(", ");
      const mons = (h.monsters ?? []).map(m=>{
        const f = this.data.getForm(m.formId);
        return `<button class="chip" data-monster="${m.instanceId}">${f.name_kr} Lv${m.level} ${genderSymbol(m.gender)}</button>`;
      }).join("") || `<div class="smallText">비어 있음</div>`;
      return `
        <div class="habitatCard">
          <div class="habitatHeader">
            <div>
              <div style="font-weight:900;">${elName} 서식지 <span class="badge">${h.monsters.length}/${h.capacity}</span></div>
              <div class="smallText">환경: ${envNames || "기본"}</div>
            </div>
            <div></div>
          </div>
          <div class="chips">${mons}</div>
        </div>
      `;
    }).join("") : `<div class="smallText">아직 서식지가 없다. 아래에서 건설해라.</div>`;

    const eggsHtml = land.eggs.length ? land.eggs.map(egg=>{
      const f = this.data.getForm(egg.eggFormId);
      const elName = this.elementNameKr(f.element_id);
      const ready = now >= egg.hatchAt;
      const left = egg.hatchAt - now;
      return `
        <div class="card">
          <div style="font-weight:900;">${f.name_kr} <span class="badge">${elName}</span></div>
          <div class="kv"><span>부화까지</span> <b class="timer" data-until="${egg.hatchAt}">${ready ? "완료" : fmtTimer(left)}</b></div>
          <div class="kv"><span>출처</span> <b>${egg.source ?? "?"}</b></div>
          ${ready ? `<button class="btn small" data-hatch="${egg.eggId}" style="margin-top:8px;">부화</button>` : ""}
        </div>
      `;
    }).join("") : `<div class="smallText">부화 중인 알이 없다. (성체부터 교배로 알을 얻을 수 있다.)</div>`;

    const cave = land.breedingCave;
    let caveHtml = "";
    if(!cave.built){
      const cost = cfgLand.breedingCaveBuildCost ?? 800;
      caveHtml = `
        <div class="card">
          <div style="font-weight:900;">교배 동굴</div>
          <div class="smallText">성체 이상(♂♀) 2마리를 넣으면 시간이 지난 뒤 알을 얻는다.</div>
          <div class="kv"><span>건설 비용</span> <b>${cost}G</b></div>
          <button class="btn" data-build-cave style="margin-top:8px;">교배 동굴 건설</button>
        </div>
      `;
    }else{
      const male = cave.male ? `${this.data.getForm(cave.male.formId).name_kr} Lv${cave.male.level} ${genderSymbol(cave.male.gender)}` : null;
      const female = cave.female ? `${this.data.getForm(cave.female.formId).name_kr} Lv${cave.female.level} ${genderSymbol(cave.female.gender)}` : null;

      let statusLine = `<span class="pill">상태 <b>${cave.state}</b></span>`;
      if(cave.state === "BREEDING" && cave.finishAt){
        statusLine = `<span class="pill">교배 중 <b class="timer" data-until="${cave.finishAt}">${fmtTimer(cave.finishAt-now)}</b></span>`;
      }
      if(cave.state === "READY"){
        statusLine = `<span class="pill">완료 <b>알 수거 가능</b></span>`;
      }

      caveHtml = `
        <div class="card">
          <div style="font-weight:900;">교배 동굴</div>
          <div class="smallText">같은 속성끼리만 교배 가능 (다속성은 다음 단계에서).</div>
          <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
            <span class="pill">수컷: <b>${male ?? "없음"}</b></span>
            <span class="pill">암컷: <b>${female ?? "없음"}</b></span>
            ${statusLine}
          </div>

          <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
            ${cave.male ? `<button class="btn small" data-breed-remove="male">수컷 빼기</button>` : `<button class="btn small" data-breed-pick="male">수컷 선택</button>`}
            ${cave.female ? `<button class="btn small" data-breed-remove="female">암컷 빼기</button>` : `<button class="btn small" data-breed-pick="female">암컷 선택</button>`}
            <button class="btn small" data-breed-start ${(!cave.male || !cave.female || cave.state==="BREEDING") ? "disabled" : ""}>교배 시작</button>
            ${cave.state === "READY" ? `<button class="btn small" data-breed-collect>알 수거</button>` : ""}
          </div>
        </div>
      `;
    }

    const partyChips = this.save.party.length ? this.save.party.map(m=>{
      const f = this.data.getForm(m.formId);
      return `<button class="chip" data-monster="${m.instanceId}">${f.name_kr} Lv${m.level} ${genderSymbol(m.gender)}</button>`;
    }).join("") : `<div class="smallText">파티가 비어 있다. 서식지의 몬스터를 파티로 옮겨 탐험할 수 있다.</div>`;

    const boxChips = this.save.box.length ? this.save.box.map(m=>{
      const f = this.data.getForm(m.formId);
      return `<button class="chip" data-monster="${m.instanceId}">${f.name_kr} Lv${m.level} ${genderSymbol(m.gender)}</button>`;
    }).join("") : `<div class="smallText">박스가 비어 있다.</div>`;

    this.landEl.innerHTML = `
      <div class="landHeader">
        <div>
          <div class="landTitle">내 땅</div>
          <div class="smallText">서식지에 배치 → 먹이/훈련 → 진화 → 성체부터 교배 → 알 부화</div>
        </div>
        <div style="text-align:right;">${pills}</div>
      </div>

      <div class="landGrid">
        <div class="section">
          <div class="sectionTitle">서식지</div>
          <div class="habitatList">${habitatHtml}</div>
          <div style="margin-top:10px;">
            <button class="btn small" data-open-build-habitat>서식지 건설</button>
          </div>
        </div>

        <div class="section">
          <div class="sectionTitle">부화</div>
          ${eggsHtml}
          <div class="sectionTitle" style="margin-top:12px;">교배</div>
          ${caveHtml}
        </div>
      </div>

      <div class="section" style="margin-top:12px;">
        <div class="sectionTitle">파티 / 박스</div>
        <div class="twoCol">
          <div>
            <div style="font-weight:900; margin-bottom:6px;">파티</div>
            <div class="chips">${partyChips}</div>
          </div>
          <div>
            <div style="font-weight:900; margin-bottom:6px;">박스</div>
            <div class="chips">${boxChips}</div>
          </div>
        </div>
      </div>
    `;

    this.updateLandTimersUI();
  }

  openBuildHabitatPanel(){
    const land = this.save.land;
    const cfgLand = this.data.config.land ?? {};
    const max = cfgLand.maxHabitats ?? 10;
    const used = land.habitats.length;
    const rows = this.data.elements.map(el=>{
      const cost = (cfgLand.habitatBuildCosts ?? {})[String(el.element_id)] ?? 200;
      return `
        <div class="card">
          <div style="font-weight:900;">${el.name_kr} 서식지</div>
          <div class="smallText">해당 속성 몬스터만 배치 가능.</div>
          <div class="kv"><span>비용</span><b>${cost}G</b></div>
          <button class="btn" data-build-habitat="${el.element_id}" style="margin-top:8px;width:100%;" ${used>=max ? "disabled" : ""}>건설</button>
        </div>
      `;
    }).join("");

    const html = `
      <div class="card">
        <div style="font-weight:900;">서식지 건설</div>
        <div class="smallText">현재 서식지: <b>${used}/${max}</b> · 소지금: <b>${this.save.gold}G</b></div>
      </div>
      <div class="row">${rows}</div>
    `;
    this.ui.showPanel("서식지 건설", html);

    this.ui.elPanelBody.querySelectorAll("button[data-build-habitat]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const elementId = Number(btn.dataset.buildHabitat);
        this.createHabitat(elementId, {free:false});
        this.ui.hidePanel();
        this.renderLand();
      });
    });
  }

  createHabitat(elementId, {free=false}={}){
    const land = this.save.land;
    const cfgLand = this.data.config.land ?? {};
    const max = cfgLand.maxHabitats ?? 10;
    if(land.habitats.length >= max){
      this.ui.toast("더 이상 서식지를 건설할 수 없다.");
      return null;
    }
    const cost = (cfgLand.habitatBuildCosts ?? {})[String(elementId)] ?? 200;
    if(!free){
      if(this.save.gold < cost){
        this.ui.toast("소지금이 부족하다.");
        return null;
      }
      this.save.gold -= cost;
    }
    const envTagIds = (cfgLand.habitatEnvTagsByElement ?? {})[String(elementId)] ?? [];
    const h = {
      habitatId: uuid(),
      elementId,
      capacity: cfgLand.habitatCapacity ?? 6,
      envTagIds: [...envTagIds],
      monsters: [],
    };
    land.habitats.push(h);
    this.ui.toast("서식지를 건설했다.");
    return h;
  }

  ensureHabitatForElement(elementId, {free=false}={}){
    const existing = this.getFirstHabitatForElement(elementId);
    if(existing) return existing;
    return this.createHabitat(elementId, {free});
  }

  getFirstHabitatForElement(elementId){
    return this.save.land.habitats.find(h=>h.elementId === elementId) ?? null;
  }

  buildBreedingCave(){
    const land = this.save.land;
    const cfgLand = this.data.config.land ?? {};
    const cost = cfgLand.breedingCaveBuildCost ?? 800;
    if(land.breedingCave.built){
      this.ui.toast("이미 교배 동굴이 있다.");
      return;
    }
    if(this.save.gold < cost){
      this.ui.toast("소지금이 부족하다.");
      return;
    }
    this.save.gold -= cost;
    land.breedingCave.built = true;
    this.ui.toast("교배 동굴을 건설했다.");
    this.renderLand();
  }

  // --- Eggs
  getEggFormIdForElement(elementId){
    // egg forms are stage_id=1; we pick the one matching element
    const egg = this.data.forms.find(f=>f.stage_id===1 && f.element_id===elementId);
    return egg?.form_id ?? elementId;
  }

  getEggProps(eggFormId){
    return this.data.eggProps.find(e=>e.egg_form_id === eggFormId) ?? null;
  }

  addEggToIncubator({elementId, source="UNKNOWN", tier=null, parents=null}={}){
    const eggFormId = this.getEggFormIdForElement(elementId);
    const eggProps = this.getEggProps(eggFormId);
    const baseMin = eggProps?.base_incubation_minutes ?? 240;
    const mult = (tier && this.data.config.land?.eggIncubationTierMultiplier != null)
      ? (1 + (this.data.config.land.eggIncubationTierMultiplier * (tier-1)))
      : 1;
    const incMin = Math.round(baseMin * mult);
    const startedAt = Date.now();
    const hatchAt = startedAt + this.minutesToMs(incMin);
    const egg = {
      eggId: uuid(),
      eggFormId,
      startedAt,
      hatchAt,
      source,
      tier: tier ?? null,
      parents: parents ?? null,
    };
    this.save.land.eggs.push(egg);
    this.ui.toast("알을 얻었다.");
    this.renderLand();
  }

  hatchEgg(eggId){
    const land = this.save.land;
    const idx = land.eggs.findIndex(e=>e.eggId === eggId);
    if(idx < 0) return;
    const egg = land.eggs[idx];
    if(Date.now() < egg.hatchAt){
      this.ui.toast("아직 부화할 수 없다.");
      return;
    }
    land.eggs.splice(idx, 1);
    const eggForm = this.data.getForm(egg.eggFormId);
    const elementId = eggForm.element_id;
    const candidates = this.data.forms.filter(f=>f.stage_id===2 && f.element_id===elementId);
    if(!candidates.length){
      this.ui.toast("부화 대상이 없다.");
      return;
    }
    const weighted = candidates.map(f=>{
      const r = this.data.getRarity(f.rarity_id);
      return {weight: r?.hatch_weight ?? 10, formId: f.form_id};
    });
    const pick = weightedPick(weighted);
    const babyFormId = pick.formId;
    const inst = this.makeMonsterInstance({formId: babyFormId, level: 1, isWild:false});
    // hatched counts as caught
    const babyForm = this.data.getForm(babyFormId);
    this.save.caughtDex[String(babyForm.dex_no)] = true;

    // place into matching habitat if possible
    const h = this.getFirstHabitatForElement(elementId);
    if(h && h.monsters.length < h.capacity){
      h.monsters.push(inst);
      this.ui.toast(`${babyForm.name_kr}가 부화해 서식지로 이동했다.`);
    }else{
      this.save.box.push(inst);
      this.ui.toast(`${babyForm.name_kr}가 부화했다. 서식지가 없어 박스로 이동했다.`);
    }
    this.renderLand();
  }

  // --- Breeding cave operations
  openBreedPickPanel(slot){
    const cave = this.save.land.breedingCave;
    if(!cave.built){
      this.ui.toast("교배 동굴이 없다.");
      return;
    }
    if(cave.state === "BREEDING"){
      this.ui.toast("교배 중에는 변경할 수 없다.");
      return;
    }
    const wantGender = (slot === "male") ? "M" : "F";
    const other = (slot === "male") ? cave.female : cave.male;
    const otherElementId = other ? this.data.getForm(other.formId).element_id : null;

    const list = this.getAllAvailableMonsters().filter(m=>{
      const f = this.data.getForm(m.formId);
      if(!f || f.stage_id < 4) return false;
      if(m.gender !== wantGender) return false;
      if(otherElementId && f.element_id !== otherElementId) return false;
      return true;
    });

    const cards = list.map(m=>{
      const f = this.data.getForm(m.formId);
      const r = this.data.getRarity(f.rarity_id);
      const el = this.elementNameKr(f.element_id);
      const loc = this.getMonsterLocationLabel(m.instanceId);
      return `
        <div class="card">
          <div style="font-weight:900;">${f.name_kr} Lv${m.level} ${genderSymbol(m.gender)} <span class="badge">${el}</span></div>
          <div class="smallText">희귀도: ${r?.name_kr ?? "?"} · 위치: ${loc}</div>
          <button class="btn" data-pick-breed="${slot}|${m.instanceId}" style="margin-top:8px;width:100%;">선택</button>
        </div>
      `;
    }).join("") || `<div class="card"><div class="smallText">조건에 맞는 몬스터가 없다.</div></div>`;

    this.ui.showPanel("교배 몬스터 선택", cards);

    this.ui.elPanelBody.querySelectorAll("button[data-pick-breed]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const [slot2, id] = btn.dataset.pickBreed.split("|");
        this.assignMonsterToBreedingCave(id, slot2);
        this.ui.hidePanel();
        this.renderLand();
      });
    });
  }

  getAllAvailableMonsters(){
    // Monsters that are not currently in breeding cave
    const cave = this.save.land.breedingCave;
    const idsInCave = new Set([cave.male?.instanceId, cave.female?.instanceId].filter(Boolean));
    const out = [];
    for(const m of this.save.party) if(!idsInCave.has(m.instanceId)) out.push(m);
    for(const m of this.save.box) if(!idsInCave.has(m.instanceId)) out.push(m);
    for(const h of this.save.land.habitats){
      for(const m of h.monsters) if(!idsInCave.has(m.instanceId)) out.push(m);
    }
    return out;
  }

  getMonsterLocationLabel(instanceId){
    const loc = this.findMonster(instanceId);
    if(!loc) return "?";
    if(loc.type === "party") return "파티";
    if(loc.type === "box") return "박스";
    if(loc.type === "habitat"){
      const elName = this.elementNameKr(loc.habitat.elementId);
      return `${elName} 서식지`;
    }
    if(loc.type === "breeding") return "교배 동굴";
    return "?";
  }

  assignMonsterToBreedingCave(instanceId, slot){
    const cave = this.save.land.breedingCave;
    if(!cave.built) return;
    if(cave.state === "BREEDING"){
      this.ui.toast("교배 중에는 변경할 수 없다.");
      return;
    }
    const found = this.findMonster(instanceId);
    if(!found) return;
    const inst = this.removeMonster(instanceId);
    if(!inst) return;

    const form = this.data.getForm(inst.formId);
    if(form.stage_id < 4){
      this.ui.toast("성체 이상만 교배에 투입할 수 있다.");
      // return
      this.returnMonster(inst, found);
      return;
    }
    if(slot === "male"){
      if(inst.gender !== "M"){
        this.ui.toast("수컷 슬롯에는 ♂만 넣을 수 있다.");
        this.returnMonster(inst, found);
        return;
      }
      if(cave.male){
        this.ui.toast("이미 수컷이 있다.");
        this.returnMonster(inst, found);
        return;
      }
      // element match check
      if(cave.female){
        const fe = this.data.getForm(cave.female.formId).element_id;
        if(form.element_id !== fe){
          this.ui.toast("현재 프로토타입에서는 같은 속성끼리만 교배 가능하다.");
          this.returnMonster(inst, found);
          return;
        }
      }
      cave.male = inst;
      cave.maleOrigin = found;
      this.ui.toast("수컷을 교배 동굴에 배치했다.");
    }else{
      if(inst.gender !== "F"){
        this.ui.toast("암컷 슬롯에는 ♀만 넣을 수 있다.");
        this.returnMonster(inst, found);
        return;
      }
      if(cave.female){
        this.ui.toast("이미 암컷이 있다.");
        this.returnMonster(inst, found);
        return;
      }
      if(cave.male){
        const me = this.data.getForm(cave.male.formId).element_id;
        if(form.element_id !== me){
          this.ui.toast("현재 프로토타입에서는 같은 속성끼리만 교배 가능하다.");
          this.returnMonster(inst, found);
          return;
        }
      }
      cave.female = inst;
      cave.femaleOrigin = found;
      this.ui.toast("암컷을 교배 동굴에 배치했다.");
    }
  }

  removeFromBreedingCave(slot){
    const cave = this.save.land.breedingCave;
    if(cave.state === "BREEDING"){
      this.ui.toast("교배 중에는 뺄 수 없다.");
      return;
    }
    if(slot === "male" && cave.male){
      const m = cave.male; const origin = cave.maleOrigin;
      cave.male = null; cave.maleOrigin = null;
      this.returnMonster(m, origin);
      this.ui.toast("수컷을 동굴에서 뺐다.");
      this.renderLand();
    }
    if(slot === "female" && cave.female){
      const m = cave.female; const origin = cave.femaleOrigin;
      cave.female = null; cave.femaleOrigin = null;
      this.returnMonster(m, origin);
      this.ui.toast("암컷을 동굴에서 뺐다.");
      this.renderLand();
    }
  }

  startBreeding(){
    const cave = this.save.land.breedingCave;
    if(!cave.built) return;
    if(cave.state === "BREEDING"){
      this.ui.toast("이미 교배 중이다.");
      return;
    }
    if(!cave.male || !cave.female){
      this.ui.toast("수컷과 암컷을 모두 배치해라.");
      return;
    }
    const mf = this.data.getForm(cave.male.formId);
    const ff = this.data.getForm(cave.female.formId);
    if(mf.element_id !== ff.element_id){
      this.ui.toast("현재 프로토타입에서는 같은 속성끼리만 교배 가능하다.");
      return;
    }
    const tierA = this.data.getRarity(mf.rarity_id)?.tier ?? 1;
    const tierB = this.data.getRarity(ff.rarity_id)?.tier ?? 1;
    const tier = Math.max(tierA, tierB);
    const minutes = (this.data.config.land?.breedingBaseMinutesByTier ?? {})[String(tier)] ?? 120;
    cave.state = "BREEDING";
    cave.startedAt = Date.now();
    cave.finishAt = cave.startedAt + this.minutesToMs(minutes);
    cave.readyEgg = null;
    this.ui.toast("교배를 시작했다.");
    this.renderLand();
  }

  makeBreedingEgg(){
    const cave = this.save.land.breedingCave;
    if(!cave.male || !cave.female) return null;
    const mf = this.data.getForm(cave.male.formId);
    const ff = this.data.getForm(cave.female.formId);
    const elementId = mf.element_id;
    const tierA = this.data.getRarity(mf.rarity_id)?.tier ?? 1;
    const tierB = this.data.getRarity(ff.rarity_id)?.tier ?? 1;
    const tier = Math.max(tierA, tierB);
    const eggFormId = this.getEggFormIdForElement(elementId);
    const eggProps = this.getEggProps(eggFormId);
    const baseMin = eggProps?.base_incubation_minutes ?? 240;
    const mult = 1 + ((this.data.config.land?.eggIncubationTierMultiplier ?? 0.15) * (tier-1));
    const incMin = Math.round(baseMin * mult);
    const startedAt = Date.now();
    const hatchAt = startedAt + this.minutesToMs(incMin);
    return {
      eggId: uuid(),
      eggFormId,
      startedAt,
      hatchAt,
      source: "BREEDING",
      tier,
      parents: {
        maleFormId: mf.form_id,
        femaleFormId: ff.form_id,
      }
    };
  }

  collectBreedingEgg(){
    const cave = this.save.land.breedingCave;
    if(cave.state !== "READY" || !cave.readyEgg){
      this.ui.toast("수거할 알이 없다.");
      return;
    }
    this.save.land.eggs.push(cave.readyEgg);
    cave.readyEgg = null;
    cave.state = "IDLE";
    cave.startedAt = null;
    cave.finishAt = null;
    this.ui.toast("알을 수거했다. 부화 목록을 확인해라.");
    this.renderLand();
  }

  // --- Monster location helpers
  findMonster(instanceId){
    const id = String(instanceId);
    for(let i=0;i<this.save.party.length;i++){
      if(this.save.party[i].instanceId === id) return {type:"party", index:i, inst:this.save.party[i]};
    }
    for(let i=0;i<this.save.box.length;i++){
      if(this.save.box[i].instanceId === id) return {type:"box", index:i, inst:this.save.box[i]};
    }
    for(const h of this.save.land.habitats){
      for(let i=0;i<h.monsters.length;i++){
        if(h.monsters[i].instanceId === id) return {type:"habitat", habitat:h, index:i, inst:h.monsters[i]};
      }
    }
    const cave = this.save.land.breedingCave;
    if(cave?.male?.instanceId === id) return {type:"breeding", slot:"male", inst:cave.male};
    if(cave?.female?.instanceId === id) return {type:"breeding", slot:"female", inst:cave.female};
    return null;
  }

  removeMonster(instanceId){
    const found = this.findMonster(instanceId);
    if(!found) return null;
    if(found.type === "party") return this.save.party.splice(found.index,1)[0];
    if(found.type === "box") return this.save.box.splice(found.index,1)[0];
    if(found.type === "habitat") return found.habitat.monsters.splice(found.index,1)[0];
    if(found.type === "breeding"){
      const cave = this.save.land.breedingCave;
      if(found.slot === "male"){
        const m = cave.male; cave.male = null; cave.maleOrigin = null; return m;
      }
      if(found.slot === "female"){
        const m = cave.female; cave.female = null; cave.femaleOrigin = null; return m;
      }
    }
    return null;
  }

  returnMonster(inst, origin){
    // origin is the object returned by findMonster() BEFORE removal
    if(!origin || !inst){
      this.save.box.push(inst);
      return;
    }
    if(origin.type === "party"){
      if(this.save.party.length < (this.data.config.partySizeMax ?? 6)) this.save.party.push(inst);
      else this.save.box.push(inst);
      return;
    }
    if(origin.type === "box"){
      this.save.box.push(inst);
      return;
    }
    if(origin.type === "habitat"){
      if(origin.habitat && origin.habitat.monsters.length < origin.habitat.capacity){
        origin.habitat.monsters.push(inst);
      }else{
        this.save.box.push(inst);
      }
      return;
    }
    this.save.box.push(inst);
  }

  openMonsterPanel(instanceId){
    const found = this.findMonster(instanceId);
    if(!found){
      this.ui.toast("몬스터를 찾을 수 없다.");
      return;
    }
    const inst = found.inst;
    this.normalizeMonsterInstance(inst);
    const form = this.data.getForm(inst.formId);
    const elName = this.elementNameKr(form.element_id);
    const rarity = this.data.getRarity(form.rarity_id);
    const stageName = this.data.growthStages.find(s=>s.stage_id===form.stage_id)?.name_kr ?? "?";
    const style = this.data.getTrainingStyle(inst.trainingStyleId);
    const maxHp = this._computeMaxHp(inst);
    const curHp = inst.currentHp ?? maxHp;

    const foodButtons = Object.entries(this.save.inventory)
      .map(([code,qty])=>({code,qty,it:this.data.getItemByCode(code)}))
      .filter(o=>o.it && o.it.type === "FOOD" && o.qty > 0)
      .map(o=>`<button class="btn small" data-feed="${inst.instanceId}|${o.code}">${o.it.name} x${o.qty}</button>`)
      .join(" ") || `<div class="smallText">먹이가 없다. (상점에서 구매 가능)</div>`;

    const evoOpts = this.getEvolutionOptions(inst);
    const canEvolve = evoOpts.some(o=>o.ok);

    const canSendToBreed = (this.save.land.breedingCave?.built && form.stage_id >= 4);
    const cave = this.save.land.breedingCave;
    const breedBtn = canSendToBreed ? (()=>{
      if(inst.gender === "M" && !cave.male && cave.state !== "BREEDING") return `<button class="btn small" data-send-breed="male|${inst.instanceId}">교배 동굴(수컷)로</button>`;
      if(inst.gender === "F" && !cave.female && cave.state !== "BREEDING") return `<button class="btn small" data-send-breed="female|${inst.instanceId}">교배 동굴(암컷)로</button>`;
      return "";
    })() : "";

    const moveBtns = (()=>{
      const parts = [];
      if(found.type !== "party"){
        parts.push(`<button class="btn small" data-move="party|${inst.instanceId}">파티로</button>`);
      }
      if(found.type !== "box"){
        parts.push(`<button class="btn small" data-move="box|${inst.instanceId}">박스로</button>`);
      }
      if(found.type !== "habitat"){
        parts.push(`<button class="btn small" data-move="habitat|${inst.instanceId}">서식지로</button>`);
      }
      return parts.join(" ");
    })();

    const locLabel = this.getMonsterLocationLabel(inst.instanceId);
    const html = `
      <div class="card">
        <div style="font-weight:900; font-size:16px;">
          ${form.name_kr} Lv${inst.level} ${genderSymbol(inst.gender)}
          <span class="badge">${elName}</span>
        </div>
        <div class="smallText">${stageName} · 희귀도 ${rarity?.name_kr ?? "?"} · 위치: ${locLabel}</div>
        <div class="kv"><span>HP</span><b>${curHp}/${maxHp}</b></div>
        <div class="kv"><span>친밀도</span><b>${inst.affection}</b></div>
        <div class="kv"><span>배고픔</span><b>${inst.hunger}</b></div>
        <div class="kv"><span>훈련 스타일</span><b>${style?.name_kr ?? "?"}</b></div>
      </div>

      <div class="card">
        <div style="font-weight:900;">먹이</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
          ${foodButtons}
        </div>
      </div>

      <div class="card">
        <div style="font-weight:900;">훈련</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
          <button class="btn small" data-train="${inst.instanceId}|1">공격 훈련</button>
          <button class="btn small" data-train="${inst.instanceId}|2">수호/지원 훈련</button>
        </div>
        <div class="smallText" style="margin-top:6px;">훈련은 경험치/친밀도 상승, 진화 분기 조건에 영향을 준다.</div>
      </div>

      <div class="card">
        <div style="font-weight:900;">진화</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
          <button class="btn small" data-open-evolve="${inst.instanceId}" ${canEvolve ? "" : "disabled"}>진화하기</button>
        </div>
        <div class="smallText" style="margin-top:6px;">조건을 만족하면 분기 진화를 선택할 수 있다.</div>
      </div>

      <div class="card">
        <div style="font-weight:900;">이동</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
          ${moveBtns}
          ${breedBtn}
        </div>
      </div>
    `;
    this.ui.showPanel("몬스터", html);

    // wire buttons
    this.ui.elPanelBody.querySelectorAll("button[data-feed]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const [id, code] = btn.dataset.feed.split("|");
        this.feedMonster(id, code);
      });
    });
    this.ui.elPanelBody.querySelectorAll("button[data-train]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const [id, styleId] = btn.dataset.train.split("|");
        this.trainMonster(id, Number(styleId));
      });
    });
    const evoBtn = this.ui.elPanelBody.querySelector("button[data-open-evolve]");
    if(evoBtn){
      evoBtn.addEventListener("click", ()=>{
        this.openEvolvePanel(inst.instanceId);
      });
    }
    this.ui.elPanelBody.querySelectorAll("button[data-move]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const [dest, id] = btn.dataset.move.split("|");
        this.moveMonster(id, dest);
      });
    });
    this.ui.elPanelBody.querySelectorAll("button[data-send-breed]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const [slot, id] = btn.dataset.sendBreed.split("|");
        this.assignMonsterToBreedingCave(id, slot);
        this.ui.hidePanel();
        this.renderLand();
      });
    });
  }

  feedMonster(instanceId, itemCode){
    const found = this.findMonster(instanceId);
    if(!found) return;
    const inst = found.inst;
    const it = this.data.getItemByCode(itemCode);
    if(!it || it.type !== "FOOD"){
      this.ui.toast("먹이가 아니다.");
      return;
    }
    if((this.save.inventory[itemCode] ?? 0) <= 0){
      this.ui.toast("수량이 부족하다.");
      return;
    }
    this.removeItem(itemCode, 1);
    inst.hunger = Math.min(100, (inst.hunger ?? 0) + (it.hungerGain ?? 0));
    inst.affection = Math.max(0, (inst.affection ?? 0) + (it.affectionGain ?? 0));
    this.gainExp(inst, it.expGain ?? 0);
    this.ui.toast(`${it.name} 사용`);
    this.openMonsterPanel(inst.instanceId);
    this.renderLand();
  }

  trainMonster(instanceId, styleId){
    const found = this.findMonster(instanceId);
    if(!found) return;
    const inst = found.inst;
    inst.trainingStyleId = styleId;
    inst.battlesTotal = (inst.battlesTotal ?? 0) + 1;
    inst.affection = Math.max(0, (inst.affection ?? 0) + 2);
    inst.hunger = Math.max(0, (inst.hunger ?? 0) - 10);
    // training exp: scalable but prototype-friendly
    const expGain = Math.floor(20 + inst.level * 10);
    this.gainExp(inst, expGain);
    this.ui.toast(`훈련 완료 (+${expGain} EXP)`);
    this.openMonsterPanel(inst.instanceId);
    this.renderLand();
  }

  moveMonster(instanceId, dest){
    const found = this.findMonster(instanceId);
    if(!found) return;
    const inst = found.inst;
    if(dest === "party"){
      if(found.type === "party") return;
      if(this.save.party.length >= (this.data.config.partySizeMax ?? 6)){
        this.ui.toast("파티가 가득 찼다.");
        return;
      }
      const m = this.removeMonster(instanceId);
      this.save.party.push(m);
      this.ui.toast("파티로 이동했다.");
      this.openMonsterPanel(instanceId);
      this.renderLand();
      return;
    }
    if(dest === "box"){
      if(found.type === "box") return;
      const m = this.removeMonster(instanceId);
      this.save.box.push(m);
      this.ui.toast("박스로 이동했다.");
      this.openMonsterPanel(instanceId);
      this.renderLand();
      return;
    }
    if(dest === "habitat"){
      this.openMoveToHabitatPanel(instanceId);
      return;
    }
  }

  openMoveToHabitatPanel(instanceId){
    const found = this.findMonster(instanceId);
    if(!found) return;
    const inst = found.inst;
    const form = this.data.getForm(inst.formId);
    const elementId = form.element_id;
    const habitats = this.save.land.habitats.filter(h=>h.elementId===elementId && h.monsters.length < h.capacity);
    const elName = this.elementNameKr(elementId);
    const cards = habitats.map(h=>{
      return `
        <div class="card">
          <div style="font-weight:900;">${elName} 서식지</div>
          <div class="smallText">수용: ${h.monsters.length}/${h.capacity}</div>
          <button class="btn" data-move-habitat="${h.habitatId}|${inst.instanceId}" style="margin-top:8px;width:100%;">이곳으로 이동</button>
        </div>
      `;
    }).join("") || `<div class="card"><div class="smallText">이동 가능한 ${elName} 서식지가 없다. (서식지를 건설하거나 공간을 확보해라)</div></div>`;

    this.ui.showPanel("서식지 이동", cards);
    this.ui.elPanelBody.querySelectorAll("button[data-move-habitat]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const [habId, id] = btn.dataset.moveHabitat.split("|");
        const h = this.save.land.habitats.find(x=>x.habitatId===habId);
        if(!h){
          this.ui.toast("서식지를 찾을 수 없다.");
          return;
        }
        if(h.monsters.length >= h.capacity){
          this.ui.toast("서식지가 가득 찼다.");
          return;
        }
        const m = this.removeMonster(id);
        h.monsters.push(m);
        this.ui.hidePanel();
        this.renderLand();
        this.openMonsterPanel(id);
      });
    });
  }

  // --- Evolution panel for manual evolution
  getEvolutionOptions(inst){
    const edges = this.data.getEvolutionsFrom(inst.formId);
    return edges.map(edge=>{
      const toForm = this.data.getForm(edge.to_form_id);
      const min = edge.min_level ?? 999;
      const reasons = [];
      let ok = true;
      if(inst.level < min){ ok=false; reasons.push(`Lv${min} 필요`); }
      const conds = this.data.getEvolutionConditions(edge.evolution_id);
      for(const c of conds){
        const r = this.checkCondition(inst, c);
        if(!r.ok){ ok=false; reasons.push(r.reason); }
      }
      return {edge, toForm, ok, reasons};
    });
  }

  checkCondition(inst, cond){
    if(cond.condition_key === "TRAIN_STYLE"){
      const needId = cond.training_style_id;
      if(needId && inst.trainingStyleId !== needId){
        const s = this.data.getTrainingStyle(needId);
        return {ok:false, reason:`훈련 스타일: ${s?.name_kr ?? needId}`};
      }
      return {ok:true};
    }
    if(cond.condition_key === "AFFECTION"){
      const need = cond.value_int ?? 0;
      if((inst.affection ?? 0) < need) return {ok:false, reason:`친밀도 ${need} 필요`};
      return {ok:true};
    }
    if(cond.condition_key === "BATTLES_TOTAL"){
      const need = cond.value_int ?? 0;
      if((inst.battlesTotal ?? 0) < need) return {ok:false, reason:`누적 활동 ${need} 필요`};
      return {ok:true};
    }
    if(cond.condition_key === "ITEM" || cond.condition_key === "SEAL"){
      const itemId = cond.item_id;
      const item = this.data.byItemId.get(itemId);
      if(!item) return {ok:false, reason:"아이템 필요"};
      if((this.save.inventory[item.code] ?? 0) <= 0) return {ok:false, reason:`${item.name_kr} 필요`};
      return {ok:true};
    }
    if(cond.condition_key === "ENV_TAG"){
      const envId = cond.env_tag_id;
      const env = this.data.getEnvTag(envId);
      const found = this.findMonster(inst.instanceId);
      if(!found || found.type !== "habitat") return {ok:false, reason:`환경 필요: ${env?.name_kr ?? envId}`};
      const has = (found.habitat.envTagIds ?? []).includes(envId);
      if(!has) return {ok:false, reason:`환경 필요: ${env?.name_kr ?? envId}`};
      return {ok:true};
    }
    // Unsupported condition types default to false for safety
    return {ok:false, reason:`조건 미지원: ${cond.condition_key}`};
  }

  openEvolvePanel(instanceId){
    const found = this.findMonster(instanceId);
    if(!found){
      this.ui.toast("몬스터를 찾을 수 없다.");
      return;
    }
    const inst = found.inst;
    const fromForm = this.data.getForm(inst.formId);
    const opts = this.getEvolutionOptions(inst);
    if(!opts.length){
      this.ui.toast("진화 분기가 없다.");
      return;
    }
    const cards = opts.map(o=>{
      const toName = o.toForm?.name_kr ?? "?";
      const reasonText = o.ok ? "조건 충족" : (o.reasons.join(" · ") || "조건 미충족");
      return `
        <div class="card">
          <div style="font-weight:900;">${fromForm.name_kr} → ${toName}</div>
          <div class="smallText">${reasonText}</div>
          <button class="btn" data-do-evolve="${instanceId}|${o.edge.evolution_id}|${o.edge.to_form_id}" style="margin-top:8px;width:100%;" ${o.ok ? "" : "disabled"}>진화</button>
        </div>
      `;
    }).join("");
    this.ui.showPanel("진화", cards);
    this.ui.elPanelBody.querySelectorAll("button[data-do-evolve]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const [id, evoId, toId] = btn.dataset.doEvolve.split("|");
        this.applyEvolutionManual(id, Number(evoId), Number(toId));
      });
    });
  }

  applyEvolutionManual(instanceId, evolutionId, toFormId){
    const found = this.findMonster(instanceId);
    if(!found) return;
    const inst = found.inst;
    // Recheck viability
    const edge = this.data.getEvolutionsFrom(inst.formId).find(e=>e.evolution_id===evolutionId && e.to_form_id===toFormId);
    if(!edge){
      this.ui.toast("진화 경로를 찾을 수 없다.");
      return;
    }
    const opts = this.getEvolutionOptions(inst).find(o=>o.edge.evolution_id===evolutionId && o.edge.to_form_id===toFormId);
    if(!opts || !opts.ok){
      this.ui.toast("조건을 만족하지 않는다.");
      return;
    }
    // Consume all item/seal requirements
    const conds = this.data.getEvolutionConditions(evolutionId);
    for(const c of conds){
      if((c.condition_key === "ITEM" || c.condition_key === "SEAL") && c.item_id){
        const item = this.data.byItemId.get(c.item_id);
        if(item){
          if((this.save.inventory[item.code] ?? 0) <= 0){
            this.ui.toast(`${item.name_kr}이 부족하다.`);
            return;
          }
        }
      }
    }
    for(const c of conds){
      if((c.condition_key === "ITEM" || c.condition_key === "SEAL") && c.item_id){
        const item = this.data.byItemId.get(c.item_id);
        if(item) this.removeItem(item.code, 1);
      }
    }

    const fromForm = this.data.getForm(inst.formId);
    inst.formId = toFormId;
    inst.currentHp = null;
    const toForm = this.data.getForm(toFormId);
    this.save.seenDex[String(toForm.dex_no)] = true;
    this.save.caughtDex[String(toForm.dex_no)] = true;
    this.ui.toast(`${fromForm.name_kr} → ${toForm.name_kr} 진화!`);
    this.ui.hidePanel();
    this.renderLand();
    this.openMonsterPanel(instanceId);
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
    const items = ["CAPTURE_ORB","SUPER_ORB","HEAL_GEL","FEED_PELLET","FEED_FEAST"].map(c=>this.data.getItemByCode(c)).filter(Boolean);
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
    this.syncModeButton();
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
      this.ui.toast(`경험치 +${expGain}`);
      this.gainExp(m, expGain);
    }

    this.battle = null;
    this.ui.hideBattle();
    this.mode = "WORLD";
    this.syncModeButton();

    // If defeated, we already rewrote save position -> re-enter world from save (town + heal).
    // Otherwise stay on current map (important: evolution choice panel may be open).
    if(res.winner === "ENEMY"){
      this.enterWorldFromSave();
    }else{
      this.ui.setLocationLabel(`${this.map.name}`);
    }
  }

  gainExp(m, amount){
    const v = Math.floor(amount ?? 0);
    if(v <= 0) return;
    m.exp = (m.exp ?? 0) + v;
    this.tryLevelUpAndEvolve(m);
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

    // In raising-focused version, evolution is manual.
    // We only notify that an evolution branch is available.
    const options = this.data.getEvolutionsFrom(m.formId).filter(e=>m.level >= (e.min_level ?? 999));
    if(!options.length) return;

    const ready = this.getEvolutionOptions(m).filter(o=>o.ok);
    if(ready.length){
      this.ui.toast("진화 가능! '내 땅'에서 진화를 진행해라.", 2500);
    }else{
      this.ui.toast("진화 분기가 열렸다. 조건을 맞추면 진화할 수 있다.", 2500);
    }
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
