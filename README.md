# Gm_Scripts

## 结构说明
```bash
Gm_Scripts
├─ data         # 填写修改勋章数据
│  ├─ medalData.js
│  └─ medalData_NoTid.js
├─ js           # 修改放大镜业务功能
│  └─ ☆GM论坛勋章放大镜.js
├─ json
│  ├─ medal.json
│  ├─ medal_imgs.json
│  ├─ medal_info.json
│  └─ medal_SaltFish_release.js
├─ build.mjs
├─ build-win.bat
├─ README.md
└─ ☆GM论坛勋章放大镜.js
```

- build.mjs js 自动转换脚本（GitHub Actions自动执行）
  - 转换data下勋章数据 -> json下多种勋章数据版本
  - 将勋章数据插回`☆GM论坛勋章放大镜.js`中
- build-win.bat win下，自动调用build.mjs，生成完整JSON数据+放大镜脚本
- date 勋章数据（修改数据到此处）
  - medalData.js 勋章博物馆中存在的数据
  - medalData_NoTid.js 不在勋章博物馆的数据
- js 放大镜脚本的功能部分，剥离了数据
  - ☆GM论坛勋章放大镜.js （修改放大镜功能到此处）
- json 自动生成的不同格式勋章数据
  - medal.json `medalData.js + medalData_NoTid.js`的严格JSON版，可以API直接请求
  - medal_SaltFish_release.js 转换来的旧版勋章数据格式，包括 `var 放大镜内容映射表`、`var imgs`
  - medal_imgs.json 严格JSON版，可以API直接请求
  - medal_info.json 严格JSON版，可以API直接请求
  - xxx 提交版本，用来判断数据是否为最新（暂时未做）
- ☆GM论坛勋章放大镜.js
  - 外层的`☆GM论坛勋章放大镜.js`为脚本自动输出的最终版本
## 勋章数据结构
medalData、medalDataNoTid 为数组`any[]`
- 数组内部的item详细说明
  - `@property {string} type` ── 类型
  - `@property {string} no` ── 编号
  - `@property {string} url_tid` ── 勋章博物馆帖子tid。不要完整URL，`/thread-187541-1-1.html`中只取`187541`
  - `@property {string} name` ── 勋章名称
  - `@property {string} date` ── 勋章博物馆发帖日期
  - `@property {string} buy_limit` ── 购买勋章的限制条件。无限制的时候填写 无；比较符号统一使用 `≥` `≤` `>` `<` `=` 单个半角符号。
  - `@property {string} price` ── 商店售价
  - `@property {string} [backstory]` ── 背景故事（可选，该字段可不存在）
  - `@property {string} [duration]` ── 持续时长（可选，该字段可不存在）
  - `@property {string} levels` ── 各等级的收益信息。等级间\n分隔；比较符号统一使用 `≥` `≤` `>` `<` `=` 单个半角符号。
  - `@property {Object} levels_img` ── 各等级对应的图片信息
    - `["初级"]` ── 【等级 初级】的图片配置 `[url, width]`
    - `["1"]` ── 【等级 1】的图片配置 `[url, width]`
    - `[Max]` ── 【Max】最高等级的图片配置 `[url, width]`
> buy_limit、levels 中【在线时间】不写单位。原本有2种：【在线时间(小时)>100】、【在线时间>100小时】，不写单位格式化转化的medal_SaltFish_release.js统一为【线时间(小时)>100】。
