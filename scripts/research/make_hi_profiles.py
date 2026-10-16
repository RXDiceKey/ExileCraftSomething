# High-end builds: same PoB -> slot wants pipeline as the starters (make_profiles.py), tagged 'advanced' or 'uber'.
# Inputs (scratch folder): yt_hi/picks.json (chosen videos), pob_hi/<videoId>.xml (decoded PoBs).
import json, re, os, sys, collections, xml.etree.ElementTree as ET
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from res_wants import merge_res

R = 'D:/gsrepo/craftingisfun/'
picks = json.load(open('yt_hi/picks.json', encoding='utf-8'))
starters = [b for b in json.load(open(R + 'src/data/builds.json', encoding='utf-8')) if b.get('tier', 'starter') == 'starter']
stats = json.load(open(R + 'src/data/stats.json', encoding='utf-8'))
en = json.load(open(R + 'src/data/text.en.json', encoding='utf-8'))['stats']
mods = json.load(open(R + 'src/data/mods.json', encoding='utf-8'))
# Lower attribute requirements: rolls often, rarely what a build is after (user).
rollable = {s for m in mods.values() if m['gen'] in ('prefix', 'suffix') and not m.get('dom') for s, _, _ in m['stats']} - {'local_attribute_requirements_+%'}
bases = json.load(open(R + 'data-raw/repoe/base_items.json', encoding='utf-8'))


def dat(lang, t):
    return {r['Id']: r['Name'] for r in json.load(open(R + f'data-raw/dat/tables/{lang}/{t}.json', encoding='utf-8'))}


gem_en, gem_ko = dat('English', 'BaseItemTypes'), dat('Korean', 'BaseItemTypes')
asc_ko_by_id = dat('Korean', 'Ascendancy')
asc_ko = {r['Name']: asc_ko_by_id[r['Id']] for r in json.load(open(R + 'data-raw/dat/tables/English/Ascendancy.json', encoding='utf-8'))}
gem_id = {}
for i, n in gem_en.items():
    if '/Gems/SkillGem' in i:
        gem_id.setdefault(n, i)

NUM = r'[+-]?\d+(?:\.\d+)?'
pats = sorted(
    [(len(s), re.compile('^' + NUM.join(re.escape(p) for p in re.split(r'\{\d+\}', s)) + '$', re.I), e['ids'])
     for i, e in enumerate(stats) for s in en[i] if s and '{' in s],
    key=lambda x: -x[0])


# Same tie-break as pob_parse.py: among equally long templates, the stat a random prefix/suffix can roll on that slot
# ("#% increased Attack Speed" is local on weapons, global on gloves).
game_bases = json.load(open(R + 'src/data/bases.json', encoding='utf-8'))
SLOT_CLASSES = {'helmet': {'Helmet'}, 'body': {'Body Armour'}, 'gloves': {'Gloves'}, 'boots': {'Boots'}, 'ring': {'Ring'},
                'amulet': {'Amulet'}, 'belt': {'Belt'}}
NOT_WEAPON = {c for cs in SLOT_CLASSES.values() for c in cs} | {'Shield', 'Quiver'}


def slot_tags(slot):
    if slot in SLOT_CLASSES:
        ok = lambda c: c in SLOT_CLASSES[slot]
    elif slot == 'offhand':
        ok = lambda c: c not in NOT_WEAPON - {'Shield', 'Quiver'}
    else:
        ok = lambda c: c not in NOT_WEAPON
    return {t for b in game_bases.values() if ok(b['cls']) for t in b['tags']} - {'default'}


TAGS = {s: slot_tags(s) for s in ['weapon', 'offhand', 'helmet', 'body', 'gloves', 'boots', 'ring', 'amulet', 'belt']}


def rolls_on(ids, slot):
    return any(m['gen'] in ('prefix', 'suffix') and not m.get('dom') and set(ids) <= {x[0] for x in m['stats']}
               and any(w > 0 and t in TAGS[slot] for t, w in m['spawn']) for m in mods.values())


def stat_ids(line, slot):
    line = re.sub(r'\{[^}]*\}', '', line).strip()
    line = re.sub(r'\((\d+)-\d+\)', r'\1', line)
    hits = [(n, ids) for n, rx, ids in pats if rx.match(line)]
    if not hits:
        return None
    best = [ids for n, ids in hits if n == hits[0][0]]
    return next((ids for ids in best if rolls_on(ids, slot)), best[0])


SLOTS = {'Weapon 1': 'weapon', 'Weapon 2': 'offhand', 'Helmet': 'helmet', 'Body Armour': 'body', 'Gloves': 'gloves',
         'Boots': 'boots', 'Amulet': 'amulet', 'Ring 1': 'ring', 'Ring 2': 'ring', 'Belt': 'belt'}
base_by_name = {}
for i, b in bases.items():
    if b.get('release_state') == 'released' and b.get('domain') == 'item':
        base_by_name.setdefault(b['name'], b)
DEF = {'str': 'armour', 'dex': 'evasion', 'int': 'es'}


def defences(b):
    if 'ward_armour' in b['tags']:
        return ['ward']
    t = next((t for t in b['tags'] if re.fullmatch(r'(str|dex|int)(_(dex|int))*_armour', t)), None)
    return [DEF[a] for a in t.replace('_armour', '').split('_')] if t else []


