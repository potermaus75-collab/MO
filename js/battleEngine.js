// js/battle/battleEngine.js
import { clamp, rand, randInt, weightedPick } from "../core/utils.js";

const TRIGGER = {
  ON_CAST: 1,
  ON_BATTLE_START: 2,
  ON_HIT: 3,
  ON_TURN_END: 4,
  ON_DAMAGE_CALC: 5,
  ON_STATUS_TICK: 6,
  ON_TURN_START: 8,
  ON_ACTION_ATTEMPT: 9,
  ON_ACCURACY_CALC: 10,
  ON_STAT_CALC: 11,
};

function isDebuffStatusId(statusId){
  // Shield(8), Regen(9) are buffs. Others in our v3 list are debuffs.
  return ![8,9].includes(statusId);
}

export class BattleEngine{
  constructor(data, config, rng=Math.random){
    this.data = data;
    this.config = config;
    this.rng = rng;

    this.mode = "WILD"; // or "TRAINER"
    this.turn = 1;

    this.player = null; // {party: [BattleMonster], active:0}
    this.enemy = null;

    this.log = [];
    this.finished = false;
    this.result = null; // {winner: "PLAYER"|"ENEMY"|"ESCAPE"|"CAPTURE", reward?}

    this.context = {
      // used for condition evaluation
      lastSkillElementId: null,
      lastSkillWasAllyTarget: false,
      lastDamageDealt: 0,
      lastSkillId: null,
    };
  }

  init({mode, playerParty, enemyParty, allowCapture=true, reward=null}){
    this.mode = mode;
    this.allowCapture = allowCapture;
    this.reward = reward;

    this.player = { party: playerParty.map(p=>this._makeBattler("PLAYER", p)), active: 0 };
    this.enemy  = { party: enemyParty.map(p=>this._makeBattler("ENEMY", p)), active: 0 };

    this.turn = 1;
    this.finished = false;
    this.result = null;
    this.log = [];

    // Battle start triggers
    this._triggerAll(TRIGGER.ON_BATTLE_START);
    this._syncLog(`[전투 시작]`);
  }

  _makeBattler(side, instance){
    // instance: {instanceId, formId, level, natureId, iv, ev, battlesTotal, affection, trainingStyleId}
    const form = this.data.getForm(instance.formId);
    const rarity = this.data.getRarity(form.rarity_id);
    const nature = this.data.getNature(instance.natureId);

    const baseHp = form.base_hp;
    const baseAtk = form.base_atk;
    const baseDef = form.base_def;
    const baseSpd = form.base_spd;

    // Simplified scaling (tunable)
    const lvl = instance.level;
    const iv = instance.iv ?? {hp:0, atk:0, def:0, spd:0};
    const ev = instance.ev ?? {hp:0, atk:0, def:0, spd:0};

    const maxHp = Math.floor((baseHp + iv.hp + ev.hp/4) * rarity.stat_multiplier * nature.hp_mult + lvl*6);
    const atk = Math.floor((baseAtk + iv.atk + ev.atk/4) * rarity.stat_multiplier * nature.atk_mult + lvl*2);
    const def = Math.floor((baseDef + iv.def + ev.def/4) * rarity.stat_multiplier * nature.def_mult + lvl*2);
    const spd = Math.floor((baseSpd + iv.spd + ev.spd/4) * rarity.stat_multiplier * nature.spd_mult + lvl*1.5);

    // Skills for this form
    const fs = this.data.getFormSkills(form.form_id);
    const activeSkills = [];
    const passiveSkills = [];
    for(const s of fs){
      const skill = this.data.getSkill(s.skill_id);
      if(skill.skill_kind === "ACTIVE") activeSkills.push(skill.skill_id);
      else passiveSkills.push(skill.skill_id);
    }

    return {
      side,
      instance,
      form,
      rarity,
      nature,
      level: lvl,

      statsBase: {maxHp: maxHp, atk, def, spd, acc: 1.0},
      hp: Math.min(instance.currentHp ?? maxHp, maxHp),
      statuses: new Map(), // statusId -> {turnsLeft, meta}
      mods: [], // {stat, mult, turnsLeft}
      passiveSkillIds: passiveSkills,
      activeSkillIds: activeSkills,

      nextHitApplyStatus: null, // {statusId, duration, chance}
    };
  }

