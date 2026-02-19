// js/ui/ui.js
import { clamp } from "../core/utils.js";

export class UI{
  constructor(){
    this.elDialogueBox = document.getElementById("dialogueBox");
    this.elDialogueName = document.getElementById("dialogueName");
    this.elDialogueText = document.getElementById("dialogueText");

    this.elToast = document.getElementById("toast");

    this.elPanel = document.getElementById("panel");
    this.elPanelTitle = document.getElementById("panelTitle");
    this.elPanelBody = document.getElementById("panelBody");
    this.elPanelClose = document.getElementById("panelClose");

    this.elLocationLabel = document.getElementById("locationLabel");

    // battle UI
    this.elBattle = document.getElementById("battleUI");
    this.elBattleLog = document.getElementById("battleLog");
    this.elBattleActions = document.getElementById("battleActions");
    this.elBattleSubmenu = document.getElementById("battleSubmenu");

    this.elEnemyName = document.getElementById("enemyName");
    this.elEnemyHpFill = document.getElementById("enemyHpFill");
    this.elEnemyHpText = document.getElementById("enemyHpText");

    this.elPlayerName = document.getElementById("playerName");
    this.elPlayerHpFill = document.getElementById("playerHpFill");
    this.elPlayerHpText = document.getElementById("playerHpText");

    // controls
    this.btnMenu = document.getElementById("btnMenu");
    this.btnSave = document.getElementById("btnSave");
    this.btnReset = document.getElementById("btnReset");

    this._toastTimer = null;
    this._dialogueQueue = null;
    this._dialogueResolve = null;

    this.elPanelClose.addEventListener("click", ()=>this.hidePanel());
  }

  setLocationLabel(text){
    this.elLocationLabel.textContent = text;
  }

  toast(text, ms=1500){
    this.elToast.textContent = text;
    this.elToast.classList.remove("hidden");
    if(this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(()=>{
      this.elToast.classList.add("hidden");
    }, ms);
  }

  async dialogue(lines, name=null){
    // lines: array of strings
    if(!Array.isArray(lines)) lines = [String(lines)];
    this._dialogueQueue = [...lines];
    this._dialogueResolve = null;

    this.elDialogueName.textContent = name ?? "";
    this.elDialogueBox.classList.remove("hidden");
    this._renderDialogueLine();

    return new Promise(resolve=>{
      this._dialogueResolve = resolve;
    });
  }

  _renderDialogueLine(){
    const line = this._dialogueQueue?.[0] ?? "";
    this.elDialogueText.textContent = line;
  }

  advanceDialogue(){
    if(!this._dialogueQueue) return false;
    this._dialogueQueue.shift();
    if(this._dialogueQueue.length === 0){
      this.elDialogueBox.classList.add("hidden");
      const r = this._dialogueResolve;
      this._dialogueQueue = null;
      this._dialogueResolve = null;
      if(r) r();
      return true;
    }else{
      this._renderDialogueLine();
      return true;
    }
  }

  showPanel(title, html){
    this.elPanelTitle.textContent = title;
    this.elPanelBody.innerHTML = html;
    this.elPanel.classList.remove("hidden");
  }

  hidePanel(){
    this.elPanel.classList.add("hidden");
    this.elPanelBody.innerHTML = "";
  }

  panelIsOpen(){
    return !this.elPanel.classList.contains("hidden");
  }

  // --- Battle UI helpers
  showBattle(){
    this.elBattle.classList.remove("hidden");
    this.elBattleLog.textContent = "";
    this.hideBattleSubmenu();
  }

  hideBattle(){
    this.elBattle.classList.add("hidden");
    this.elBattleLog.textContent = "";
    this.hideBattleSubmenu();
  }

  appendBattleLog(line){
    this.elBattleLog.textContent += line + "\n";
    this.elBattleLog.scrollTop = this.elBattleLog.scrollHeight;
  }

  setBattleHeader({enemyName, enemyHp, enemyMaxHp, playerName, playerHp, playerMaxHp}){
    this.elEnemyName.textContent = enemyName;
    this.elPlayerName.textContent = playerName;
    this._setHpBar(this.elEnemyHpFill, this.elEnemyHpText, enemyHp, enemyMaxHp);
    this._setHpBar(this.elPlayerHpFill, this.elPlayerHpText, playerHp, playerMaxHp);
  }

  _setHpBar(fillEl, textEl, hp, maxHp){
    const pct = maxHp > 0 ? clamp(hp / maxHp, 0, 1) : 0;
    fillEl.style.width = `${pct*100}%`;
    textEl.textContent = `HP ${Math.max(0, hp)}/${maxHp}`;
  }

  showBattleSubmenu(html){
    this.elBattleSubmenu.innerHTML = html;
    this.elBattleSubmenu.classList.remove("hidden");
  }
  hideBattleSubmenu(){
    this.elBattleSubmenu.classList.add("hidden");
    this.elBattleSubmenu.innerHTML = "";
  }

  setBattleActionsEnabled(enabled){
    const buttons = this.elBattleActions.querySelectorAll("button");
    for(const b of buttons){
      b.disabled = !enabled;
    }
  }
}
