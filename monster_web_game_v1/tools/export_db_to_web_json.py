#!/usr/bin/env python3
"""Export SQLite master data to JSON for the web client.

Usage:
  python tools/export_db_to_web_json.py --db ../monster_game_db_v3.sqlite --out ./data/master

This script is optional. The repo already contains exported JSON, but use this
when you regenerate DB content.
"""

import argparse
import json
import os
import sqlite3

TABLES = [
  ("elements", []),
  ("element_matchups", []),
  ("rarities", []),
  ("growth_stages", []),
  ("roles", ["stat_bias_json"]),
  ("natures", []),
  ("env_tags", []),
  ("training_styles", []),
  ("species", []),
  ("monster_forms", []),
  ("skills", []),
  ("skill_effects", ["condition_json"]),
  ("form_skills", []),
  ("status_effects", []),
  ("status_effect_components", ["condition_json"]),
  ("synergy_rules", ["condition_json", "modifier_json"]),
  ("items", []),
  ("egg_properties", []),
  ("evolutions", []),
  ("evolution_conditions", []),
]

def export_table(cur, table, json_cols):
  rows = cur.execute(f"SELECT * FROM {table}").fetchall()
  cols = [d[0] for d in cur.description]
  out = []
  for r in rows:
    obj = dict(zip(cols, r))
    for c in json_cols:
      if c in obj and obj[c]:
        try:
          obj[c] = json.loads(obj[c])
        except Exception:
          pass
    out.append(obj)
  return out

def main():
  ap = argparse.ArgumentParser()
  ap.add_argument("--db", required=True, help="sqlite file path")
  ap.add_argument("--out", required=True, help="output folder, e.g. ./data/master")
  args = ap.parse_args()

  os.makedirs(args.out, exist_ok=True)

  con = sqlite3.connect(args.db)
  cur = con.cursor()

  for table, json_cols in TABLES:
    data = export_table(cur, table, json_cols)
    path = os.path.join(args.out, f"{table}.json")
    with open(path, "w", encoding="utf-8") as f:
      json.dump(data, f, ensure_ascii=False, indent=2)
    print("Wrote", path, "rows:", len(data))

  con.close()

if __name__ == "__main__":
  main()