  // --- Public getters
  getActive(side){
    const s = side === "PLAYER" ? this.player : this.enemy;
    return s.party[s.active];
  }

  isFinished(){ return this.finished; }

  // --- Turn flow
  async playerAction(action){
    if(this.finished) return;

    const p = this.getActive("PLAYER");
    const e = this.getActive("ENEMY");

    // Attempt to act (status may prevent)
    if(!this._canAct(p)){
      this._syncLog(`${p.form.name_kr}는(은) 몸이 굳어 움직일 수 없다!`);
      await this._enemyTurn();
      this._endTurn();
      return;
    }

    if(action.type === "SKILL"){
      await this._useSkill(p, e, action.skillId);
      if(this.finished) return;

      await this._enemyTurn();
      if(this.finished) return;

      this._endTurn();
    }else if(action.type === "ITEM"){
      this._syncLog(`${p.form.name_kr}에게 ${action.item.name} 사용!`);
      if(action.item.type === "HEAL"){
        const heal = Math.floor(p.statsBase.maxHp * (action.item.healRatio ?? 0.3));
        this._heal(p, heal);
        this._syncLog(`HP가 ${heal} 회복됐다.`);
      }
      await this._enemyTurn();
      if(this.finished) return;
      this._endTurn();
    }else if(action.type === "RUN"){
      if(this.mode === "TRAINER"){
        this._syncLog("트레이너 배틀에서는 도망칠 수 없다!");
        return;
      }
      const chance = this.config.battle?.runBaseChance ?? 0.4;
      if(this.rng() < chance){
        this._syncLog("무사히 도망쳤다!");
        this.finished = true;
        this.result = { winner: "ESCAPE" };
        return;
      }else{
        this._syncLog("도망치지 못했다!");
        await this._enemyTurn();
        if(this.finished) return;
        this._endTurn();
      }
    }else if(action.type === "CAPTURE"){
      if(!this.allowCapture || this.mode !== "WILD"){
        this._syncLog("지금은 포획할 수 없다.");
        return;
      }
      const outcome = this._attemptCapture(p, e, action.ballItem);
      if(outcome.captured){
        this._syncLog(`${e.form.name_kr}를 포획했다!`);
        this.finished = true;
        this.result = { winner: "CAPTURE", capturedFormId: e.form.form_id };
        return;
      }else{
        this._syncLog("포획 실패!");
        await this._enemyTurn();
        if(this.finished) return;
        this._endTurn();
      }
    }
  }

  async _enemyTurn(){
    const p = this.getActive("PLAYER");
    const e = this.getActive("ENEMY");

    if(!this._canAct(e)){
      this._syncLog(`상대 ${e.form.name_kr}는(은) 행동하지 못했다!`);
      return;
    }

    // basic AI: random active skill
    const skillId = e.activeSkillIds.length ? e.activeSkillIds[Math.floor(this.rng()*e.activeSkillIds.length)] : null;
    if(skillId){
      await this._useSkill(e, p, skillId);
    }else{
      // fallback: do nothing
      this._syncLog(`상대 ${e.form.name_kr}는(은) 망설이고 있다...`);
    }
  }

  _endTurn(){
    if(this.finished) return;

    // status ticks: for both sides, turn-end tick
    this._triggerAll(TRIGGER.ON_TURN_END);

    // decrement durations
    for(const side of [this.player, this.enemy]){
      for(const b of side.party){
        this._tickDown(b);
      }
    }

    // Check faint conditions
    this._checkFaints();

    this.turn += 1;
  }

  _tickDown(b){
    // statuses
    for(const [sid,st] of b.statuses.entries()){
      st.turnsLeft -= 1;
      if(st.turnsLeft <= 0){
        b.statuses.delete(sid);
      }
    }
    // mods
    b.mods = b.mods.map(m=>({...m, turnsLeft: m.turnsLeft - 1})).filter(m=>m.turnsLeft > 0);
    // nextHit buff could expire? keep until used for prototype
  }

  _checkFaints(){
    const p = this.getActive("PLAYER");
    const e = this.getActive("ENEMY");

    if(e.hp <= 0){
      this._syncLog(`상대 ${e.form.name_kr}는(은) 쓰러졌다!`);
      this.finished = true;
      this.result = { winner: "PLAYER", reward: this.reward };
      return;
    }
    if(p.hp <= 0){
      this._syncLog(`${p.form.name_kr}는(은) 쓰러졌다!`);
      // For prototype: lose immediately
      this.finished = true;
      this.result = { winner: "ENEMY" };
      return;
    }
  }

