// ==UserScript==
// @name         勋章放大镜
// @namespace    http://tampermonkey.net/
// @version      2.7.28
// @description  泥潭勋章属性展示！
// @author       轶致
// @match        https://www.gamemale.com/wodexunzhang-showxunzhang.html*
// @match        https://www.gamemale.com/plugin.php?id=wodexunzhang%3Ashowxunzhang&fid=*
// @match        https://www.gamemale.com/plugin.php?id=wodexunzhang%3Ashowxunzhang&action=*
// @match        https://www.gamemale.com/plugin.php?id=wodexunzhang:showxunzhang&action=my
// @namespace    https://www.gamemale.com/forum.php?mod=viewthread&tid=129944
// @homepage     https://www.gamemale.com/thread-129944-1-1.html
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @license      GPL
// @icon         https://www.gamemale.com/template/mwt2/extend/img/favicon.ico
// ==/UserScript==

// 推荐链接：博物馆传送门 https://www.gamemale.com/thread-144398-1-1.html
// 神秘的许愿池 https://www.gamemale.com/plugin.php?id=wodexunzhang%3Ashowxunzhang&fid=24
// 蛇年抽奖 https://www.gamemale.com/plugin.php?id=wodexunzhang%3Ashowxunzhang&fid=30
// 0.54血毕业男从比较 https://www.gamemale.com/thread-149145-1-2.html
// 勋章改动一览 https://www.gamemale.com/forum.php?mod=viewthread&tid=8878&extra=&authorid=63991&page=2

// 勋章放大镜下载更新地址
// https://greasyfork.org/zh-CN/scripts/516559
// 镜像地址
// https://gf.qytechs.cn/zh-CN/scripts/516559

