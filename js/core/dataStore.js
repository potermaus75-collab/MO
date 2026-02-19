// js/core/dataStore.js
// Loads JSON exported from monster_game_db_v3.sqlite + world config.

function indexBy(arr, key){
  const m = new Map();
  for(const o of arr){
    m.set(o[key], o);
  }
  return m;
}

export class DataStore{
  constructor(){
    this.loaded = false;

    this.elements = [];
    this.elementMatchups = [];
    this.rarities = [];
    this.growthStages = [];
    this.roles = [];
    this.natures = [];
    this.envTags = [];
    this.trainingStyles = [];
    this.species = [];
    this.forms = [];
    this.skills = [];
    this.skillEffects = [];
    this.formSkills = [];
    this.statuses = [];
    this.statusComponents = [];
    this.synergies = [];
    this.items = [];
    this.eggProps = [];
    this.evolutions = [];
    this.evolutionConditions = [];

    this.runtimeItems = [];
    this.config = null;
    this.levelExp = [];

    this.mapsIndex = [];
    this.maps = new Map();
    this.regions = [];
    this.npcs = [];
    this.spawnTables = {};

    // indexes
    this.byFormId = new Map();
    this.bySkillId = new Map();
    this.skillEffectsBySkillId = new Map();
    this.formSkillsByFormId = new Map();
    this.byStatusId = new Map();
    this.statusComponentsByStatusId = new Map();
    this.byElementId = new Map();
    this.matchup = new Map(); // key: aId-dId -> mult
    this.byRarityId = new Map();
    this.byNatureId = new Map();
    this.byRoleId = new Map();
    this.byItemId = new Map();
    this.byItemCode = new Map();
    this.byTrainingStyleId = new Map();
    this.byEvolutionId = new Map();
    this.evolutionsFromFormId = new Map();
    this.evoConditionsByEvolutionId = new Map();
    this.npcsByMap = new Map();
    this.statusNameToId = new Map();
    this.elementNameToId = new Map();
  }

  async _fetchJson(url){
    const res = await fetch(url);
    if(!res.ok){
      throw new Error(`Failed to load ${url}: ${res.status}`);
    }
    return await res.json();
  }