  // --- Core mechanics
  async _useSkill(attacker, defender, skillId){
    const skill = this.data.getSkill(skillId);
    if(!skill){
      this._syncLog("알 수 없는 스킬!");
      return;
    }

    const name = skill.name_kr;
    this._syncLog(`${attacker.form.name_kr}의 ${name}!`);

    // Accuracy check
    const hit = this._rollHit(attacker, defender, skill);
    if(!hit){
      this._syncLog("하지만 빗나갔다!");
      return;
    }

    // Remember context
    this.context.lastSkillElementId = skill.element_id ?? null;
    this.context.lastSkillWasAllyTarget = (skill.targeting || "").startsWith("ALLY");
    this.context.lastSkillId = skill.skill_id;

    // apply effects (ON_CAST)
    const effects = this.data.getSkillEffects(skillId).filter(e=>e.trigger_id === TRIGGER.ON_CAST);
    let damageDealtTotal = 0;

    for(const eff of effects){
      const result = this._applyEffect(attacker, defender, skill, eff);
      if(result?.damageDealt) damageDealtTotal += result.damageDealt;
    }

    this.context.lastDamageDealt = damageDealtTotal;

    // Next-hit apply status
    if(attacker.nextHitApplyStatus && damageDealtTotal > 0){
      const nh = attacker.nextHitApplyStatus;
      if(this.rng() < (nh.chance ?? 1.0)){
        this._applyStatus(defender, nh.statusId, nh.durationTurns ?? 2, {});
        const st = this.data.getStatus(nh.statusId);
        this._syncLog(`${defender.form.name_kr}에게 [${st.name_kr}]!`);
      }
      attacker.nextHitApplyStatus = null;
    }

    // Passive triggers on hit (attacker)
    if(damageDealtTotal > 0){
      this._triggerForBattler(attacker, defender, TRIGGER.ON_HIT, {skill});
      // Synergy rules (ON_CAST)
      this._applySynergies(attacker, defender, {skill});
    }

    // check faint
    this._checkFaints();
  }

  _rollHit(attacker, defender, skill){
    const baseAcc = skill.base_accuracy ?? 100;
    let accMult = this._statMult(attacker, "ACC");

    // status-based accuracy mods (blind etc)
    accMult *= this._accuracyStatusMult(attacker);

    let finalAcc = clamp((baseAcc/100) * accMult, 0.05, 0.99);

    return this.rng() < finalAcc;
  }

  _accuracyStatusMult(b){
    // interpret status components with ACC_MOD
    let mult = 1.0;
    for(const [sid,st] of b.statuses){
      const comps = this.data.getStatusComponents(sid);
      for(const c of comps){
        if(c.trigger_id === TRIGGER.ON_ACCURACY_CALC && c.effect_type === "ACC_MOD"){
          mult += (c.value ?? 0); // value is negative for blind
        }
      }
    }
    return clamp(mult, 0.2, 2.0);
  }

