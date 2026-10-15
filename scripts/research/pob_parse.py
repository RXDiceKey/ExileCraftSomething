import json, re, glob, os, collections, xml.etree.ElementTree as ET
R='D:/gsrepo/craftingisfun/src/data/'
stats=json.load(open(R+'stats.json',encoding='utf-8')); en=json.load(open(R+'text.en.json',encoding='utf-8'))['stats']
NUM=r'[+-]?\d+(?:\.\d+)?'
pats=[]
for i,e in enumerate(stats):
    for s in en[i]:
        if not s or '{' not in s: continue
        parts=re.split(r'\{\d+\}', s)
        rx='^'+NUM.join(re.escape(p) for p in parts)+'$'
        pats.append((len(s), re.compile(rx, re.I), e['ids']))
pats.sort(key=lambda x:-x[0])
# Same text, different stats: "+# to maximum Energy Shield" is local on armour but global on jewellery; "#% increased
# Attack Speed" local on a weapon but global on gloves. Among the longest matching templates, take the one a random
# prefix/suffix can actually roll on that slot's bases.
B=json.load(open(R+'bases.json',encoding='utf-8')); M=json.load(open(R+'mods.json',encoding='utf-8'))
SLOT_CLASSES={'helmet':{'Helmet'},'body':{'Body Armour'},'gloves':{'Gloves'},'boots':{'Boots'},'ring':{'Ring'},'amulet':{'Amulet'},'belt':{'Belt'}}
NOT_WEAPON={c for cs in SLOT_CLASSES.values() for c in cs}|{'Shield','Quiver'}
def slot_tags(slot):
    if slot in SLOT_CLASSES: ok=lambda c: c in SLOT_CLASSES[slot]
    elif slot=='offhand': ok=lambda c: c not in NOT_WEAPON-{'Shield','Quiver'}  # shields, quivers, dual wield
    else: ok=lambda c: c not in NOT_WEAPON
    return {t for b in B.values() if ok(b['cls']) for t in b['tags']}-{'default'}
TAGS={s:slot_tags(s) for s in ['weapon','offhand','helmet','body','gloves','boots','ring','amulet','belt']}
def rollable(ids, slot):
    return any(m['gen'] in ('prefix','suffix') and not m.get('dom') and set(ids)<={x[0] for x in m['stats']}
               and any(w>0 and t in TAGS[slot] for t,w in m['spawn']) for m in M.values())
def stat_ids(line, slot):
    line=re.sub(r'\{[^}]*\}','',line).strip()
    line=re.sub(r'\((\d+)-\d+\)', r'\1', line)
    hits=[(n,ids) for n,rx,ids in pats if rx.match(line)]
    if not hits: return None
    best=[ids for n,ids in hits if n==hits[0][0]]
    return next((ids for ids in best if rollable(ids, slot)), best[0])
SLOTS={'Weapon 1':'weapon','Weapon 2':'offhand','Helmet':'helmet','Body Armour':'body','Gloves':'gloves','Boots':'boots','Amulet':'amulet','Ring 1':'ring','Ring 2':'ring','Belt':'belt'}
agg=json.load(open('yt/agg.json',encoding='utf-8'))
vid2build={i:k for k,(vc,n,lst) in agg.items() for (v,i,t) in lst}
res=collections.defaultdict(lambda: {'n':0,'cls':collections.Counter(),'slots':collections.defaultdict(collections.Counter),'bases':collections.defaultdict(collections.Counter),'uniq':collections.defaultdict(collections.Counter)})
unmatched=collections.Counter()
for f in glob.glob('pob/*.xml'):
    vid=os.path.basename(f)[:-4]
    key=vid2build.get(vid)
    if not key: continue
    root=ET.parse(f).getroot()
    b=root.find('Build'); asc=b.get('ascendClassName')
    itemsEl=root.find('Items')
    items={it.get('id'): it.text or '' for it in itemsEl.findall('Item')}
    act=itemsEl.get('activeItemSet')
    sets=itemsEl.findall('ItemSet')
    iset=next((s for s in sets if s.get('id')==act), sets[0] if sets else None)
    slotEls=iset.findall('Slot') if iset is not None else itemsEl.findall('Slot')
    slotmap={s.get('name'): s.get('itemId') for s in slotEls}
    r=res[key]; r['n']+=1; r['cls'][asc]+=1
    for sname, iid in slotmap.items():
        if sname not in SLOTS or iid in (None,'0') or iid not in items: continue
        lines=[l.strip() for l in items[iid].split('\n') if l.strip()]
        if not lines: continue
        rarity=lines[0].upper()
        if 'UNIQUE' in rarity: r['uniq'][SLOTS[sname]][lines[1]]+=1; continue
        if 'RARE' not in rarity: continue
        r['bases'][SLOTS[sname]][lines[2] if len(lines)>2 else '']+=1
        try:
            imp_i=next(i for i,l in enumerate(lines) if l.startswith('Implicits:'))
            nimp=int(lines[imp_i].split(':')[1])
        except StopIteration: continue
        for l in lines[imp_i+1+nimp:]:
            ids=stat_ids(l, SLOTS[sname])
            if ids: r['slots'][SLOTS[sname]][','.join(ids)]+=1
            else: unmatched[re.sub(r'[\d.]+','#',re.sub(r'\{[^}]*\}','',l))]+=1
print('builds with PoB data:', len(res), 'pobs', sum(r['n'] for r in res.values()))
for k,r in sorted(res.items(), key=lambda x:-x[1]['n'])[:5]:
    print('\n==',k,'pobs',r['n'],dict(r['cls']))
    for slot,c in r['slots'].items(): print('  ',slot, c.most_common(5))
    print('   uniques:', {s:list(c)[:3] for s,c in r['uniq'].items()})
print('\nunmatched top:', unmatched.most_common(15))
json.dump({k:{'n':r['n'],'cls':dict(r['cls']),'slots':{s:dict(c) for s,c in r['slots'].items()},'bases':{s:dict(c) for s,c in r['bases'].items()},'uniq':{s:dict(c) for s,c in r['uniq'].items()}} for k,r in res.items()}, open('pob/summary.json','w',encoding='utf-8'), ensure_ascii=False)
