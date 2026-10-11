# -*- coding: utf-8 -*-
"""抓取猫眼演出（大众点评 myshow）指定城市的演唱会数据。
categoryId=1 即「演唱会」。过滤掉 fallback（返回的其他城市数据）。
"""
import json
import urllib.request
import time

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
B = "https://m.dianping.com/myshow"

# 小程序 utils/concerts.js 里 cities 覆盖的城市
TARGETS = ["北京", "上海", "广州", "深圳", "天津", "南京", "杭州", "成都", "重庆", "武汉",
           "西安", "青岛", "长沙", "郑州", "厦门", "苏州", "呼和浩特", "济南", "大连",
           "兰州", "佛山", "太原", "南昌", "温州", "常州", "哈尔滨", "贵阳", "南宁",
           "乌鲁木齐", "洛阳", "石家庄", "海口", "福州", "沈阳", "长春", "临沂", "衡阳"]


def fetch_page(cid, page, size=50, cat=1):
    url = f"{B}/ajax/performances/{cat};st=0;p={page};s={size};tft=0?cityId={cid}&sellChannel=7"
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Referer": "https://show.maoyan.com/",
        "Accept": "application/json, text/plain, */*",
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def main():
    best = json.load(open(r"D:\workbuddy\2026-09-14-22-10-15\city_map.json", encoding="utf-8"))["best"]
    city_ids = {}
    missing = []
    for c in TARGETS:
        if c in best:
            city_ids[c] = best[c]["cid"]
        else:
            missing.append(c)
    print("将抓取城市数:", len(city_ids), "| 映射缺失:", missing, flush=True)
    print("cityIds:", city_ids, flush=True)

    all_rows = []
    stats = []
    for city, cid in city_ids.items():
        got = 0
        page = 1
        total = None
        while page <= 20:
            try:
                d = fetch_page(cid, page)
            except Exception as e:
                print(f"  {city} 第{page}页失败: {e}", flush=True)
                break
            da = d.get("data") or []
            pg = d.get("paging") or {}
            total = pg.get("totalHits")
            for x in da:
                if x.get("cityName") == city:
                    all_rows.append(x)
                    got += 1
            if not pg.get("hasMore") or not da:
                break
            page += 1
            time.sleep(0.3)
        stats.append((city, cid, total, got))
        print(f"  {city:<8} cid={cid:<4} 接口总数={total} 命中={got}", flush=True)

    with open(r"D:\workbuddy\2026-09-14-22-10-15\maoyan_concerts.json", "w", encoding="utf-8") as f:
        json.dump(all_rows, f, ensure_ascii=False, indent=1)
    print("---- 合计抓取:", len(all_rows), flush=True)


if __name__ == "__main__":
    main()