  _applyEffect(attacker, defender, skill, eff){
    // Only ENEMY_SINGLE and SELF and ALLY_ALL for prototype
    const target = (eff.target_scope || "").startsWith("ENEMY") ? defender : attacker;

    switch(eff.effect_type){
      case "DAMAGE":{
        const dmg = this._computeDamage(attacker, defender, skill, eff);
        const dealt = this._dealDamage(defender, dmg, skill);
        this._syncLog(`${defender.form.name_kr}에게 ${dealt} 피해!`);
        // lifesteal
        this._applyLifeSteal(attacker, dealt);
        return {damageDealt: dealt};
      }
      case "APPLY_STATUS":{
        const chance = eff.chance ?? 1.0;
        if(this.rng() <= chance){
          const duration = eff.duration_turns ?? (this.data.getStatus(eff.status_id)?.duration_default ?? 2);
          this._applyStatus(target, eff.status_id, duration, {});
          const st = this.data.getStatus(eff.status_id);
          this._syncLog(`${target.form.name_kr}에게 [${st.name_kr}]!`);
        }
        return {};
      }
      case "STAT_MOD":{
        const duration = eff.duration_turns ?? 2;
        this._applyMod(target, eff.stat, eff.base_value ?? 0, duration);
        const sign = (eff.base_value ?? 0) >= 0 ? "+" : "";
        this._syncLog(`${target.form.name_kr}의 ${eff.stat} ${sign}${Math.round((eff.base_value ?? 0)*100)}% (${duration}턴)`);
        return {};
      }
      case "SHIELD_MAXHP_RATIO":{
        const duration = eff.duration_turns ?? 2;
        const ratio = eff.base_value ?? 0.1;
        const amount = Math.floor(attacker.statsBase.maxHp * ratio);
        this._applyStatus(target, 8, duration, {shield: amount});
        this._syncLog(`${target.form.name_kr}에게 보호막(${amount})!`);
        return {};
      }
      case "HEAL_MAXHP_RATIO":{
        const ratio = eff.base_value ?? 0.1;
        const amount = Math.floor(target.statsBase.maxHp * ratio);
        this._heal(target, amount);
        this._syncLog(`${target.form.name_kr} HP ${amount} 회복!`);
        return {};
      }
      case "CLEANSE_DEBUFF":{
        const count = Math.round(eff.base_value ?? 1);
        const removed = this._cleanseDebuffs(target, count);
        if(removed > 0) this._syncLog(`${target.form.name_kr}의 디버프 ${removed}개 정화!`);
        return {};
      }
      case "NEXT_HIT_APPLY_STATUS":{
        attacker.nextHitApplyStatus = {statusId: eff.status_id, durationTurns: eff.duration_turns ?? 2, chance: eff.chance ?? 1.0};
        this._syncLog(`${attacker.form.name_kr}의 다음 공격에 상태이상 부여 효과가 실렸다.`);
        return {};
      }
      case "LIFESTEAL_RATIO":{
        // handled in _applyLifeSteal for now
        return {};
      }
      default:
        // ignore
        return {};
    }
  }

  _applyLifeSteal(attacker, damageDealt){
    // If attacker has any effect LIFESTEAL_RATIO from passives at battle start etc,
    // or active skill includes it (not used in v3 actives for prototype)
    let ratio = 0;
    // passive effects
    for(const pid of attacker.passiveSkillIds){
      const effs = this.data.getSkillEffects(pid);
      for(const e of effs){
        if(e.effect_type === "LIFESTEAL_RATIO"){
          ratio = Math.max(ratio, e.base_value ?? 0);
        }
      }
    }
    if(ratio > 0 && damageDealt > 0){
      const heal = Math.floor(damageDealt * ratio);
      if(heal > 0){
        this._heal(attacker, heal);
        this._syncLog(`${attacker.form.name_kr}는(은) 흡혈로 ${heal} 회복!`);
      }
    }
  }

  _cleanseDebuffs(target, count){
    let removed = 0;
    for(const [sid, st] of Array.from(target.statuses.entries())){
      if(removed >= count) break;
      if(isDebuffStatusId(sid)){
        target.statuses.delete(sid);
        removed += 1;
      }
    }
    return removed;
  }

  _applyStatus(target, statusId, turns, meta){
    if(!statusId) return;
    // refresh duration (REFRESH rule)
    const prev = target.statuses.get(statusId);
    if(prev){
      prev.turnsLeft = Math.max(prev.turnsLeft, turns);
      // merge meta if provided
      prev.meta = {...(prev.meta||{}), ...(meta||{})};
    }else{
      target.statuses.set(statusId, {turnsLeft: turns, meta: meta ?? {}});
    }
  }

  _applyMod(target, stat, multDelta, turns){
    target.mods.push({stat, mult: multDelta, turnsLeft: turns});
  }

  _heal(target, amount){
    target.hp = clamp(target.hp + amount, 0, target.statsBase.maxHp);
  }

  _dealDamage(defender, amount, skill){
    let dmg = Math.max(1, Math.floor(amount));
    // shield absorb
    const shield = defender.statuses.get(8);
    if(shield?.meta?.shield){
      const absorb = Math.min(shield.meta.shield, dmg);
      shield.meta.shield -= absorb;
      dmg -= absorb;
      if(shield.meta.shield <= 0){
        defender.statuses.delete(8);
      }
      if(absorb > 0){
        this._syncLog(`보호막이 ${absorb} 피해를 흡수했다.`);
      }
    }
    defender.hp = clamp(defender.hp - dmg, 0, defender.statsBase.maxHp);
    return dmg;
  }

