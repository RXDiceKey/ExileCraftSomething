import json, re
R='D:/gsrepo/craftingisfun/'
builds=json.load(open(R+'src/data/builds.json',encoding='utf-8'))
stats=json.load(open(R+'src/data/stats.json',encoding='utf-8'))
ko=json.load(open(R+'src/data/text.ko.json',encoding='utf-8'))
en=json.load(open(R+'src/data/text.en.json',encoding='utf-8'))
idx={}
for i,e in enumerate(stats):
    for s in e['ids']: idx.setdefault(s,i)
def text(stat):
    if stat=='pseudo_total_elemental_resistance_%': return '원소 저항'  # res_wants.py: all elements as one total
    i=idx.get(stat)
    if i is None: return stat
    k=ko['stats'][i]
    s=k['s'] if k else next((x for x in en['stats'][i] if x), stat)
    return re.sub(r'\{\d+\}','#',s)
SLOT={'weapon':'무기','offhand':'보조 손','helmet':'투구','body':'갑옷','gloves':'장갑','boots':'장화','ring':'반지','amulet':'목걸이','belt':'허리띠','quiver':'화살통'}
DEFK={'armour':'방어도','evasion':'회피','es':'에너지 보호막','ward':'수호'}
SRC={'pob':'PoB','template':'템플릿','donor':'비슷한 빌드 데이터'}
TIER={'starter':'스타터','advanced':'고급','uber':'우버'}
L=[]
L.append('# 빌드 프로필 45개: 스타터 30 + 고급·우버 15 (초안, 검수용)\n')
L.append('파우스투스가 "누가 이 아이템을 쓰는가"를 판단할 때 쓰는 구매자 목록입니다. 숫자 가중치(0–1)는 그 옵션이 그 빌드에 얼마나 중요한지입니다.\n')
L.append('## 만든 방법\n')
L.append('- **인기도**: poe.ninja Allflame 빌드 페이지 상위 4개(겨울 보주 7%, 정의의 화염 5%, 수호자 기동 5%, 망령 소환 4%) + 유튜브 3.27–3.29 빌드 영상 조회수를 빌드별로 합산. 45개 합쳐서 100%가 되도록 나눔.')
L.append('- **원하는 옵션**: 영상 설명란의 PoB(pobb.in)를 해독해 슬롯별 희귀 아이템 옵션을 집계 (스타터 64개, 고급·우버 15개). 자주 나온 옵션일수록 가중치가 높음 (나온 옵션은 최소 0.4).')
L.append('- **유니크를 끼는 슬롯은 비움**: 그 빌드의 PoB 중 과반이 그 부위에 유니크를 끼면 희귀템을 안 사는 부위로 봄 (예: 회오리바람 슬레이어는 장갑·반지만 삼).')
L.append('- PoB가 없는 빌드: 비슷한 빌드 데이터 또는 템플릿(소환수: 망령 소환·무기 기동·면죄, 오라: 수호자 기동).')
L.append('- 합친 것: 얼음 폭발 + 바알 얼음 폭발, 정수 흡수 + 전염(EDC).')
L.append('- **고급·우버 15개**: 유튜브 "mirror tier / uber boss / billion dps / endgame showcase / juiced mapping" 검색(3.27–3.29) 영상 중 엔드게임 근거가 있는 빌드. 우버는 1–2등급 옵션만, 고급은 3등급까지만 쳐 주고, 슬롯 예산이 우버 10배·고급 3배.')
L.append('- **가격 규칙**: 한 빌드가 원하는 좋은 옵션이 한 아이템에 모일수록 값이 급등 (좋은 옵션 하나 더 = 약 4배).\n')
L.append('**검수해 주실 것**: 빌드 목록이 맞는지, 슬롯별로 빠졌거나 잘못 들어간 옵션, 베이스 종류(방어 종류·무기 종류). 수정할 부분을 말씀해 주시면 반영합니다.\n')
L.append('## 목록\n')
L.append('| # | 빌드 | 단계 | 인기도 | PoB | 출처 |')
L.append('|---|---|---|---|---|---|')
for i,b in enumerate(builds,1):
    src=b['source'].split(':')[0]
    extra=(' ('+b['source'].split(':')[1]+')') if ':' in b['source'] else ''
    L.append(f"| {i} | {b['name']['ko']} ({b['name']['en']}) | {TIER[b.get('tier','starter')]} | {b['share']*100:.1f}% | {b['pobs']} | {SRC[src]}{extra} |")
L.append('')
for i,b in enumerate(builds,1):
    L.append(f"## {i}. {b['name']['ko']}")
    L.append('')
    if b.get('video'): L.append(f"- 참고 영상: {b['video']}")
    if not b['slots']:
        L.append('- (희귀템을 사는 슬롯 없음)')
        L.append('')
        continue
    for slot in ['weapon','offhand','helmet','body','gloves','boots','amulet','ring','belt','quiver']:
        e=b['slots'].get(slot)
        if not e: continue
        pref=[]
        if e.get('classes'): pref.append(', '.join(ko['classes'].get(c,c) for c in e['classes']))
        if e.get('defence'): pref.append('/'.join(DEFK[d] for d in e['defence']))
        wants=sorted(e['wants'].items(), key=lambda x:-x[1])
        seen=set(); items=[]
        for st,w in wants:
            t=text(st)
            if t in seen: continue
            seen.add(t); items.append(f'{t} ({w:g})')
        L.append(f"- **{SLOT[slot]}**" + (f" [{' · '.join(pref)}]" if pref else '') + ': ' + ', '.join(items))
    L.append('')
open(R+'docs/builds.md','w',encoding='utf-8').write('\n'.join(L))
print('lines',len(L))
