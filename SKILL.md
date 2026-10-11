---
name: 猫眼演出数据抓取
description: >-
  【猫眼演出数据抓取】>- 【猫眼演出数据抓取】抓取猫眼演出（show.maoyan.com / 大众点评 myshow）的演唱会、话剧、音乐会等演出数据（名称/艺人/场馆/日期/票价/城市）。当用户要「查猫眼演出」「核对票务数据」「补充演唱会场次」，或需要格瓦拉/猫眼演出的结构化场次数据时使用。含接口发现方法、城市 ID 映射、渠道参数坑。
agent_created: true
---

# 猫眼演出数据抓取

## 一、最重要的三条经验（先看，能省 1 小时）

1. **直接请求 `/ajax/...` 会 404**。PC 站 `show.maoyan.com` 是 Next.js，页面 JS 里写的是相对路径 `/ajax/performances/...`，
   但真实接口在 **`m.dianping.com/myshow`**（大众点评演出频道）。别在 show.maoyan.com 上死磕。
2. **SSR 只渲染第一页**。首页/列表页 HTML 里能直接挖出 10 条数据（`__NEXT_DATA__`），
   但 `?pageNo=` `?cityId=` 这类 query **服务端根本不读**，翻页和切城市全是客户端 XHR。
3. **猫眼只卖自家渠道的票**。`sellChannel=7` 是猫眼自有渠道，只在猫眼上架的场次才会出现。
   五月天、林俊杰、陈奕迅这类走大麦的巡演，**猫眼搜索结果就是 0 条**——
   「猫眼查不到」≠「这个演出不存在」，别拿它当数据缺失的依据。

## 二、真实接口

```
https://m.dianping.com/myshow/ajax/performances/{categoryId};st={sort};[k={关键词};]p={page};s={pageSize};tft=0?cityId={cityId}&sellChannel=7
```

- `categoryId`：**0 = 全部分类**，**1 = 演唱会**（15/9/4/6 等是话剧、音乐会、戏曲…）
- `st`：排序，默认 0
- `k`：关键词搜索（需 URL encode），可省略
- `p` / `s`：页码 / 每页条数（s 最大 50）
- `cityId`：猫眼演出城市编码，**必填**，没有「全国」选项（不传会 fallback 到别处）
- `sellChannel=7`：猫眼自有渠道（=2 等价；=1 或不传会拿到另一批）

必需请求头（缺了可能返回空）：

```
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/120.0 Safari/537.36
Referer: https://show.maoyan.com/
Accept: application/json, text/plain, */*
```

返回：

```json
{
  "code": 200,
  "data": [ { "performanceId":498506, "name":"安溥 2026 to ebb 潮水箴言演唱会-上海站",
              "shopName":"梅赛德斯-奔驰文化中心", "showTimeRange":"2026.11.14 / 11.15",
              "priceRange":"480-1180", "lowestPrice":480, "cityId":1, "cityName":"上海",
              "categoryId":1, "lat":31.18, "lng":121.49, "posterUrl":"https://..." } ],
  "paging": { "pageNo":1, "pageSize":50, "totalHits":39, "hasMore":true }
}
```

详情接口：`{base}/ajax/performance/{performanceId};poi=false`

**场次接口（2026-09 实测新增）**：`{base}/ajax/performance/{performanceId}/shows`
返回该演出的**逐场列表** `[{showId, name:"2026-10-01 周四 19:00", startTimeDateFormatted:"2026-10-01", ...}]`。
用途：档期「跳天确认」——列表/详情的 `showTimeRange` 只是首尾区间，
跨多日的驻场/拼盘类演出中间经常有空档（如 9/26、10/2、10/7、10/23 各一场）。
核对真实演出日必须拉 shows 接口，`endDate` 取**最后一场日期**而不是时间段的尾端。
`ticketStatus` 判读：1=尚未开售(soon)、3=在售(onSale)、12=已售罄/结束(sold)。

## 三、城市 ID

`cityId` 无公开映射表（`/ajax/city/allMyCity` 已 404）。用**遍历探测**建立：

```python
# 对 cid 1..400 各请求 s=1，读返回第一条的 cityName
url = f"{BASE}/ajax/performances/1;st=0;p=1;s=1;tft=0?cityId={cid}&sellChannel=7"
```

已知锚点（2026-09 实测，可直接用）：