  _computeDamage(attacker, defender, skill, eff){
    const power = (eff.base_value ?? skill.base_power ?? 30);
    const atk = this._statValue(attacker, "ATK");
    const def = this._statValue(defender, "DEF");

    // Base formula (tunable)
    let base = (power * (atk / 100)) + (power * 0.8) - (def * 0.35);
    base = Math.max(1, base);

    // Element matchup
    const elementMult = this.data.matchupMultiplier(skill.element_id, defender.form.element_id);

    // Conditional multipliers from statuses + passives
    const multA = this._damageMultFromPassives(attacker, defender, skill);
    const multD = this._damageTakenMultFromDefender(defender, skill);

    // Random + crit
    const randMin = this.config.battle?.randomDamageMin ?? 0.9;
    const randMax = this.config.battle?.randomDamageMax ?? 1.0;
    const randMult = randMin + (randMax - randMin) * this.rng();

    const critChance = this.config.battle?.critChance ?? 0.06;
    const critMult = (this.rng() < critChance) ? (this.config.battle?.critMultiplier ?? 1.5) : 1.0;
    if(critMult > 1.0){
      this._syncLog("급소에 맞았다!");
    }

    // Wet/Vulnerable etc already in multD
    const total = base * elementMult * multA * multD * randMult * critMult;
    return total;
  }

  _damageMultFromPassives(attacker, defender, skill){
    // apply attacker passive ON_DAMAGE_CALC DAMAGE_MULT if condition matches
    let mult = 1.0;
    for(const pid of attacker.passiveSkillIds){
      const effs = this.data.getSkillEffects(pid);
      for(const e of effs){
        if(e.trigger_id !== TRIGGER.ON_DAMAGE_CALC) continue;
        if(e.effect_type !== "DAMAGE_MULT") continue;
        if(this._checkConditionJson(e.condition_json, {attacker, defender, skill, target: defender})){
          mult *= (1 + (e.base_value ?? 0));
        }
      }
    }
    return mult;
  }

  _damageTakenMultFromDefender(defender, skill){
    let mult = 1.0;

    // status components
    for(const [sid, st] of defender.statuses){
      const comps = this.data.getStatusComponents(sid);
      for(const c of comps){
        if(c.trigger_id !== TRIGGER.ON_DAMAGE_CALC) continue;
        if(c.effect_type === "DAMAGE_TAKEN_MULT"){
          if(this._checkConditionJson(c.condition_json, {skill, target: defender})){
            mult *= (1 + (c.value ?? 0));
          }
        }
      }
    }

    // defender passives ON_DAMAGE_CALC DAMAGE_TAKEN_MULT
    for(const pid of defender.passiveSkillIds){
      const effs = this.data.getSkillEffects(pid);
      for(const e of effs){
        if(e.trigger_id !== TRIGGER.ON_DAMAGE_CALC) continue;
        if(e.effect_type !== "DAMAGE_TAKEN_MULT") continue;
        if(this._checkConditionJson(e.condition_json, {target: defender, skill})){
          mult *= (1 + (e.base_value ?? 0)); // base_value is negative for reduction
        }
      }
    }

    return mult;
  }

  _checkConditionJson(cond, ctx){
    if(!cond) return true;
    // cond can be object (already parsed from JSON export)
    // Supported keys (subset):
    // - defender_has_status: "젖음" etc
    // - target_has_status: "젖음" etc
    // - skill_element_id: number
    // - env_tag_ids: [...]
    // - ally_target: boolean
    const attacker = ctx.attacker;
    const defender = ctx.defender ?? ctx.target;
    const skill = ctx.skill;

    if(cond.defender_has_status){
      const sid = this.data.statusIdByName(cond.defender_has_status);
      if(!sid) return false;
      if(!defender?.statuses?.has(sid)) return false;
    }
    if(cond.target_has_status){
      const sid = this.data.statusIdByName(cond.target_has_status);
      if(!sid) return false;
      if(!ctx.target?.statuses?.has(sid)) return false;
    }
    if(cond.skill_element_id != null){
      if((skill?.element_id ?? null) !== cond.skill_element_id) return false;
    }
    if(cond.ally_target != null){
      // true if skill targets ally
      const ally = (skill?.targeting || "").startsWith("ALLY");
      if(ally !== cond.ally_target) return false;
    }

    return true;
  }