def parse(path):
    root = ET.parse(path).getroot()
    b = root.find('Build')
    items_el = root.find('Items')
    items = {it.get('id'): it.text or '' for it in items_el.findall('Item')}
    sets = items_el.findall('ItemSet')
    act = items_el.get('activeItemSet')
    iset = next((s for s in sets if s.get('id') == act), sets[0] if sets else None)
    slot_els = iset.findall('Slot') if iset is not None else items_el.findall('Slot')
    out = collections.defaultdict(lambda: {'stats': collections.Counter(), 'bases': collections.Counter(), 'uniq': 0})
    for s in slot_els:
        name, iid = s.get('name'), s.get('itemId')
        if name not in SLOTS or iid in (None, '0') or iid not in items:
            continue
        lines = [l.strip() for l in items[iid].split('\n') if l.strip()]
        if lines and 'UNIQUE' in lines[0].upper():
            out[SLOTS[name]]['uniq'] += 1
        if not lines or 'RARE' not in lines[0].upper():
            continue
        out[SLOTS[name]]['bases'][lines[2] if len(lines) > 2 else ''] += 1
        try:
            imp = next(i for i, l in enumerate(lines) if l.startswith('Implicits:'))
            n = int(lines[imp].split(':')[1])
        except StopIteration:
            continue
        for l in lines[imp + 1 + n:]:
            ids = stat_ids(l, SLOTS[name])
            if ids:
                out[SLOTS[name]]['stats'][','.join(ids)] += 1
    return b.get('ascendClassName'), out


DONOR = {'Ethereal Knives|Elementalist': 'ethereal-knives', 'Ethereal Knives|Assassin': 'ethereal-knives',
         'Lightning Tendrils|?': 'arc', 'Arc|?': 'arc', 'Contagion|?': 'essence-drain',
         'Animate Guardian|Guardian': 'animate-guardian', 'Lightning Arrow|Deadeye': 'lightning-arrow'}
DEFAULT_ASC = {'Animate Guardian': 'Guardian', 'Vortex': 'Elementalist', 'Bladefall': 'Occultist',
               'Lightning Tendrils': 'Elementalist', 'Arc': 'Elementalist', 'Contagion': 'Trickster',
               'Venom Gyre': 'Slayer', 'Kinetic Fusillade': 'Hierophant', 'Kinetic Blast': 'Hierophant'}
TIER_KO = {'advanced': '고급', 'uber': '우버'}

out = []
for p in picks:
    sk = p['skill']
    asc = p['key'].split('|')[1]
    slots = collections.defaultdict(lambda: {'stats': collections.Counter(), 'bases': collections.Counter(), 'uniq': 0})
    n = 0
    for vid in p['vids']:
        f = f'pob_hi/{vid}.xml'
        if not os.path.exists(f):
            continue
        a, s = parse(f)
        n += 1
        if asc == '?' and a:
            asc = a
        for k, v in s.items():
            slots[k]['stats'].update(v['stats'])
            slots[k]['bases'].update(v['bases'])
            slots[k]['uniq'] += v['uniq']
    if asc in ('?', 'None', None):
        asc = DEFAULT_ASC.get(sk, '')
    res = {}
    for slot, v in slots.items():
        if v['uniq'] > sum(v['bases'].values()):  # mostly a unique here: no rare buyer for this slot
            continue
        top = [(st, c) for st, c in v['stats'].most_common() if all(x in rollable for x in st.split(','))][:8]
        if not top:
            continue
        mx = top[0][1]
        wants = {}
        for st, c in top:
            # Stun and block recovery rides along on hybrid defence mods; alone it's junk (user), so it's never a want.
            for x in st.split(','):
                if x != 'base_stun_recovery_+%':
                    wants[x] = max(wants.get(x, 0), round(0.4 + 0.6 * c / mx, 2))
        e = {'wants': wants}
        bs = [base_by_name[nm] for nm in v['bases'] if nm in base_by_name]
        if slot in ('weapon', 'offhand'):
            cls = sorted({x['item_class'] for x in bs})
            if cls:
                e['classes'] = cls
        if slot in ('helmet', 'body', 'gloves', 'boots') or (slot == 'offhand' and any(x['item_class'] == 'Shield' for x in bs)):
            d = sorted({d for x in bs for d in defences(x)})
            if d:
                e['defence'] = d
        res[slot] = e
    src = 'pob'
    if not res and p['key'] in DONOR:
        donor = next(b for b in starters if b['id'] == DONOR[p['key']])
        res = donor['slots']
        src = 'donor:' + donor['name']['en']
    gid = gem_id[sk]
    out.append({
        'id': re.sub(r'[^a-z]+', '-', f"{sk} {asc} {p['tier']}".lower()).strip('-'),
        'name': {'en': f"{sk} {asc} ({p['tier'].capitalize()})".replace('  ', ' '),
                 'ko': f"{gem_ko[gid]} {asc_ko.get(asc, '')} ({TIER_KO[p['tier']]})".replace('  ', ' ')},
        'tier': p['tier'], 'views': p['views'], 'pobs': n, 'source': src, 'slots': res, 'video': p['titles'][0],
    })
for x in out:
    for v in x['slots'].values():
        v['wants'] = merge_res(v['wants'], x['id'])
json.dump(out, open('yt_hi/profiles.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
# Merge with the starters and recompute popularity shares over all builds (by video views).
merged = starters + out
total = sum(b['views'] for b in merged)
for b in merged:
    b['share'] = round(b['views'] / total, 4)
json.dump(merged, open(R + 'src/data/builds.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('builds.json:', len(merged), 'builds')
for x in out:
    print(f"{x['tier']:<8} {x['name']['ko']:<28} pobs {x['pobs']} {x['source']:<30} slots {sorted(x['slots'])}")
