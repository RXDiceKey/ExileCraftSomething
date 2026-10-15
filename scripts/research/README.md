One-off research scripts that produced `src/data/builds.json` and `docs/builds.md` (Python, run from a scratch folder).

1. YouTube search with yt-dlp: `yt-dlp "ytsearch60:<query>" --flat-playlist --dump-json > yt/<query>.jsonl` for queries like
   "path of exile 3.29 build", "poe 3.28 league starter", ... then aggregate titles by skill gem + ascendancy into `yt/agg.json`
   and `yt/top_builds.json` (views summed per skill, poe.ninja's visible top-4 skills boosted in).
2. `yt-dlp --dump-json` on the top videos for descriptions, pull pobb.in links, fetch `https://pobb.in/<id>/raw`,
   base64url + zlib decode into `pob/<videoId>.xml`.
3. `pob_parse.py`: rare items per slot -> option lines -> stat ids (English templates from `src/data`) -> `pob/summary.json`.
4. `make_profiles.py`: per-build slot wants and base preferences -> `src/data/builds.json`.
5. `review_doc.py`: Korean review document -> `docs/builds.md`.

Paths inside the scripts point at this repo (`D:/gsrepo/craftingisfun/`); adjust if it moves. Redo for a new league by
re-running the searches with the new patch number.