  _statMult(b, stat){
    let mult = 1.0;
    for(const m of b.mods){
      if(m.stat === stat){
        mult *= (1 + m.mult);
      }
    }
    // status components that change stats
    for(const [sid, st] of b.statuses){
      const comps = this.data.getStatusComponents(sid);
      for(const c of comps){
        if(c.trigger_id !== TRIGGER.ON_STAT_CALC) continue;
        if(c.effect_type === "STAT_MOD" && c.stat === stat){
          mult *= (1 + (c.value ?? 0));
        }
      }
    }
    return clamp(mult, 0.2, 3.0);
  }

  _statValue(b, stat){
    if(stat === "ATK") return Math.floor(b.statsBase.atk * this._statMult(b, "ATK"));
    if(stat === "DEF") return Math.floor(b.statsBase.def * this._statMult(b, "DEF"));
    if(stat === "SPD") return Math.floor(b.statsBase.spd * this._statMult(b, "SPD"));
    if(stat === "ACC") return b.statsBase.acc * this._statMult(b, "ACC");
    return 0;
  }

  _canAct(b){
    // status components skip turn chance
    let skipChance = 0.0;
    for(const [sid,st] of b.statuses){
      const comps = this.data.getStatusComponents(sid);
      for(const c of comps){
        if(c.trigger_id === TRIGGER.ON_ACTION_ATTEMPT && c.effect_type === "SKIP_TURN_CHANCE"){
          skipChance = Math.max(skipChance, c.value ?? 0);
        }
      }
    }
    if(skipChance > 0 && this.rng() < skipChance){
      return false;
    }
    return true;
  }

  _triggerAll(triggerId){
    // For both sides, for each active battler, apply trigger.
    const p = this.getActive("PLAYER");
    const e = this.getActive("ENEMY");
    this._triggerForBattler(p, e, triggerId, {});
    this._triggerForBattler(e, p, triggerId, {});
  }

  _triggerForBattler(source, other, triggerId, {skill}){
    // Passive effects only for prototype
    for(const pid of source.passiveSkillIds){
      const effs = this.data.getSkillEffects(pid);
      for(const e of effs){
        if(e.trigger_id !== triggerId) continue;

        // Determine target based on scope
        let target = source;
        if((e.target_scope || "").startsWith("ENEMY")) target = other;
        if((e.target_scope || "").startsWith("ALLY")) target = source;

        if(e.effect_type === "APPLY_STATUS"){
          const chance = e.chance ?? 1.0;
          if(this.rng() <= chance){
            const duration = e.duration_turns ?? (this.data.getStatus(e.status_id)?.duration_default ?? 2);
            this._applyStatus(target, e.status_id, duration, {});
            const st = this.data.getStatus(e.status_id);
            this._syncLog(`${target.form.name_kr}에게 [${st.name_kr}]!`);
          }
        }else if(e.effect_type === "STAT_MOD"){
          const duration = e.duration_turns ?? 2;
          this._applyMod(target, e.stat, e.base_value ?? 0, duration);
        }else if(e.effect_type === "SHIELD_MAXHP_RATIO"){
          const duration = e.duration_turns ?? 2;
          const ratio = e.base_value ?? 0.08;
          const amount = Math.floor(source.statsBase.maxHp * ratio);
          this._applyStatus(target, 8, duration, {shield: amount});
        }else if(e.effect_type === "STATUS_POTENCY_MULT"){
          // ignored in prototype
        }else if(e.effect_type === "LIFESTEAL_RATIO"){
          // handled when dealing damage
        }
      }
    }

    // Status tick at end of turn (tick only the source battler)
    if(triggerId === TRIGGER.ON_TURN_END){
      this._statusTick(source);
    }
  }