  async loadAll(){
    if(this.loaded) return;

    const base = new URL("../", import.meta.url);

    const masterBase = new URL("../data/master/", base);
    const worldBase = new URL("../data/world/", base);
    const gameBase  = new URL("../data/game/", base);

    const [
      elements, elementMatchups, rarities, stages, roles, natures, envTags, trainingStyles,
      species, forms, skills, skillEffects, formSkills,
      statuses, statusComponents, synergies, items, eggProps,
      evolutions, evolutionConditions,
      runtimeItems, config, levelExp,
      regions, mapsIndex, npcs, spawnTables
    ] = await Promise.all([
      this._fetchJson(new URL("elements.json", masterBase)),
      this._fetchJson(new URL("element_matchups.json", masterBase)),
      this._fetchJson(new URL("rarities.json", masterBase)),
      this._fetchJson(new URL("growth_stages.json", masterBase)),
      this._fetchJson(new URL("roles.json", masterBase)),
      this._fetchJson(new URL("natures.json", masterBase)),
      this._fetchJson(new URL("env_tags.json", masterBase)),
      this._fetchJson(new URL("training_styles.json", masterBase)),

      this._fetchJson(new URL("species.json", masterBase)),
      this._fetchJson(new URL("monster_forms.json", masterBase)),
      this._fetchJson(new URL("skills.json", masterBase)),
      this._fetchJson(new URL("skill_effects.json", masterBase)),
      this._fetchJson(new URL("form_skills.json", masterBase)),

      this._fetchJson(new URL("status_effects.json", masterBase)),
      this._fetchJson(new URL("status_effect_components.json", masterBase)),
      this._fetchJson(new URL("synergy_rules.json", masterBase)),
      this._fetchJson(new URL("items.json", masterBase)),
      this._fetchJson(new URL("egg_properties.json", masterBase)),

      this._fetchJson(new URL("evolutions.json", masterBase)),
      this._fetchJson(new URL("evolution_conditions.json", masterBase)),

      this._fetchJson(new URL("runtime_items.json", gameBase)),
      this._fetchJson(new URL("config.json", gameBase)),
      this._fetchJson(new URL("level_exp.json", gameBase)),

      this._fetchJson(new URL("regions.json", worldBase)),
      this._fetchJson(new URL("maps_index.json", worldBase)),
      this._fetchJson(new URL("npcs.json", worldBase)),
      this._fetchJson(new URL("spawn_tables.json", worldBase)),
    ]);

    this.elements = elements;
    this.elementMatchups = elementMatchups;
    this.rarities = rarities;
    this.growthStages = stages;
    this.roles = roles;
    this.natures = natures;
    this.envTags = envTags;
    this.trainingStyles = trainingStyles;

    this.species = species;
    this.forms = forms;
    this.skills = skills;
    this.skillEffects = skillEffects;
    this.formSkills = formSkills;

    this.statuses = statuses;
    this.statusComponents = statusComponents;
    this.synergies = synergies;
    this.items = items;
    this.eggProps = eggProps;

    this.evolutions = evolutions;
    this.evolutionConditions = evolutionConditions;

    this.runtimeItems = runtimeItems;
    this.config = config;
    this.levelExp = levelExp;

    this.regions = regions;
    this.mapsIndex = mapsIndex;
    this.npcs = npcs;
    this.spawnTables = spawnTables;

    // Load each map file
    const mapPromises = this.mapsIndex.map(mi => this._fetchJson(new URL(mi.file, worldBase)));
    const maps = await Promise.all(mapPromises);
    for(const m of maps){
      this.maps.set(m.id, m);
    }

    // Build indexes
    this.byFormId = indexBy(this.forms, "form_id");
    this.bySkillId = indexBy(this.skills, "skill_id");
    this.byStatusId = indexBy(this.statuses, "status_id");
    this.byElementId = indexBy(this.elements, "element_id");
    this.byRarityId = indexBy(this.rarities, "rarity_id");
    this.byNatureId = indexBy(this.natures, "nature_id");
    this.byRoleId = indexBy(this.roles, "role_id");
    this.byItemId = indexBy(this.items, "item_id");
    for(const it of this.items){
      this.byItemCode.set(it.code, it);
    }
    for(const it of this.runtimeItems){
      this.byItemCode.set(it.code, it);
    }

    // training styles: style_id
    this.byTrainingStyleId = indexBy(this.trainingStyles, "style_id");

    // matchup matrix
    for(const m of this.elementMatchups){
      const key = `${m.attacker_element_id}-${m.defender_element_id}`;
      this.matchup.set(key, m.multiplier);
    }

    // skill effects grouped
    this.skillEffectsBySkillId = new Map();
    for(const se of this.skillEffects){
      if(!this.skillEffectsBySkillId.has(se.skill_id)) this.skillEffectsBySkillId.set(se.skill_id, []);
      this.skillEffectsBySkillId.get(se.skill_id).push(se);
    }
    for(const [k,arr] of this.skillEffectsBySkillId){
      arr.sort((a,b)=>a.seq - b.seq);
    }

    // form skills grouped (slots)
    this.formSkillsByFormId = new Map();
    for(const fs of this.formSkills){
      if(!this.formSkillsByFormId.has(fs.form_id)) this.formSkillsByFormId.set(fs.form_id, []);
      this.formSkillsByFormId.get(fs.form_id).push(fs);
    }
    for(const [k,arr] of this.formSkillsByFormId){
      arr.sort((a,b)=>a.slot - b.slot);
    }

    // status components
    this.statusComponentsByStatusId = new Map();
    for(const sc of this.statusComponents){
      if(!this.statusComponentsByStatusId.has(sc.status_id)) this.statusComponentsByStatusId.set(sc.status_id, []);
      this.statusComponentsByStatusId.get(sc.status_id).push(sc);
    }
    for(const [k,arr] of this.statusComponentsByStatusId){
      arr.sort((a,b)=>a.seq - b.seq);
    }

    // status name lookup
    for(const st of this.statuses){
      this.statusNameToId.set(st.name_kr, st.status_id);
    }
    for(const el of this.elements){
      this.elementNameToId.set(el.name_kr, el.element_id);
    }

    // evolutions index
    this.byEvolutionId = indexBy(this.evolutions, "evolution_id");
    this.evolutionsFromFormId = new Map();
    for(const e of this.evolutions){
      if(!this.evolutionsFromFormId.has(e.from_form_id)) this.evolutionsFromFormId.set(e.from_form_id, []);
      this.evolutionsFromFormId.get(e.from_form_id).push(e);
    }
    for(const [k,arr] of this.evolutionsFromFormId){
      arr.sort((a,b)=> (a.min_level ?? 0) - (b.min_level ?? 0));
    }

    // evo conditions
    this.evoConditionsByEvolutionId = new Map();
    for(const c of this.evolutionConditions){
      if(!this.evoConditionsByEvolutionId.has(c.evolution_id)) this.evoConditionsByEvolutionId.set(c.evolution_id, []);
      this.evoConditionsByEvolutionId.get(c.evolution_id).push(c);
    }
    for(const [k,arr] of this.evoConditionsByEvolutionId){
      arr.sort((a,b)=>a.seq-b.seq);
    }

    // NPCs by map
    this.npcsByMap = new Map();
    for(const n of this.npcs){
      if(!this.npcsByMap.has(n.mapId)) this.npcsByMap.set(n.mapId, []);
      this.npcsByMap.get(n.mapId).push(n);
    }

    this.loaded = true;
  }

  // Getters
  getForm(formId){ return this.byFormId.get(formId); }
  getSkill(skillId){ return this.bySkillId.get(skillId); }
  getRarity(rarityId){ return this.byRarityId.get(rarityId); }
  getNature(natureId){ return this.byNatureId.get(natureId); }
  getRole(roleId){ return this.byRoleId.get(roleId); }
  getMap(mapId){ return this.maps.get(mapId); }
  getNPCs(mapId){ return this.npcsByMap.get(mapId) ?? []; }

  getFormSkills(formId){
    return this.formSkillsByFormId.get(formId) ?? [];
  }

  getSkillEffects(skillId){
    return this.skillEffectsBySkillId.get(skillId) ?? [];
  }

  getStatus(statusId){ return this.byStatusId.get(statusId); }
  getStatusComponents(statusId){
    return this.statusComponentsByStatusId.get(statusId) ?? [];
  }

  matchupMultiplier(attackerElementId, defenderElementId){
    if(!attackerElementId || !defenderElementId) return 1.0;
    return this.matchup.get(`${attackerElementId}-${defenderElementId}`) ?? 1.0;
  }

  getSpawnTable(tableId){
    return this.spawnTables[tableId] ?? [];
  }

  getItemByCode(code){
    return this.byItemCode.get(code);
  }

  getTrainingStyle(styleId){
    return this.byTrainingStyleId.get(styleId);
  }

  getEvolutionsFrom(formId){
    return this.evolutionsFromFormId.get(formId) ?? [];
  }

  getEvolutionConditions(evolutionId){
    return this.evoConditionsByEvolutionId.get(evolutionId) ?? [];
  }

  // Helper: status ID from Korean name
  statusIdByName(nameKr){
    return this.statusNameToId.get(nameKr);
  }
}