| cityId | 城市 | cityId | 城市 | cityId | 城市 |
|---|---|---|---|---|---|
| 1 | 北京 | 45 | 重庆 | 92 | 佛山 |
| 2 | 天津 | 50 | 杭州 | 96 | 济南 |
| 10 | 上海 | 55 | 南京 | 101 | 太原 |
| 20 | 广州 | 57 | 武汉 | 105 | 哈尔滨 |
| 30 | 深圳 | 59 | 成都 | 116 | 长春 |
| 42 | 西安 | 60 | 青岛 | 361 | 兰州 |
| 44 | 福州 | 62 | 厦门 | 387 | 乌鲁木齐 |
| 65 | 大连 | 70 | 长沙 | 112 | 温州 |
| 66 | 沈阳 | 73 | 郑州 | 89 | 常州 |
| 76 | 石家庄 | 80 | 苏州 | 94 | 海口 |
| 83 | 南昌 | 236 | 洛阳 | 99 | 南宁 |
| 107 | 贵阳 | 230 | 临沂 | 263 | 衡阳 |
| 139 | 呼和浩特 | — | — | — | — |

**fallback 陷阱**：小城市的接口会把**周边城市**一起返回（如呼市返回包头+太原+北京）。
所以抓完必须**按 `cityName == 目标城市` 过滤**，否则会混入别的城市数据。
反过来，`totalHits` 是该城+周边的合计，别拿它当该城场次数。

## 四、怎么发现接口（方法可复用，适用于任何 Next.js 站）

1. `curl` 列表页 HTML → 确认是 SSR 还是 CSR（找「正在加载中」这类骨架）。
2. 找 SSR 数据：`<script>__NEXT_DATA__ = {...}</script>`（注意是**内联赋值**不是 `id="__NEXT_DATA__"`），
   用 `json.JSONDecoder().raw_decode(raw)` 解析（JSON 后面还跟着其他代码，`json.loads` 会报 Extra data）。
3. 从 JS chunk 里挖接口路径：抓 `/_next/<buildId>/page/<name>.js`，grep `"/ajax` 之类。
4. **接口域名不对时，用 CDP 监听真实请求**：
   无头浏览器 + `Network.enable`，监听 `Network.requestWillBeSent`，页面自己会发出真实 XHR。

CDP 脚本骨架（Node 22 自带 WebSocket，无需装包）：

```js
const { spawn } = require('child_process');
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
// 轮询 http://127.0.0.1:PORT/json/version 直到就绪
// 拿 /json/list 里 type=page 的 webSocketDebuggerUrl，连 WebSocket
// 发 { id, method:'Network.enable' } / 'Page.enable' / 'Runtime.enable'
// 发 'Page.navigate' -> 监听 Network.requestWillBeSent 收集 url
```

关键约束（本机沙箱）：**启动浏览器 + 抓取 + 关浏览器必须在同一条命令内完成**，
否则宿主命令一结束，子进程会被沙箱回收。

## 五、这套流程和脚本

| 脚本 | 作用 |
|---|---|
| `scripts/maoyan_cities.py` | 遍历探测 cityId → 城市名映射（按 totalHits 取最大者为真 ID） |
| `scripts/maoyan_grab.py` | 按城市列表批量抓某分类的场次，自动翻页 + 过滤 fallback |
| `scripts/cdp_sniff.js` | 无头浏览器 + CDP 监听真实网络请求（找接口用） |

跑法：`python -u maoyan_cities.py` → `python -u maoyan_grab.py`（先改脚本里的 TARGETS / 输出路径）

**坑**：Python 输出**不要管道给 head/tail**——被截断会触发 SIGPIPE 直接杀进程，
后面的 json.dump 不执行、文件不落盘。要重定向到文件再看（`> out.txt 2>&1`）。

## 六、数据判读注意

- `showTimeRange` 格式不统一：`2026.11.14 / 11.15`、`2026.09.26 19:00 周六`、`2026.09.25 - 09.27`。
  取起始日期用正则 `(\d{4})\.(\d{1,2})\.(\d{1,2})`。
- 猫眼演出里**大量是驻场/拼盘类**：三里屯爱乐汇「沉浸式金曲」、各地「致敬 BEYOND」、
  「声声不息 80/90 金曲榜」等。做艺人巡演数据时要用关键词过滤掉（致敬/纪念/金曲/老歌/怀旧/沉浸式/群星/交响…）。
- 与小程序/自建数据核对时，匹配键用「城市 + 艺人名是标题子串」，比整串标题匹配稳。
