import json, glob, re, os, collections
UBER_Q = ('mirror', 'uber', 'billion')
vids={}
for f in glob.glob('yt_hi/*.jsonl'):
    q=os.path.basename(f)
    for line in open(f,encoding='utf-8'):
        try: d=json.loads(line)
        except: continue
        d['_uber']=any(k in q for k in UBER_Q)
        prev=vids.get(d['id'])
        vids[d['id']]= d if not prev else {**prev, '_uber': prev['_uber'] or d['_uber']}
b=json.load(open(r'D:/gsrepo/craftingisfun/data-raw/repoe/base_items.json',encoding='utf-8'))
skills=sorted({v['name'] for v in b.values() if v.get('item_class')=='Active Skill Gem' and v.get('release_state')=='released'}, key=len, reverse=True)
ASC=['Juggernaut','Berserker','Chieftain','Warden','Deadeye','Pathfinder','Raider','Occultist','Elementalist','Necromancer','Slayer','Gladiator','Champion','Inquisitor','Hierophant','Guardian','Assassin','Trickster','Saboteur','Ascendant','Reliquarian']
ABBR={'RF':'Righteous Fire','SRS':'Summon Raging Spirit','TS':'Tornado Shot','LA':'Lightning Arrow','KB':'Kinetic Blast','EK':'Ethereal Knives','SST':'Spectral Shield Throw','EA':'Explosive Arrow','HoA':'Herald of Agony','TR':'Toxic Rain','CA':'Caustic Arrow','DD':'Detonate Dead','KF':'Kinetic Fusillade','CoC':'Cyclone','EH':'Elemental Hit'}
UBER_T=re.compile(r'mirror|uber|billion|\d+\s*b(illion)?\s*dps|\b\d{3,}\s*div', re.I)
agg=collections.defaultdict(lambda:{'views':0,'n':0,'uber':0,'vids':[]})
for v in vids.values():
    t=v.get('title','')
    if re.search(r'poe\s*2|path of exile 2|poe2|\b0\.[1-4]\b', t, re.I): continue
    vc=v.get('view_count') or 0
    sk=next((s for s in skills if re.search(r'\b'+re.escape(s)+r'\b', t, re.I)), None) or next((full for ab,full in ABBR.items() if re.search(r'\b'+re.escape(ab)+r'\b', t)), None)
    if not sk: continue
    asc=next((a for a in ASC if re.search(r'\b'+a+r'\b', t, re.I)), '?')
    a=agg[(sk,asc)]; a['views']+=vc; a['n']+=1; a['uber']+= 1 if (v['_uber'] or UBER_T.search(t)) else 0; a['vids'].append((vc,v['id'],t[:90]))
top=sorted(agg.items(), key=lambda x:-x[1]['views'])
for (sk,asc),a in top[:40]: print(f"{a['views']:>9,} | {a['n']:>2} vids | uber {a['uber']:>2} | {sk} / {asc} | {sorted(a['vids'],reverse=True)[0][2][:60]}")
json.dump({f'{k[0]}|{k[1]}':v for k,v in top}, open('yt_hi/agg.json','w',encoding='utf-8'), ensure_ascii=False)
