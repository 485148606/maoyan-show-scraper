# -*- coding: utf-8 -*-
"""遍历探测猫眼演出的 cityId -> 城市名 映射。
fallback 干扰：无效 cityId 会返回邻近城市且 totalHits 很小，
所以每个城市取 totalHits 最大的那个 cityId 作为真实 ID。
"""
import json
import urllib.request
import concurrent.futures

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
B = "https://m.dianping.com/myshow"


def fetch(cid):
    url = f"{B}/ajax/performances/1;st=0;p=1;s=1;tft=0?cityId={cid}&sellChannel=7"
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Referer": "https://show.maoyan.com/",
        "Accept": "application/json, text/plain, */*",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            d = json.load(r)
        da = d.get("data") or []
        total = (d.get("paging") or {}).get("totalHits") or 0
        if da:
            return (cid, da[0].get("cityName"), total)
        return (cid, None, total)
    except Exception:
        return (cid, None, None)


def main():
    rows = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        for cid, name, total in ex.map(fetch, range(1, 401)):
            if name and total:
                rows.append((cid, name, total))

    best = {}
    for cid, name, total in rows:
        cur = best.get(name)
        if cur is None or total > cur[1]:
            best[name] = (cid, total)

    out = {"best": {k: {"cid": v[0], "total": v[1]} for k, v in best.items()}, "all": rows}
    with open(r"D:\workbuddy\2026-09-14-22-10-15\city_map.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    print(f"城市数: {len(best)}")
    for k, v in sorted(best.items(), key=lambda x: -x[1][1]):
        print(f"{v[0]:>4}  {k:<10} {v[1]}")


if __name__ == "__main__":
    main()
