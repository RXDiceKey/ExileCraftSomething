import json, collections, re
R='D:/gsrepo/craftingisfun/'
top=json.load(open('yt/top_builds.json',encoding='utf-8'))
pob=json.load(open('pob/summary.json',encoding='utf-8'))
bases=json.load(open(R+'data-raw/repoe/base_items.json',encoding='utf-8'))
mods=json.load(open(R+'src/data/mods.json',encoding='utf-8'))
# Lower attribute requirements: rolls often, rarely what a build is after (user).
rollable={s for m in mods.values() if m['gen'] in('prefix','suffix') for s,_,_ in m['stats']}-{'local_attribute_requirements_+%'}
def dat(lang,t): return {r['Id']:r['Name'] for r in json.load(open(R+f'data-raw/dat/tables/{lang}/{t}.json',encoding='utf-8'))}
gem_en, gem_ko = dat('English','BaseItemTypes'), dat('Korean','BaseItemTypes')
asc_ko = {r['Name']: k for r in json.load(open(R+'data-raw/dat/tables/English/Ascendancy.json',encoding='utf-8')) for k in [dat('Korean','Ascendancy')[r['Id']]]}
gem_id={}
for i,n in gem_en.items():
    if '/Gems/SkillGem' in i: gem_id.setdefault(n,i)
base_by_name={}
for i,b in bases.items():
    if b.get('release_state')=='released' and b.get('domain')=='item': base_by_name.setdefault(b['name'],b)
DEF={'str':'armour','dex':'evasion','int':'es'}
def defences(b):
    if 'ward_armour' in b['tags']: return ['ward']
    t=next((t for t in b['tags'] if re.fullmatch(r'(str|dex|int)(_(dex|int))*_armour',t)),None)
    return [DEF[a] for a in t.replace('_armour','').split('_')] if t else []

MERGE={'Vaal Ice Nova':'Ice Nova','Contagion':'Essence Drain'}
DROP_AFTER=30
builds=[]; seen=set()
for b in top:
    sk=MERGE.get(b['skill'],b['skill'])
    if sk in seen:
        prev=next(x for x in builds if x['skillName']==sk); prev['views']+=b['views']; prev['keys']+=b['keys']; continue
    seen.add(sk); builds.append({'skillName':sk,'views':b['views'],'asc':b['asc'],'keys':list(b['keys'])})
builds=builds[:DROP_AFTER]

def from_pob(keys):
    slots=collections.defaultdict(collections.Counter); slot_bases=collections.defaultdict(collections.Counter); uniq=collections.Counter(); n=0
    for k in keys:
        if k not in pob: continue
        n+=pob[k]['n']
        for s,c in pob[k]['slots'].items():
            for stat,cnt in c.items(): slots[s][stat]+=cnt
        for s,c in pob[k]['bases'].items(): slot_bases[s].update(c)
        for s,c in pob[k]['uniq'].items(): uniq[s]+=sum(c.values())
    out={}
    for s,c in slots.items():
        # Mostly a unique in this slot across the build's PoBs: the build doesn't buy rares there.
        if uniq[s] > sum(slot_bases[s].values()): continue
        top_stats=[(st,cnt) for st,cnt in c.most_common() if all(x in rollable for x in st.split(','))][:8]
        if not top_stats: continue
        mx=top_stats[0][1]
        wants={}
        for st,cnt in top_stats:
            for x in st.split(','): wants[x]=max(wants.get(x,0), round(0.4+0.6*cnt/mx,2))
        entry={'wants':wants}
        bs=[base_by_name[nm] for nm in slot_bases.get(s,{}) if nm in base_by_name]
        if s in('weapon','offhand'):
            cls=sorted({x['item_class'] for x in bs})
            if cls: entry['classes']=cls
        if s in('helmet','body','gloves','boots') or (s=='offhand' and any(x['item_class']=='Shield' for x in bs)):
            d=sorted({d for x in bs for d in defences(x)})
            if d: entry['defence']=d
        out[s]=entry
    return out, n

RES={'base_fire_damage_resistance_%':0.7,'base_cold_damage_resistance_%':0.7,'base_lightning_damage_resistance_%':0.7,'base_chaos_damage_resistance_%':0.6}
LIFE={'base_maximum_life':1,**RES}
ES={'local_energy_shield':1,'local_energy_shield_+%':1,'base_maximum_energy_shield':1,'maximum_energy_shield_+%':0.9,**RES}
MINION={
 'helmet':{'wants':{'base_maximum_life':1,'minion_maximum_life_+%':0.8,**RES}},
 'body':{'wants':{'base_maximum_life':1,**RES}},
 'gloves':{'wants':{'base_maximum_life':1,**RES}},
 'boots':{'wants':{'base_movement_velocity_+%':1,'base_maximum_life':0.9,**RES}},
 'amulet':{'wants':{'minion_skill_gem_level_+':1,'minion_damage_+%':0.8,'base_maximum_life':0.8,**RES}},
 'ring':{'wants':{'minion_damage_+%':0.8,'minion_attack_and_cast_speed_+%':0.8,'base_maximum_life':0.9,**RES}},
 'belt':{'wants':{'base_maximum_life':1,**RES}},
 'weapon':{'wants':{'minion_skill_gem_level_+':1,'minion_damage_+%':1,'minion_attack_and_cast_speed_+%':0.9,'minion_maximum_life_+%':0.7},'classes':['Sceptre','Wand']},
 'offhand':{'wants':{'minion_damage_+%':0.8,'minion_maximum_life_+%':0.8,'base_maximum_life':0.8,**RES},'classes':['Shield']},
}
AURA={s:{'wants':{**ES,'base_mana_reservation_efficiency_+%':1,'non_curse_aura_effect_+%':1}} for s in ('helmet','body','gloves','boots','amulet','ring','belt')}
for s in ('helmet','body','gloves','boots'): AURA[s]['defence']=['es']
DONOR={'Glacial Cascade':'Ice Nova','Spark':'Arc','Siege Ballista':'Lightning Arrow'}
TEMPLATE={'Raise Spectre':MINION,'Animate Weapon':MINION,'Absolution':MINION,'Animate Guardian':AURA}

total=sum(b['views'] for b in builds)
out=[]
for b in builds:
    sk=b['skillName']
    slots,n=from_pob(b['keys'])
    src='pob'
    if sk in DONOR: d=next(x for x in builds if x['skillName']==DONOR[sk]); slots,_=from_pob(d['keys']); src='donor:'+DONOR[sk]
    if sk in TEMPLATE: slots=TEMPLATE[sk]; src='template'
    gid=gem_id[sk]
    DEFAULT_ASC={'Raise Spectre':'Necromancer','Animate Guardian':'Guardian'}
    ascs=[a for a in b['asc'] if a in asc_ko][:1] or [DEFAULT_ASC.get(sk,'')]
    asc=ascs[0]
    out.append({
        'id': re.sub(r'[^a-z]+','-',sk.lower()).strip('-'),
        'name': {'en': f'{sk} {asc}'.strip(), 'ko': f'{gem_ko[gid]} {asc_ko.get(asc,"")}'.strip()},
        'share': round(b['views']/total,4),
        'views': b['views'], 'tier': 'starter',
        'pobs': n, 'source': src,
        'slots': slots,
    })
out.sort(key=lambda x: -x['share'])
json.dump(out, open(R+'src/data/builds.json','w',encoding='utf-8'), ensure_ascii=False, indent=1)
for x in out: print(f"{x['name']['ko']:<22} share {x['share']:.3f} pobs {x['pobs']} {x['source']:<16} slots {sorted(x['slots'])}")
