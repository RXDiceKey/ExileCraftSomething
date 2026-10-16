# Elemental resistances are one want (user, 2026-10-16): fire, cold and lightning resistance (all-elements and two-element
# mods too) fold into the total, src/game/meta.ts ELE_RES. An element-and-chaos mod also counts as chaos resistance, which
# stays its own want. Righteous Fire is the exception: it wants fire resistance on its own, first.
import re

ELE_RES = 'pseudo_total_elemental_resistance_%'
CHAOS = 'base_chaos_damage_resistance_%'
ELEMENTAL = re.compile(r'^(base_(fire|cold|lightning)_damage_resistance_%|base_resist_all_elements_%'
                       r'|(fire|cold|lightning)_and_(cold|lightning|chaos)_damage_resistance_%)$')
OWN_RES = {'righteous-fire': 'base_fire_damage_resistance_%'}


def merge_res(wants, build_id):
    own = OWN_RES.get(build_id)
    ele = [w for s, w in wants.items() if (s == ELE_RES or ELEMENTAL.match(s)) and s != own]
    chaos = [w for s, w in wants.items() if s.endswith('_and_chaos_damage_resistance_%')]
    out = {}
    for s, w in wants.items():
        if s == ELE_RES or ELEMENTAL.match(s):
            if ELE_RES not in out and ele:
                out[ELE_RES] = max(ele)  # where the first elemental resistance was
                if own:
                    out[own] = 1.0  # right after it, so the codex's top options show it
        else:
            out[s] = max(w, *chaos) if s == CHAOS and chaos else w
    if chaos and CHAOS not in out:
        out[CHAOS] = max(chaos)
    return out