// TODO 上次补货时间
(function () {
    'use strict'
    // 0为原版【上下显示】 1为新版【左右显示】
    // 似乎手机上下显示没问题，那保留一下
    // 判断是否为移动设备（包括 iPhone）
    const isMobile = /Mobi|Android|iPhone/i.test(navigator.userAgent)

    // 是否显示图片true or false，默认true显示
    // 2.7.18版本之后不需要修改此处，直接点击菜单即可修改
    let showImg = true;

    if (GM_getValue("toggleSetting") === undefined) {
        // toggleSetting 代表放大镜是否位于标签左右 true为左右，false为上下
        GM_setValue("toggleSetting", !isMobile) // 如果是移动设备，默认为 false；否则为 true
    }

    if (GM_getValue("showImgSetting") === undefined) {
        console.log("get showImgSetting undefined, set default " + showImg);
        GM_setValue("showImgSetting", showImg);
    }
    else {
        showImg = GM_getValue("showImgSetting");
        console.log("get showImgSetting " + showImg);
    }

    // 创建菜单命令用于切换设置
    GM_registerMenuCommand("切换放大镜显示位置", toggleSettingFun)
    function toggleSettingFun() {
        const currentValue = GM_getValue("toggleSetting")
        const newValue = !currentValue
        GM_setValue("toggleSetting", newValue)
    }

    // 创建菜单命令显示图片设置
    GM_registerMenuCommand("切换放大镜图片显示", showImgSettingFun)
    function showImgSettingFun() {
        showImg = !showImg;
        console.log("set showImgSetting " + showImg);
        GM_setValue("showImgSetting", showImg);
        初始化放大镜();
        变化检测();
    }

    // 此外右下角有一个放大器可以显示/隐藏放大镜，解决遮挡原信息问题
    // 估计很多人没法发现过这个东西
    let 放大镜显示 = localStorage.getItem('放大镜显示') !== 'false'

    // @deprecated 已弃用
    // 删掉右下角的勋章显示切换，避免误触。已经有好几个人来问我了
    function 创建控制面板() {
        const 控制面板 = document.createElement('div')
        控制面板.id = '控制面板'
        控制面板.style.position = 'fixed'
        控制面板.style.bottom = '20px'
        控制面板.style.right = '20px'
        控制面板.style.zIndex = '1000'
        控制面板.innerHTML = `<button id="切换放大镜按钮" style="font-size: 18px; background: none; border: none; padding: 0; box-shadow: none; line-height: 1;">${放大镜显示 ? "🔎✅" : "🔎🚫"}</button>`
        document.body.appendChild(控制面板)
        document.getElementById("切换放大镜按钮").addEventListener("click", 切换放大镜显示)
    }

    function 切换放大镜显示() {
        放大镜显示 = !放大镜显示
        this.innerHTML = 放大镜显示 ? "🔎✅" : "🔎🚫"
        localStorage.setItem('放大镜显示', 放大镜显示)
        if (!放大镜显示) {
            隐藏所有放大镜()
        }
    }

    function 创建放大镜() {
        const 放大镜 = document.createElement('div')
        放大镜.id = '泥潭勋章放大镜'
        放大镜.style.position = 'absolute'
        放大镜.style.padding = '10px'
        放大镜.style.background = 'white'
        放大镜.style.border = '1px solid black'
        放大镜.style.borderRadius = '5px'
        放大镜.style.display = 'none'
        放大镜.style.zIndex = '10000'
        放大镜.style.fontWeight = 'bold'
        放大镜.style.color = '#000516'
        放大镜.style.maxHeight = '550px' // 设置最大高度 禽兽扒手无滚动条的高度
        放大镜.style.overflowY = 'auto'  // 添加垂直滚动条
        document.body.appendChild(放大镜)
        return 放大镜
    }

    const 放大镜 = 创建放大镜()

    const 收益权重映射 = {
        '金币': 1,
        '血液': 1,
        '旅程': 30,
        '咒术': 5,
        '知识': 50,
        '灵魂': 1000,
        '堕落': 0 // 堕落不计入总消耗
    }

    const 属性映射 = {
        '金币': { 颜色: '#FFBF00', emoji: '💰' },
        '血液': { 颜色: '#ff0000', emoji: '🩸' },
        '旅程': { 颜色: '#008000', emoji: '✈️' },
        '咒术': { 颜色: '#a52a2a', emoji: '🔮' },
        '知识': { 颜色: '#0000ff', emoji: '📖' },
        '灵魂': { 颜色: '#add8e6', emoji: '✡️' },
        '堕落': { 颜色: '#800080', emoji: '😈' },
        '总计': { 颜色: '#ffa500', emoji: '🈴' }
    }

    const 属性颜色映射 = {
        '回帖': '#0189ff',
        '发帖': 'purple'
    }

    function 计算收益(文本) {
        const 行列表 = 文本.split('\n')
        let 收益详情列表 = []
        let 最大收益 = { 收益: 0, 等级: 0 }

        for (let i = 0; i < 行列表.length; i++) {
            const 行 = 行列表[i]
            let 总收益 = 0
            let 非自动升级收益 = 0
            let 行收益详情 = ''

            // 匹配触发几率
            const 触发几率匹配 = 行.match(/】(\d+)%/)
            if (触发几率匹配) {
                const 触发几率 = parseFloat(触发几率匹配[1]) / 100

                // 匹配回帖属性
                const 回帖属性匹配 = 行.match(/回帖(.*?)(,|$|发帖|升级|▕)/)
                if (回帖属性匹配) {
                    const 属性匹配 = [...回帖属性匹配[1].matchAll(/(金币|血液|旅程|咒术|知识|灵魂|堕落)(\+|-)(\d+)/g)]
                    let 非堕落属性计数 = 0

                    for (const 匹配 of 属性匹配) {
                        const 属性 = 匹配[1]
                        const 符号 = 匹配[2] // '+' 或 '-'
                        const 值 = parseInt(匹配[3], 10) * (符号 === '+' ? 1 : -1)

                        if (属性 !== '堕落') {
                            非堕落属性计数++
                            const 权重 = 收益权重映射[属性] || 0
                            const 收益 = 触发几率 * 值 * 权重
                            总收益 += 收益

                            if (收益 !== 0) {
                                行收益详情 += `<span style="color:${属性映射[属性].颜色};"><span style="font-family:Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji">${属性映射[属性].emoji}</span>${收益.toFixed(2)}</span> `
                            }

                            if (!行.includes('≥')) {
                                非自动升级收益 = 总收益
                            }
                        }
                    }

                    // 如果有多个非堕落属性，显示总收益
                    if (非堕落属性计数 > 1) {
                        行收益详情 += `<span style="color:${属性映射['总计'].颜色};"><span style="font-family:Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji">${属性映射['总计'].emoji}</span>${总收益.toFixed(2)}</span>`
                    }

                    // 更新最大收益
                    if (非自动升级收益 > 最大收益.收益) {
                        最大收益 = { 收益: 总收益, 等级: 行.match(/【等级(\d+)】/)?.[1] || 'Max' }
                    }
                }
            }

            // 将当前行的收益详情加入列表
            收益详情列表.push(行收益详情.trim())
        }

        return {
            收益详情列表,
            // 距离最大等级的非0, 非自动升级收益（因为自动升级收益无法控制且多为彩蛋性质）
            最大收益: { 等级: 最大收益.等级, 收益: 最大收益.收益.toFixed(2) }
        }
    }

    function 计算回本周期(内容, 升级消耗, 最大收益) {
        const 匹配结果 = 内容.match(/商店售价】(\d+)(金币|血液|旅程|咒术|知识|灵魂|堕落)?/)
        let 价格 = parseInt(匹配结果?.[1]) || 0
        const 单位 = 匹配结果?.[2]
        价格 = 价格 * (收益权重映射[单位] || 0)
        const 总价 = 升级消耗 + 价格

        if (最大收益.收益 > 0 && 总价 > 0) {
            const 回本周期1 = 升级消耗 / 最大收益.收益
            const 回本周期2 = 总价 / 最大收益.收益
            const 回本周期文本 = `【回本周期】以等级${最大收益.等级}计算，升级消耗回本${Math.ceil(回本周期1)}贴, 考虑勋章价格回本${Math.ceil(回本周期2)}贴`
            return 回本周期文本
        } else {
            return ''
        }
    }

    /**
     * 修改属性颜色
     *
     * 根据内容计算收益详情列表、最大收益、升级消耗和回本周期，并修改内容中的属性颜色。
     *
     * @param {string} 内容 - 要处理的内容字符串
     * @returns {string} - 修改后的新内容字符串
     */
    function 修改属性颜色(内容) {
        const 收益详情列表 = 计算收益(内容).收益详情列表
        const 最大收益 = 计算收益(内容).最大收益
        const 升级消耗 = 统计升级消耗(内容)
        const 升级消耗文本 = 升级消耗.文本
        const 回本周期 = 计算回本周期(内容, 升级消耗.数字, 最大收益)

        const 行列表 = 内容.split('\n')
        let 新内容 = ''
        for (let i = 0; i < 行列表.length; i++) {
            const 行 = 行列表[i]
            const 收益详情 = 收益详情列表[i]
            if (收益详情) {
                新内容 += 行.replace(/(】)(\d+)%(\s*)/, `$1${收益详情} $2%$3`)
            } else {
                新内容 += 行
            }
            if (i < 行列表.length - 1) {
                新内容 += '\n'
            }
        }

        // 修改属性颜色
        新内容 = 新内容.replace(/(回帖)(.*?)(?=、|\n|$|发帖|升级|▕)/g, function (match, p1, p2) {
            return `<span style="color:${属性颜色映射['回帖']}">${p1}${p2}</span>`
        })
        新内容 = 新内容.replace(/(发帖)(.*?)(?=、|$|升级|▕)/g, function (match, p1, p2) {
            return `<span style="color:${属性颜色映射['发帖']}">${p1}${p2}</span>`
        })

        新内容 += 升级消耗文本
        新内容 += '\n' + 回本周期

        return 新内容
    }

    function 显示放大镜(内容, 目标) {
        if (!放大镜显示) return
        const 新内容 = 修改属性颜色(内容)
        放大镜.innerHTML = 新内容.replace(/\n/g, '<br>')
        放大镜.style.display = 'block'
        放大镜.style.visibility = 'hidden'

        if (GM_getValue("toggleSetting")) {
            定位放大镜New(目标)
        } else {
            定位放大镜(目标)
        }

        放大镜.style.visibility = 'visible'
    }

    function 定位放大镜(目标) {
        const 放大镜宽度 = 放大镜.offsetWidth
        const 放大镜高度 = 放大镜.offsetHeight
        const 目标矩形 = 目标.getBoundingClientRect()
        let 放大镜左边 = window.pageXOffset + 目标矩形.left - (放大镜宽度 / 2) + (目标矩形.width / 2)
        let 放大镜顶部 = window.pageYOffset + 目标矩形.top - 放大镜高度 - 10

        if (放大镜顶部 < window.pageYOffset) {
            放大镜顶部 = window.pageYOffset + 目标矩形.bottom + 10
        }
        if (放大镜左边 + 放大镜宽度 > window.pageXOffset + document.documentElement.clientWidth) {
            放大镜左边 = window.pageXOffset + document.documentElement.clientWidth - 放大镜宽度 - 10
        }
        if (放大镜左边 < window.pageXOffset) {
            放大镜左边 = window.pageXOffset + 10
        }
        if (放大镜顶部 + 放大镜高度 > window.pageYOffset + window.innerHeight) {
            放大镜顶部 = window.pageYOffset + 目标矩形.top - 放大镜高度 - 10
        }
        放大镜.style.left = 放大镜左边 + 'px'
        放大镜.style.top = 放大镜顶部 + 'px'
    }

    function 定位放大镜New(img) {
        document.querySelectorAll(".MyshowTip2").forEach(label => {
            if (label.style.display != 'none') {
                const 放大镜宽度 = 放大镜.offsetWidth
                const 放大镜高度 = 放大镜.offsetHeight

                // 和原标签顶部对齐
                let 放大镜顶部 = parseInt(label.style.top)

                // 和原来标签的右对齐
                let 放大镜左边 = parseInt(label.style.left) + 200

                // 如果放不下就放左边
                if (放大镜左边 + 放大镜左边 > window.innerWidth) {
                    放大镜左边 = parseInt(label.style.left) - 放大镜宽度
                }
                // console.log(e.getBoundingClientRect())

                // 原来的标签太高了，直接溢出屏幕外（废弃）
                // 如果原标签在图片上方，从顶部对齐变成底部对齐
                const labelTop = label.getBoundingClientRect().top
                const imgTop = img.getBoundingClientRect().top
                const labelHeight = label.getBoundingClientRect().height
                // console.log(imgTop, labelTop)
                if (labelTop < imgTop) {
                    放大镜顶部 = 放大镜顶部 + labelHeight - 放大镜高度
                }

                放大镜.style.top = 放大镜顶部 + 'px'
                放大镜.style.left = 放大镜左边 + 'px'
            }
        })

    }

    function 隐藏放大镜() {
        放大镜.style.display = 'none'
    }

    function 隐藏所有放大镜() {
        隐藏放大镜()
    }

    let timeoutId
    function 添加悬停监听器(目标, 放大镜内容) {
        目标.addEventListener('mouseover', function () {
            if (放大镜内容) {
                clearTimeout(timeoutId); // 清除之前的隐藏任务
                显示放大镜(放大镜内容, 目标)
            }
        })
        目标.addEventListener('mouseout', () => {
            // 延迟隐藏 B
            timeoutId = setTimeout(() => {
                if (!放大镜.matches(':hover')) {
                    隐藏放大镜()
                }
            }, 100) // 延迟时间
        })
    }

    放大镜.addEventListener('mouseleave', () => {
        隐藏放大镜()
    });

    function 初始化放大镜() {
        document.querySelectorAll('.myimg img').forEach(function (img) {
            // 去除【不可购买】并生成基础变体
            const baseAlt = img.getAttribute('alt').replace(/【不可购买】/g, '')
            const variants = [
                baseAlt.replace(/·/g, '‧'),   // 全角转半角点
                baseAlt.replace(/‧/g, '·'),    // 半角点转全角
                baseAlt.replace('/:/g', '：'), // 全角半角冒号
                baseAlt.replace('/：/g', ':'),
            ]

            // 处理可能存在的结尾标点（例如真人男从的. 以及其他各种特殊符号，总之去掉末尾的.是对的）
            const trimEndDot = str => str.slice(0, -1)
            const processedVariants = [...variants, ...variants.map(trimEndDot)]

            // 高效查找映射表（去重 + find短路机制）
            const altKey = [...new Set(processedVariants)].find(alt => alt in 放大镜内容映射表)

            // 判断是否需要显示图片内容
            let showText = 放大镜内容映射表[altKey];
            if (showImg && showText)
            {
                showText = addImgUrl(showText);
            }

            altKey && 添加悬停监听器(img, showText)
        })
    }
    function 变化检测() {
        const 观察 = new MutationObserver(function (变化标记) {
            变化标记.forEach(function (变化) {
                变化.addedNodes.forEach(function (节点) {
                    if (节点.nodeType === Node.ELEMENT_NODE && 节点.matches('.myimg img')) {
                        const 替代文本 = 节点.getAttribute('alt')
                        if (放大镜内容映射表.hasOwnProperty(替代文本)) {
                            添加悬停监听器(节点)
                        }
                    }
                })
            })
        })
        const 目标容器 = document.querySelector('.my_fenlei')
        if (目标容器) {
            观察.observe(目标容器, { childList: true, subtree: true })
        }
    }

    function 统计升级消耗(内容) {
        // 初始化消耗统计对象
        var 消耗统计 = {
            金币: 0,
            血液: 0,
            旅程: 0,
            咒术: 0,
            知识: 0,
            灵魂: 0,
            堕落: 0
        }
        const 升级消耗 = {
            文本: '',
            数字: 0
        }

        // 提取升级条件
        var 升级条件 = 内容.match(/消耗([-\d]+)\s*(金币|血液|旅程|咒术|知识|灵魂|堕落)/g)

        if (升级条件) {
            升级条件.forEach(function (条件) {
                var 消耗数值 = parseInt(条件.match(/[-\d]+/)[0])
                var 资源类型 = 条件.match(/金币|血液|旅程|咒术|知识|灵魂|堕落/)[0]
                消耗统计[资源类型] += 消耗数值
            })
        }

        // 生成消耗描述
        var 消耗描述 = Object.entries(消耗统计)
            .filter(([资源类型, 消耗数值]) => 消耗数值 !== 0)
            .map(([资源类型, 消耗数值]) => {
                var 颜色 = 属性映射[资源类型].颜色
                var emoji = 属性映射[资源类型].emoji
                return `消耗<span style="color: ${颜色}">${消耗数值}${资源类型}</span>`
            })
            .join('、')

        // 计算总消耗
        var 总消耗 = Object.entries(消耗统计)
            .reduce((总计, [资源类型, 消耗数值]) => {
                var 权重 = 收益权重映射[资源类型] || 0
                return 总计 + 消耗数值 * 权重
            }, 0)

        // 返回结果
        if (消耗描述) {
            升级消耗.文本 = `\n  【满级消耗】${消耗描述} 总计消耗${总消耗} `
            升级消耗.数字 = 总消耗
        }
        return 升级消耗
    }

    function addImgUrl(text) {
        // debugger;
        let textLines = text.split('\n');
        let name = textLines[0];
        if (!(name in imgs))
        {
            console.log(name + ' img not fonud or same');
            return text;
        }

        let max_width = 0;
        for (let key in imgs[name])
        {
            max_width = (imgs[name][key][1] > max_width) ? imgs[name][key][1] : max_width;
            if (124 == max_width)
            {
                break;
            }
        }

        // console.log(name + ' max width '+max_width);

        for(let i = 1; i < textLines.length; i++)
        {
            let lv = textLines[i].match(/【等级(\d+)】/)?.[1];
            if (lv)
            {
                lv = lv.toString();
            }
            else if (textLines[i].includes('【 Max 】'))
            {
                lv = 'Max';
            }
            else if (textLines[i].includes('【等级 初级】'))
            {
                lv = '初级';
            }
            else
            {
                continue;
            }
            if (lv in imgs[name])
            {
                let addStr = `<img src="${imgs[name][lv][0]}" width="${imgs[name][lv][1]}px" align="middle">`;
                if (imgs[name][lv][1] < max_width)
                {
                    addStr = addStr + `<img width="${max_width - imgs[name][lv][1]}px" align="middle">`;
                }
                textLines[i] = addStr + textLines[i];
            }
            else // 无图片补齐
            {
                textLines[i] = `<img width="${max_width}px" align="middle">` + textLines[i];
            }
        }

        return textLines.join("\n");
    }

    function reloadScript() {
        // 仅处理勋章商城默认界面
        // console.log(window.location.href);
        if ("https://www.gamemale.com/wodexunzhang-showxunzhang.html" === window.location.href) {
            let count = 0;
            let last_div_num = document.getElementsByClassName('myimg').length;
            let cur_div_num = last_div_num;
            const iid = setInterval(() => {
                if (count > 300) { // 定时器持续1min
                    clearInterval(iid);
                    console.log("clear interval ok.");
                    return;
                }
                cur_div_num = document.getElementsByClassName('myimg').length;
                if (cur_div_num > 0 && cur_div_num > last_div_num) {
                    console.log("init again...");
                    初始化放大镜();
                    变化检测();
                }
                last_div_num = cur_div_num;
                count++;
                // console.log(count);
                return;
            }, 200); // 0.2s检测一次
            console.log("set interval ok.");
            return;
        }
        return;
    }

    /* 插入位置 */

    // 创建控制面板()
    初始化放大镜()
    变化检测()

    reloadScript();
})()

// 录入模板 ≥
var 录入模板 = {
    '时间变异管理局': `时间变异管理局
【勋章类型】
【入手条件】
【商店售价】
【等级1】▕▏升级条件：
【等级2】▕▏升级条件：
【等级3】▕▏升级条件：
【 Max 】`,
}
