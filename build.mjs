import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "data");
const JSON_DIR = path.join(__dirname, "json");

const PARENT_DIR = path.join(__dirname, "..");

if (!fs.existsSync(JSON_DIR)) fs.mkdirSync(JSON_DIR, { recursive: true });

function loadMedalFile(filePath) {
    try {
        const source = fs.readFileSync(filePath, "utf8");

        const result = vm.runInNewContext(`
            ${source}

            JSON.stringify(
                typeof medalData !== "undefined"
                    ? medalData
                    : medalDataNoTid
            );
        `);

        const data = JSON.parse(result);

        console.log(`✅  data/${path.basename(filePath)} (${data.length})`);

        return data;

    } catch (err) {

        console.error(`❌ data/${path.basename(filePath)}`, err);

        return [];
    }
}

function buildReleaseData(medalList) {
    const textMap = {};
    const imgsMap = {};

    for (const medal of medalList) {

        const name = medal.name ?? "未知勋章";
        const type = medal.type ?? "";
        const buyLimit = medal.buy_limit ?? "";
        const price = medal.price ?? "";
        const levels = medal.levels ?? "";
        const levelsImg = medal.levels_img ?? {};
        const duration = medal.duration ?? "";
        const backstory = medal.backstory ?? "";
        const date = medal.date ?? "2013-6-9";
        const url_tid = medal.url_tid ?? "";
        const special_note = medal.special_note ?? [];

        if (name === "迷之瓶" && type === "奖品") continue;

        const lines = [name, `【勋章类型】${type}`];

        if (url_tid) lines.push(`【创建时间】<a href="/thread-${url_tid}-1-1.html" target="_blank">${date}（前往博物馆）</a>`);
        else lines.push(`【创建时间】${date}`);

        if (backstory?.trim()) lines.push(`【背景故事】${backstory.trim()}`);

        lines.push(`【入手条件】${buyLimit.replaceAll("在线时间", "在线时间(小时)")}`);

        if (price !== '无') lines.push(`【商店售价】${price}`);

        if (duration) lines.push(`【持续时间】${duration}`);

        if (levels) {
            for (const line of levels.split("\n")) {
                const txt = line.replaceAll("在线时间", "在线时间(小时)").trim();
                if (txt) lines.push(txt);
            }
        }

        if (special_note.length > 0) {
            for (const item of special_note) {
                lines.push(`【特殊说明】${item}`);
            }

        }
        textMap[name] = lines.join("\n");

        const cleanImgs = {};

        for (const [k, v] of Object.entries(levelsImg)) {
            if (Array.isArray(v) && v.length >= 2) {
                cleanImgs[k] = [String(v[0]), Number(v[1])];
            }
        }

        if (Object.keys(cleanImgs).length) imgsMap[name] = cleanImgs;
    }

    return { textMap, imgsMap };
}

function writeJson(fileName, data) {
    fs.writeFileSync(path.join(JSON_DIR, fileName), JSON.stringify(data, null, 2), "utf8");
    console.log(`💾 json/${fileName}`);
}

function generateReleaseJs(textMap, imgsMap) {
    return `var 放大镜内容映射表 = ${JSON.stringify(textMap, null, 4)};

var imgs = ${JSON.stringify(imgsMap, null, 4)};
`;
}

function readRawFilesContent(files) {
    let result = "";

    for (const file of files) {
        if (!fs.existsSync(file)) continue;

        let text = fs.readFileSync(file, "utf8");

        if (!text.endsWith("\n")) text += "\n";

        result += text;
    }

    return result;
}

function insertContentToTemplate(insertText, templatePath, outputPath, marker = "/* 插入位置 */") {
    if (!fs.existsSync(templatePath)) {
        console.error(`❌ 模板不存在: ${templatePath}`);
        return false;
    }

    const templateText = fs.readFileSync(templatePath, "utf8");

    if (!templateText.includes(marker)) {
        console.error(`❌ 未找到标记: ${marker}`);
        return false;
    }

    const result = templateText.replace(marker, `${marker}\n${insertText}`);

    fs.writeFileSync(outputPath, result, "utf8");

    console.log(`✨ 已生成: ${path.basename(outputPath)}`);

    return true;
}

function main() {
    const files = [
        path.join(DATA_DIR, "medalData_NoTid.js"),
        path.join(DATA_DIR, "medalData.js")
    ];

    const allMedals = [];
    const totalText = {};
    const totalImgs = {};

    for (const file of files) {
        const medals = loadMedalFile(file);

        allMedals.push(...medals);

        const { textMap, imgsMap } = buildReleaseData(medals);

        Object.assign(totalText, textMap);
        Object.assign(totalImgs, imgsMap);
    }

    writeJson("medal.json", allMedals);
    writeJson("medal_info.json", totalText);
    writeJson("medal_imgs.json", totalImgs);

    const releaseJsText = generateReleaseJs(totalText, totalImgs);
    fs.writeFileSync(path.join(JSON_DIR, "medal_SaltFish_release.js"), releaseJsText, "utf8");
    console.log("💾 json/medal_SaltFish_release.js");

    const rawCombinedText = readRawFilesContent(files);

    insertContentToTemplate(rawCombinedText, path.join(__dirname, "js", "GM放大镜_多功能版.js"), path.join(__dirname, "☆GM放大镜_多功能版.js"));

    insertContentToTemplate(releaseJsText, path.join(__dirname, "js", "☆GM论坛勋章放大镜.js"), path.join(__dirname, "☆GM论坛勋章放大镜.js"));

    console.log("🎉 构建完成");
}

main();