  _statusTick(b){
    // apply DOT/REGEN type components
    for(const [sid, st] of b.statuses){
      const comps = this.data.getStatusComponents(sid);
      for(const c of comps){
        if(c.trigger_id !== TRIGGER.ON_STATUS_TICK) continue;
        if(c.effect_type === "DOT_MAXHP_RATIO"){
          const dmg = Math.floor(b.statsBase.maxHp * (c.value ?? 0));
          b.hp = clamp(b.hp - dmg, 0, b.statsBase.maxHp);
          const stObj = this.data.getStatus(sid);
          this._syncLog(`${b.form.name_kr}는(은) [${stObj.name_kr}]로 ${dmg} 피해!`);
        }else if(c.effect_type === "HEAL_MAXHP_RATIO"){
          const heal = Math.floor(b.statsBase.maxHp * (c.value ?? 0));
          this._heal(b, heal);
          const stObj = this.data.getStatus(sid);
          this._syncLog(`${b.form.name_kr}는(은) [${stObj.name_kr}]로 ${heal} 회복!`);
        }
      }
    }
  }

  _applySynergies(attacker, defender, {skill}){
    // Apply synergy_rules where trigger_id == ON_CAST (1)
    for(const syn of this.data.synergies){
      if(syn.trigger_id !== TRIGGER.ON_CAST) continue;
      const cond = syn.condition_json ?? null;
      if(!cond) continue;

      // Basic checks
      if(cond.skill_element_id != null && (skill.element_id ?? null) !== cond.skill_element_id) continue;
      if(cond.attacker_element_id != null && (attacker.form.element_id ?? null) !== cond.attacker_element_id) continue;
      if(cond.target_element_id != null && (defender.form.element_id ?? null) !== cond.target_element_id) continue;

      if(cond.defender_has_status){
        const sid = this.data.statusIdByName(cond.defender_has_status);
        if(!sid || !defender.statuses.has(sid)) continue;
      }
      if(cond.target_has_status){
        const sid = this.data.statusIdByName(cond.target_has_status);
        if(!sid || !defender.statuses.has(sid)) continue;
      }

      // Apply modifier
      const mod = syn.modifier_json ?? {};
      const chance = mod.chance ?? 1.0;
      if(this.rng() > chance) continue;

      if(mod.remove_status){
        const sid = this.data.statusIdByName(mod.remove_status);
        if(sid && defender.statuses.has(sid)){
          defender.statuses.delete(sid);
          this._syncLog(`[시너지] ${mod.remove_status} 제거!`);
        }
      }
      if(mod.apply_status){
        const sid = this.data.statusIdByName(mod.apply_status);
        if(sid){
          const dur = mod.apply_duration ?? this.data.getStatus(sid)?.duration_default ?? 2;
          this._applyStatus(defender, sid, dur, {});
          this._syncLog(`[시너지] ${mod.apply_status} 부여!`);
        }
      }
      if(mod.extend_status){
        const sid = this.data.statusIdByName(mod.extend_status);
        if(sid && defender.statuses.has(sid)){
          defender.statuses.get(sid).turnsLeft += (mod.extend_turns ?? 1);
          this._syncLog(`[시너지] ${mod.extend_status} 지속시간 연장!`);
        }
      }
      if(mod.cleanse_debuff_count){
        const removed = this._cleanseDebuffs(attacker, mod.cleanse_debuff_count);
        if(removed>0) this._syncLog(`[시너지] 디버프 ${removed}개 정화!`);
      }
      // damage_mult etc are ignored in prototype (already handled by passives/status)
    }
  }

  _attemptCapture(playerBattler, enemyBattler, ballItem){
    const rarity = enemyBattler.rarity;
    const hpRatio = enemyBattler.hp / enemyBattler.statsBase.maxHp;

    const base = 0.45; // tune
    const ballMod = ballItem?.ballModifier ?? 1.0;
    let statusBonus = 0.0;

    // status bonus
    if(enemyBattler.statuses.has(this.data.statusIdByName("감전"))) statusBonus += 0.12;
    if(enemyBattler.statuses.has(this.data.statusIdByName("화상"))) statusBonus += 0.08;
    if(enemyBattler.statuses.has(this.data.statusIdByName("중독"))) statusBonus += 0.08;

    // capture_multiplier is smaller for rare ones in v3
    let p = base * (rarity.capture_multiplier ?? 1.0) * ballMod * (1 - hpRatio*0.7) + statusBonus;
    p = clamp(p, 0.03, 0.90);

    const roll = this.rng();
    return {captured: roll < p, probability: p};
  }

  // log helper
  _syncLog(line){
    this.log.push(line);
  }
}
