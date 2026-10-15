import json
agg=json.load(open('yt_hi/agg.json',encoding='utf-8'))
# (key in agg, tier, display skill, title must contain)
PICK=[
 ('Lightning Arrow|Deadeye','uber','Lightning Arrow',None),
 ('Ice Spear|Hierophant','uber','Ice Spear',None),
 ('Vortex|?','uber','Vortex',None),
 ('Bladefall|?','uber','Bladefall',None),
 ('Blade Vortex|Occultist','uber','Blade Vortex',None),
 ('Kinetic Fusillade|?','uber','Kinetic Fusillade',None),
 ('Ethereal Knives|Elementalist','uber','Ethereal Knives','UBER'),
 ('Animate Guardian|Guardian','uber','Animate Guardian',None),
 ('Lightning Tendrils|?','advanced','Lightning Tendrils',None),
 ('Kinetic Blast|?','advanced','Kinetic Blast','Clustering'),
 ('Ethereal Knives|Assassin','advanced','Ethereal Knives',None),
 ('Discharge|Slayer','advanced','Discharge',None),
 ('Venom Gyre|?','advanced','Venom Gyre',None),
 ('Arc|?','advanced','Arc',None),
 ('Contagion|?','advanced','Contagion','Blight'),
]
out=[]; ids=[]
for key,tier,sk,must in PICK:
    vids=sorted(agg[key]['vids'], reverse=True)
    if must: vids=[v for v in vids if must.lower() in v[2].lower()] or vids
    chosen=vids[:2]
    out.append({'key':key,'tier':tier,'skill':sk,'views':agg[key]['views'],'vids':[v[1] for v in chosen],'titles':[v[2] for v in chosen]})
    ids+= [v[1] for v in chosen]
json.dump(out, open('yt_hi/picks.json','w',encoding='utf-8'), ensure_ascii=False, indent=1)
open('yt_hi/ids.txt','w').write('\n'.join('https://www.youtube.com/watch?v='+i for i in dict.fromkeys(ids)))
for o in out: print(o['tier'], o['key'], o['titles'][0][:70])
