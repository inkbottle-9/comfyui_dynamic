// js/resource_monitor.js
// 资源监控浮动面板 (无节点, 纯前端扩展):
// - fixed 悬浮层: 标题栏 (拖动 / 暂停 / 重置+停靠 / 停靠左下 / 最小化, 双击最小化) +
//   内容区 (6 统计卡片 / 折线图 / 模型列表) + 底部状态栏 (语言 / 刷新率 / 消息 / 坐标 / 位置 / 尺寸)
// - 卡片: 占用超 50% 后背景与描边向告警色线性渐变; 温度卡以 100 C 为 100%
// - 模型列表行: 状态配色 + 体积/已加载占比条 + 图标按钮 (复制/打开/卸载)
// - 按钮行: 清理按钮 + 全进程 + 快捷链接下拉 + 本地目录下拉
// - 刷新率 (0-10 Hz, 0 = 暂停) / 语言 / 启用开关经 ComfyUI settings 持久化 (localStorage 兜底)
// - 打开 ComfyUI 设置/模板等对话框时自动最小化, 关闭后自动还原
import { app } from "../../scripts/app.js";


const API_BASE = "/comfyui_dynamic/monitor";
const MAX_POINTS = 180; // 折线图历史点数 (10 Hz 下约 18 s 窗口)

const DEFAULT_RATE = 2; // 刷新率默认值 (Hz)
const DEFAULT_LANG = "en";

// 面板默认尺寸 (px) 与停靠边距
const DEFAULT_W = 380;
const DEFAULT_H = 560;
const DOCK_MARGIN = 10;

// 窗口边缘安全边距 (拖动夹取用)
const EDGE = 8;

// 左侧边栏宽度探测失败时的兜底值 (px), 避免停靠时挡住 CUI 左侧栏
const FALLBACK_SIDEBAR = 56;

// 卡片告警渐变: 占用超过阈值后, t = (p - 阈值) / (100 - 阈值) 线性混入告警色
const WARN_THRESHOLD = 50;
const CARD_WARN_BG = [0x66, 0x00, 0x00];
const CARD_WARN_BORDER = [0xCC, 0x00, 0x00];
const CARD_BASE_BG = [0x23, 0x23, 0x23]; // 与 CSS 中 .dynmon-card 背景一致
const CARD_BASE_BORDER = [0x38, 0x38, 0x38]; // 与 CSS 中 .dynmon-card 描边一致

// 模型列表行状态配色 (背景 + 边框): used = 正在被使用, 基础色 = 空闲
const ROW_USED_BG = [0x14, 0x28, 0x1C];
const ROW_USED_BORDER = [0x2E, 0xA0, 0x43];
const ROW_BASE_BG = [0x23, 0x23, 0x23];
const ROW_BASE_BORDER = [0x38, 0x38, 0x38];

// 模型体积占比条配色 (RGBA: 需要一定透明度与状态底色叠加)
const BAR_MODEL_COLOR = "rgba(88, 166, 255, 0.45)";  // 蓝色: 模型总体积
const BAR_LOADED_COLOR = "rgba(248, 81, 73, 0.55)";  // 红色: 已加载进显存的部分

// 标题栏颜色状态机 (见 MonitorPanel.initHeaderFx): 调用方只设置目标色, 渐变由统一循环插值
const HEADER_DEFAULT = [0x2A, 0x2A, 0x2A];   // 常规 (与 CSS .dynmon-header 背景一致)
const HEADER_ALERT = [0xAA, 0x14, 0x14];     // 警告 (温度超限 / 显存或内存告急)
const HEADER_FLASH = [0x1E, 0x5A, 0xC8];     // 最小化提示 (瞬时红色渐变为蓝色)
const HEADER_FADE_MS = 1000;                 // 目标色渐变时长 (ms)
const HEADER_FADE_FAST_MS = 400;             // 非闪动场景的渐变时长

// 已加载模型的时间展示阈值等
const GITHUB_URL = "https://github.com/inkbottle-9/comfyui_dynamic";

// 按钮行右侧下拉框 (始终显示占位文本, 不随选择改变)
const QUICK_LINKS = [
    { label: "ComfyUI", url: "https://comfy.org" },
    { label: "ComfyUI Docs", url: "https://docs.comfy.org" },
    { label: "ComfyUI Registry", url: "https://registry.comfy.org" },
    { label: "Comfy-Org (HF)", url: "https://huggingface.co/Comfy-Org" },
    { label: "Hugging Face", url: "https://huggingface.co" },
    { label: "Civitai", url: "https://civitai.com" },
    { label: "Civitai (mirror)", url: "https://civitai.red" },
    { label: "CivArchive", url: "https://civarchive.com" },
    { label: "OpenModelDB", url: "https://openmodeldb.info" },
    { label: "comfyui_dynamic (GitHub)", url: "https://github.com/inkbottle-9/comfyui_dynamic" },
];

// 统计卡片定义 (顺序即展示顺序). pct: 从快照取百分比的取值函数; color: 迷你进度条颜色
const CARDS = [
    { key: "cpu", label: "CPU", color: "#58a6ff", pct: (d) => d.cpu?.percent },
    { key: "ram", label: "RAM", color: "#3fb950", pct: (d) => d.ram?.percent },
    { key: "gpu", label: "GPU", color: "#f85149", pct: (d) => d.devices?.[0]?.gpu_util },
    { key: "vram", label: "VRAM", color: "#d29922", pct: (d) => d.devices?.[0]?.vram_percent },
    { key: "cpu_temp", label: "CPU C", color: "#e36209", pct: (d) => d.cpu?.temp },
    { key: "gpu_temp", label: "GPU C", color: "#bc4c00", pct: (d) => d.devices?.[0]?.temperature },
];

// 折线图系列 (仅百分比类卡片, 温度不画)
const CHART_SERIES = CARDS.filter(c => ["cpu", "ram", "gpu", "vram"].includes(c.key));

// 设置键 (ComfyUI settings id / localStorage 键共用)
const SETTING_RATE = "dynamic.ResourceMonitor.refreshRate";
const SETTING_LANG = "dynamic.ResourceMonitor.language";
const SETTING_ENABLE = "dynamic.ResourceMonitor.enabled";

// 行内图标 (SVG, currentColor 继承按钮颜色, 卸载按钮通过 CSS 置红)
const ICONS = {
    copy: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    open: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8V6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2"/><path d="M3 8h18l-2 11H5L3 8z"/></svg>',
    unload: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M10 11v6M14 11v6"/></svg>',
};


// ============================================================
// i18n (en 为基准键, zh 为翻译表)
// ============================================================

const LANGS = {
    en: {
        title: "Control Panel",
        subtitle: "comfy_dynamic",
        pauseTip: "Pause refreshing",
        playTip: "Resume refreshing",
        resetTip: "Reset size and dock to bottom-left",
        dockTip: "Dock to bottom-left",
        minimizeTip: "Minimize (double-click title)",
        restoreTip: "Restore",
        cleanRam: "Free RAM",
        cleanVram: "Free VRAM",
        aggressive: "All processes",
        aggressiveTip:
            "Also trim working sets of all other processes (may affect running programs)",
        quickLinks: "Quick links",
        localDirs: "Local dirs",
        noDirs: "No registered folders",
        alertTemp: (s) => `High temperature: ${s} C`,
        alertVram: (b) => `VRAM almost full (free ${b})`,
        alertRam: (b) => `RAM almost full (free ${b})`,
        helpTip: "Help / GitHub",
        helpTitle: "Resource Monitor - comfyui_dynamic",
        helpText: [
            "Floating resource monitor from the comfyui_dynamic plugin.",
            "",
            "Cards: usage percent; background/border fade to red above 50%. Temperature cards use 100 C = 100%.",
            "Chart: recent CPU / RAM / GPU / VRAM utilization history.",
            "",
            "Loaded models: green border = currently in use; bottom bar shows model size vs VRAM "
                + "(red = loaded in VRAM, blue = remaining in RAM).",
            "Unloaded models: models released since page load (kept for reference, max 30).",
            "",
            "Header color: red = warning (any temp > 90 C, VRAM nearly full, or RAM free < 10%); "
                + "blue flash = just minimized.",
            "Actions: Free RAM / Free VRAM clean up immediately when idle, or queue for after the current task.",
        ].join("\n"),
        langTip: "UI language",
        rateTip: "Refresh rate (0-10 Hz, 0 = paused)",
        mouseTip: "Mouse position",
        posTip: "Panel position",
        sizeTip: "Panel size",
        statusTip: "Status messages",
        cardTip: {
            cpu: (n) => `CPU utilization - ${n} logical cores`,
            ram: (s) => `System RAM usage - used / total, proc = ComfyUI process RSS`,
            gpu: (n) => `GPU utilization (NVIDIA NVML) - ${n}`,
            vram: (s) => `Primary GPU VRAM usage - used / total`,
            cpu_temp: () => "CPU temperature (100 C = 100%). Windows needs LibreHardwareMonitor running",
            gpu_temp: () => "GPU temperature (100 C = 100%, NVIDIA NVML)",
        },
        unloadAllTip: "Unload ALL loaded models",
        clearUnloadedTip: "Clear unloaded records",
        clearedUnloaded: "Unloaded records cleared",
        unloadedModels: (n) => `Unloaded models (${n})`,
        noUnloaded: "No unloaded records",
        loadedAt: (s) => `Loaded at: ${s}`,
        unloadedAt: (s) => `Unloaded at: ${s}`,
        loadedModels: (n) => `Loaded models (${n})`,
        noModels: "No loaded models",
        copyTip: "Copy full details",
        openTip: "Locate the file in file manager",
        unloadTip: "Unload this model from RAM/VRAM (unavailable while busy)",
        pathUnknown: "(path unknown)",
        location: { vram: "VRAM", partial: "Mixed", ram: "RAM" },
        stateUsed: "in use",
        stateIdle: "idle",
        stateRemoved: "Unloaded",
        detailPath: "Path",
        detailSize: "Size",
        detailLoaded: "Loaded",
        detailPrecision: "Precision",
        detailDevice: "Device",
        detailStatus: "Status",
        vramDesc: (b) => `VRAM ${b}`,
        mixedDesc: (a, b) => `VRAM ${a} / ${b}`,
        ramDesc: (b) => `RAM ${b}`,
        copied: (n) => `Copied: ${n}`,
        copiedFull: "Copied full details",
        freedRam: (b) => `RAM freed: ~${b} (estimated)`,
        freedVram: (b) => `VRAM freed: ~${b} (estimated)`,
        queuedClean: "A task is running; cleanup will run after it finishes",
        cleanRamFail: (m) => `RAM cleanup failed: ${m}`,
        cleanVramFail: (m) => `VRAM cleanup failed: ${m}`,
        busyUnload: "A task is running; cannot unload models now",
        unloaded: (n) => `Unloaded: ${n}`,
        unloadRamTip: "Model resides in RAM; unload not applicable (RAM is freed when the node cache drops it)",
        unloadRamMsg: "Cannot unload: model resides in RAM (memory is freed when the node cache drops it)",
        unloadNotFoundMsg: "Model no longer loaded",
        unloadStillMsg: (b) => b > 0
            ? `Unload incomplete: ~${b} freed but still resident in VRAM`
            : "Unload failed: model still resident in VRAM",
        freeSkippedMsg: (n) => `${n} RAM-resident model(s) skipped`,
        unloadFail: (m) => `Unload failed: ${m}`,
        openNoPath: "No path info for this model",
        openReleased: "Model was released, refresh and retry",
        openFail: (m) => `Open failed: ${m}`,
        unloadReleased: "Model was already released",
        busyUnloadHttp: "A task is running; cannot unload now",
        dirOpened: (p) => `Opened: ${p}`,
        dirOpenFail: (m) => `Open directory failed: ${m}`,
        dirFetchFail: (m) => `List folders failed: ${m}`,
        backendError: "Cannot reach backend monitor service",
        noGpu: "No GPU detected",
        threads: (n) => `${n} threads`,
        proc: (b) => `proc ${b}`,
        util: (p) => `util ${p}%`,
    },
    zh: {
        title: "控制面板",
        subtitle: "comfy_dynamic",
        pauseTip: "暂停刷新",
        playTip: "恢复刷新",
        resetTip: "重置尺寸并停靠到左下角",
        dockTip: "停靠到左下角",
        minimizeTip: "最小化 (可双击标题栏)",
        restoreTip: "还原",
        cleanRam: "清理内存",
        cleanVram: "清理显存",
        aggressive: "全进程",
        aggressiveTip: "内存清理时同时修剪其它进程的工作集 (可能影响其它正在运行的程序)",
        quickLinks: "快速链接",
        localDirs: "本地目录",
        noDirs: "无已登记目录",
        alertTemp: (s) => `温度过高: ${s} C`,
        alertVram: (b) => `显存告急 (剩余 ${b})`,
        alertRam: (b) => `内存告急 (剩余 ${b})`,
        helpTip: "帮助 / GitHub 仓库",
        helpTitle: "资源监控 - comfyui_dynamic",
        helpText: [
            "comfyui_dynamic 插件自带的资源监控浮动面板.",
            "",
            "统计卡片: 占用百分比, 超过 50% 后背景与描边渐变为红色; 温度卡以 100 C = 100%.",
            "折线图: CPU / RAM / GPU / VRAM 利用率的近期历史.",
            "",
            "已加载模型: 绿色边框 = 正在使用; 底部横条显示模型体积与显存的比例 "
                + "(红色 = 已加载进显存, 蓝色 = 仍在内存的部分).",
            "已卸载模型: 页面打开后被释放的模型记录 (最多保留 30 条, 仅供参考).",
            "",
            "标题栏颜色: 红色 = 警告 (任一温度超 90 C / 显存或内存告急); 蓝色闪动 = 刚被最小化.",
            "清理按钮: 队列空闲时立即生效, 任务执行中则延迟到任务结束后自动执行.",
        ].join("\n"),
        langTip: "界面语言",
        rateTip: "刷新率 (0-10 Hz, 0 = 暂停)",
        mouseTip: "鼠标位置",
        posTip: "面板位置",
        sizeTip: "面板尺寸",
        statusTip: "状态消息",
        cardTip: {
            cpu: (n) => `CPU 占用率 - ${n} 逻辑核心`,
            ram: (s) => `系统内存占用 - 已用 / 总量, proc = ComfyUI 进程占用`,
            gpu: (n) => `GPU 利用率 (NVIDIA NVML) - ${n}`,
            vram: (s) => `主显卡显存占用 - 已用 / 总量`,
            cpu_temp: () => "CPU 温度 (100 C = 100%). Windows 下需运行 LibreHardwareMonitor 才能获取",
            gpu_temp: () => "GPU 温度 (100 C = 100%, NVIDIA NVML)",
        },
        unloadAllTip: "卸载全部已加载模型",
        clearUnloadedTip: "清空已卸载记录",
        clearedUnloaded: "已清空卸载记录",
        unloadedModels: (n) => `已卸载模型 (${n})`,
        noUnloaded: "暂无已卸载记录",
        loadedAt: (s) => `加载时间: ${s}`,
        unloadedAt: (s) => `卸载时间: ${s}`,
        loadedModels: (n) => `已加载模型 (${n})`,
        noModels: "暂无已加载模型",
        copyTip: "复制完整信息",
        openTip: "在文件管理器中定位该文件",
        unloadTip: "从内存/显存中卸载该模型 (任务执行中不可用)",
        pathUnknown: "(路径未知)",
        location: { vram: "显存", partial: "混合", ram: "内存" },
        stateUsed: "使用中",
        stateIdle: "空闲",
        stateRemoved: "已卸载",
        detailPath: "路径",
        detailSize: "体积",
        detailLoaded: "已加载",
        detailPrecision: "精度",
        detailDevice: "设备",
        detailStatus: "状态",
        vramDesc: (b) => `显存 ${b}`,
        mixedDesc: (a, b) => `显存 ${a} / ${b}`,
        ramDesc: (b) => `内存 ${b}`,
        copied: (n) => `已复制: ${n}`,
        copiedFull: "已复制完整信息",
        freedRam: (b) => `已清理内存, 释放约 ${b} (估算)`,
        freedVram: (b) => `已清理显存, 释放约 ${b} (估算)`,
        queuedClean: "有任务正在执行, 将在任务结束后自动清理",
        cleanRamFail: (m) => `内存清理失败: ${m}`,
        cleanVramFail: (m) => `显存清理失败: ${m}`,
        busyUnload: "有任务正在执行, 暂不能卸载模型",
        unloaded: (n) => `已卸载: ${n}`,
        unloadRamTip: "模型常驻内存, 无需卸载 (内存将在节点缓存淘汰该模型时释放)",
        unloadRamMsg: "无法卸载: 模型常驻内存 (内存将在节点缓存淘汰该模型时释放)",
        unloadNotFoundMsg: "模型已不在加载列表中",
        unloadStillMsg: (b) => b > 0
            ? `卸载不完整: 已释放约 ${b}, 但仍有部分驻留显存`
            : "卸载失败: 模型仍驻留显存",
        freeSkippedMsg: (n) => `${n} 个常驻内存的模型未受影响`,
        unloadFail: (m) => `卸载失败: ${m}`,
        openNoPath: "该模型没有路径信息",
        openReleased: "模型已被释放, 请刷新后再试",
        openFail: (m) => `打开失败: ${m}`,
        unloadReleased: "模型已被释放",
        busyUnloadHttp: "有任务正在执行, 暂不能卸载",
        dirOpened: (p) => `已打开: ${p}`,
        dirOpenFail: (m) => `打开目录失败: ${m}`,
        dirFetchFail: (m) => `获取目录列表失败: ${m}`,
        backendError: "无法连接后端监控服务",
        noGpu: "未检测到 GPU",
        threads: (n) => `${n} 线程`,
        proc: (b) => `进程 ${b}`,
        util: (p) => `利用率 ${p}%`,
    },
};


// ============================================================
// 通用工具
// ============================================================

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function round1(v) {
    return (typeof v === "number" && isFinite(v)) ? Math.round(v * 10) / 10 : null;
}

function sampleFmt(v) {
    const r = round1(v);
    return r != null ? r : "-";
}

function fmtBytes(n) {
    if (typeof n !== "number" || !isFinite(n) || n < 0)
        return "-";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = n, i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
    return `${v.toFixed(digits)} ${units[i]}`;
}

// epoch 秒 -> 本地 HH:MM:SS.mmm
function fmtClock(epochSec) {
    if (typeof epochSec !== "number" || !isFinite(epochSec) || epochSec <= 0)
        return "-";
    const d = new Date(epochSec * 1000);
    const p2 = (n) => String(n).padStart(2, "0");
    return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
        + `.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function escapeHtml(text) {
    return String(text ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

// 颜色线性混合: [r, g, b] 数组按 t (0-1) 从 a 混到 b, 返回 rgb() 字符串
function mixColor(a, b, t) {
    const ch = (i) => Math.round(a[i] + (b[i] - a[i]) * t);
    return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}

// 剪贴板写入, 优先 clipboard API, 失败时退回 execCommand (兼容非安全上下文)
async function copyText(text, onOk, onErr) {
    try {
        await navigator.clipboard.writeText(text);
        onOk?.();
    } catch {
        try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            ta.remove();
            onOk?.();
        } catch {
            onErr?.();
        }
    }
}


// ============================================================
// 设置读写 (ComfyUI settings 优先, localStorage 兜底)
// ============================================================

function getSetting(key, fallback) {
    try {
        const v = app.extensionManager?.setting?.get?.(key);
        if (v !== undefined && v !== null)
            return v;
    } catch {
        // settings API 不可用时走 localStorage
    }
    try {
        const raw = localStorage.getItem(key);
        if (raw !== null)
            return JSON.parse(raw);
    } catch {
        // 忽略解析失败
    }
    return fallback;
}

function setSetting(key, value) {
    try {
        app.extensionManager?.setting?.set?.(key, value);
    } catch {
        // settings API 不可用时走 localStorage
    }
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // 忽略
    }
}


// ============================================================
// API 访问
// ============================================================

async function fetchStats() {
    const res = await fetch(`${API_BASE}/stats`);
    if (!res.ok)
        throw new Error(`http ${res.status}`);
    const data = await res.json();
    if (data.error)
        throw new Error(data.error);
    return data;
}

async function postJSON(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
    });
    let data = {};
    try {
        data = await res.json();
    } catch {
        // 无响应体的错误状态
    }
    if (!res.ok) {
        const err = new Error(data.error || `http ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return data;
}


// ============================================================
// 样式注入 (全插件仅一份)
// ============================================================

const CSS = `
.dynmon-panel { position: fixed; bottom: 10px; right: 10px; width: 380px; height: 560px;
    min-width: 280px; min-height: 120px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px);
    display: flex; flex-direction: column;
    background: #1e1e1e; border: 1px solid #444; border-radius: 8px; overflow: hidden;
    box-shadow: 0 4px 12px rgba(0, 0, 0, .5); z-index: 99990; resize: both;
    color: #d4d4d4; font-family: sans-serif; font-size: 12px; user-select: none; }
.dynmon-panel.dynmon-min { min-width: 0; min-height: 0; max-width: none; max-height: none;
    width: auto !important; height: auto !important; resize: none; }
.dynmon-header { display: flex; align-items: center; gap: 8px; padding: 6px 10px;
    background: #2a2a2a; border-bottom: 1px solid #444; cursor: move; flex: none; white-space: nowrap; }
.dynmon-title { font-weight: 600; font-size: 12px; }
.dynmon-subtitle { font-size: 10px; color: #777; }
.dynmon-min .dynmon-subtitle { display: none; }
.dynmon-alert { font-size: 10px; color: #ff6b6b; overflow: hidden; text-overflow: ellipsis; }
.dynmon-min .dynmon-alert { display: none; }
.dynmon-hbtn { background: transparent; border: none; color: #888; cursor: pointer;
    font-size: 13px; line-height: 1; padding: 2px 4px; }
.dynmon-hbtn:hover { color: #fff; }
.dynmon-hbtns { display: flex; align-items: center; gap: 2px; }
.dynmon-hspring { flex: 1; }
.dynmon-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }
.dynmon-cards { flex: none; display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; padding: 8px 8px 0; }
.dynmon-card { background: #232323; border: 1px solid #383838; border-radius: 6px; padding: 5px 7px; min-width: 0;
    transition: background-color .25s linear, border-color .25s linear; }
.dynmon-card-label { font-size: 9px; color: #888; letter-spacing: .3px; }
.dynmon-card-value { font-size: 13px; font-weight: 600; margin: 2px 0; }
.dynmon-card-sub { font-size: 9px; color: #777; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dynmon-bar { height: 3px; background: #3a3a3a; border-radius: 2px; margin-top: 4px; overflow: hidden; }
.dynmon-bar > i { display: block; height: 100%; width: 0%; transition: width .2s; }
.dynmon-devices { flex: none; padding: 4px 10px 0; font-size: 10px; color: #777; }
.dynmon-devices > div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dynmon-chartwrap { flex: none; padding: 8px 8px 0; }
.dynmon-chartwrap canvas { width: 100%; height: 140px; display: block; background: #1b1b1b; border: 1px solid #333; border-radius: 6px; }
.dynmon-legend { flex: none; display: flex; gap: 10px; padding: 4px 10px 0; font-size: 10px; color: #999; flex-wrap: wrap; }
.dynmon-legend .dynmon-dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
.dynmon-actions { flex: none; display: flex; align-items: center; gap: 6px; padding: 6px 8px; flex-wrap: wrap; }
.dynmon-actions button, .dynmon-select { background: #2d2d2d; color: #d4d4d4; border: 1px solid #444; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; outline: none; }
.dynmon-actions button:hover { background: #3a3a3a; border-color: #555; }
.dynmon-aggr { display: inline-flex; align-items: center; gap: 3px; font-size: 10px; color: #888; cursor: pointer; }
.dynmon-actions-right { margin-left: auto; display: inline-flex; gap: 6px; }
.dynmon-select { max-width: 120px; }
.dynmon-models { padding: 0 8px 8px; }
.dynmon-loaded-sec { flex: 1 1 auto; min-height: 60px; display: flex; flex-direction: column; }
.dynmon-unloaded-sec { flex: none; max-height: 45%; display: flex; flex-direction: column; }
.dynmon-sec-head { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #999; padding: 2px; cursor: pointer; }
.dynmon-sec-head:hover { color: #ccc; }
.dynmon-chev { font-size: 9px; width: 10px; display: inline-block; transition: transform .15s; }
.dynmon-sec-collapsed .dynmon-chev { transform: rotate(-90deg); }
.dynmon-sec-collapsed .dynmon-list { display: none; }
.dynmon-sec-btn { background: transparent; color: #f87272; border: 1px solid #6e2b2b; border-radius: 4px;
    width: 22px; height: 20px; display: inline-flex; align-items: center; justify-content: center;
    cursor: pointer; padding: 0; margin-left: auto; }
.dynmon-sec-btn:hover { color: #ff9b9b; border-color: #a04040; }
.dynmon-list { display: flex; flex-direction: column; gap: 4px; }
.dynmon-loaded-sec .dynmon-list { flex: 1 1 auto; overflow-y: auto; min-height: 40px; }
.dynmon-row { border: 1px solid #383838; border-radius: 6px; padding: 5px 8px; cursor: copy; flex: none;
    transition: background-color .2s linear, border-color .2s linear; }
.dynmon-row:hover { border-color: #4a6ea9; }
.dynmon-row-top { display: flex; align-items: center; gap: 5px; min-width: 0; }
.dynmon-loc { font-size: 9px; padding: 1px 5px; border-radius: 3px; flex: none; }
.dynmon-loc-vram { background: #4a3b12; color: #d29922; }
.dynmon-loc-ram { background: #12331c; color: #3fb950; }
.dynmon-loc-partial { background: #14314a; color: #58a6ff; }
.dynmon-loc-removed { background: #262626; color: #777; }
.dynmon-class { font-size: 9px; padding: 1px 5px; border-radius: 3px; background: rgba(45, 58, 77, .8); color: #9ec1e8; flex: none; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dynmon-fname { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: #e0e0e0; }
.dynmon-fname-unknown { color: #777; font-style: italic; }
.dynmon-size { flex: none; font-size: 10px; color: #999; }
.dynmon-vbar { height: 4px; border-radius: 2px; background: #1b1b1b; margin-top: 4px; overflow: hidden; display: flex; }
.dynmon-vbar > i { display: block; height: 100%; }
.dynmon-row-bottom { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.dynmon-sub { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; color: #888; }
.dynmon-time { flex: none; font-size: 9px; color: #666; font-variant-numeric: tabular-nums; }
.dynmon-row-btns { display: flex; gap: 4px; flex: none; }
.dynmon-row-btns button { background: transparent; color: #999; border: 1px solid #444; border-radius: 4px;
    width: 22px; height: 20px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
.dynmon-row-btns button:hover { color: #fff; border-color: #666; }
.dynmon-row-btns button[data-act="unload"] { color: #f87272; border-color: #6e2b2b; }
.dynmon-row-btns button[data-act="unload"]:hover { color: #ff9b9b; border-color: #a04040; }
.dynmon-row-btns button:disabled { opacity: .35; cursor: not-allowed; }
.dynmon-row-btns button:disabled:hover { color: #999; border-color: #444; }
.dynmon-row-btns button:disabled[data-act="unload"]:hover { color: #f87272; border-color: #6e2b2b; }
.dynmon-busy .dynmon-row-btns button[data-act="unload"] { opacity: .35; }
.dynmon-empty { font-size: 11px; color: #666; text-align: center; padding: 10px; }
.dynmon-tooltip { position: fixed; z-index: 99999; background: #1a1a1a; border: 1px solid #4a6ea9; color: #ddd; font-size: 11px; line-height: 1.5; padding: 8px 10px; border-radius: 6px; pointer-events: none; white-space: pre-wrap; word-break: break-all; overflow-wrap: anywhere; display: none; min-width: 120px; max-width: 480px; box-shadow: 0 4px 16px rgba(0, 0, 0, .5); }
.dynmon-statusbar { display: flex; align-items: stretch; flex: none; font-size: 10px; color: #888;
    border-top: 1px solid #383838; background: #232323; white-space: nowrap; }
.dynmon-sb-item { display: flex; align-items: center; gap: 4px; padding: 4px 8px; border-left: 1px solid #333; min-width: 0; }
.dynmon-sb-item:first-child { border-left: none; }
.dynmon-sb-spring { flex: 1 1 auto; overflow: hidden; }
.dynmon-status { color: #7aa2f7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dynmon-status.dynmon-status-err { color: #f87171; }
.dynmon-lang { background: #2d2d2d; color: #bbb; border: 1px solid #444; border-radius: 3px; font-size: 10px; padding: 1px 2px; cursor: pointer; outline: none; }
.dynmon-rate-btn { background: #2d2d2d; color: #bbb; border: 1px solid #444; border-radius: 3px; width: 16px; height: 16px; line-height: 1; font-size: 11px; cursor: pointer; padding: 0; }
.dynmon-rate-btn:hover { color: #fff; background: #3a3a3a; }
.dynmon-rate-input { width: 30px; background: #1e1e1e; color: #d4d4d4; border: 1px solid #444; border-radius: 3px; font-size: 10px; text-align: center; padding: 1px 0; outline: none; }
.dynmon-rate-input::-webkit-inner-spin-button, .dynmon-rate-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.dynmon-rate-input { -moz-appearance: textfield; appearance: textfield; }
.dynmon-sb-val { color: #aaa; }
.dynmon-panel:not(.dynmon-min) .dynmon-resize-hint { position: absolute; right: 0; bottom: 0; width: 14px; height: 14px; cursor: nwse-resize; }
`;

function injectStyle() {
    if (document.getElementById("dynmon-style"))
        return;
    const style = document.createElement("style");
    style.id = "dynmon-style";
    style.textContent = CSS;
    document.head.appendChild(style);
}


// ============================================================
// 模型信息文本
// ============================================================

function buildLoadedDesc(m, t) {
    const pct = m.size > 0 ? Math.round((m.loaded / m.size) * 100) : 0;
    if (m.location === "vram")
        return t.vramDesc(`${fmtBytes(m.loaded)} (${pct}%)`);
    if (m.location === "partial")
        return t.mixedDesc(`${fmtBytes(m.loaded)}`, `${fmtBytes(m.size)} (${pct}%)`);
    return t.ramDesc(fmtBytes(m.size));
}

function buildSubLine(m, t) {
    return `${m.dtype} · ${m.device} · ${buildLoadedDesc(m, t)} · ${m.used ? t.stateUsed : t.stateIdle}`;
}

// 弹窗分隔线 (提高可读性, 每个可换行信息块之间)
const TIP_DIVIDER = "--------------------------------";

function buildDetailText(m, t, isRemoved = false) {
    const pct = m.size > 0 ? Math.round((m.loaded / m.size) * 100) : 0;
    const lines = [`${m.class}${m.filename ? ` - ${m.filename}` : ""}`];
    if (m.path)
        lines.push(`${t.detailPath}: ${m.path}`);
    else
        lines.push(`${t.detailPath}: unknown`);
    lines.push(TIP_DIVIDER);
    if (isRemoved) {
        // 已卸载: 状态相关字段统一置空语义
        lines.push(
            `${t.detailSize}: ${fmtBytes(m.size)} (${m.size} bytes)`,
            `${t.detailLoaded}: 0 / ${fmtBytes(m.size)} (0%)`,
            `${t.detailPrecision}: ${m.dtype}`,
            `${t.detailDevice}: None (${t.stateRemoved})`,
        );
    } else {
        const loc = t.location[m.location] || m.location;
        lines.push(
            `${t.detailSize}: ${fmtBytes(m.size)} (${m.size} bytes)`,
            `${t.detailLoaded}: ${fmtBytes(m.loaded)} / ${fmtBytes(m.size)} (${pct}%)`,
            `${t.detailPrecision}: ${m.dtype}`,
            `${t.detailDevice}: ${m.device} (${loc})`,
            `${t.detailStatus}: ${loc}${m.used ? `, ${t.stateUsed}` : `, ${t.stateIdle}`}`,
        );
    }
    lines.push(TIP_DIVIDER, `UUID: ${m.uuid}`);
    return lines.join("\n");
}


// ============================================================
// 浮动监控面板 (单例)
// ============================================================

class MonitorPanel {
    constructor() {
        this.lang = getSetting(SETTING_LANG, DEFAULT_LANG) === "zh" ? "zh" : "en";
        this.rate = clamp(parseInt(getSetting(SETTING_RATE, DEFAULT_RATE), 10) || 0, 0, 10);
        this.paused = this.rate === 0; // 初始刷新率为 0 时视为暂停态
        this.enabled = true;
        this.lastUpdated = -1e9;
        this.history = [];       // 折线图历史: { cpu, ram, gpu, vram }
        this.busy = false;
        this.lastCpuCores = null; // 卡片 tooltip 用的最近元信息
        this.lastGpuName = "";
        this.modelByUuid = new Map();
        this.rowByUuid = new Map();
        this.modelsSignature = null;
        this.errorShown = false;
        this.statusTimer = null;
        this.savedSize = null;   // 最小化前的尺寸 { w, h }
        this.autoMinimized = false; // 是否因对话框弹出而自动最小化 (关闭时自动还原)
        this.positioned = false; // 是否已用 left/top 定位 (初始用 right/bottom 锚定)
        this.mouseRaf = false;   // 鼠标坐标 rAF 节流标志
        this.dirsLoaded = false; // 本地目录下拉是否已拉取
        this.primaryVram = 0;    // 主设备显存总量 (模型体积条的比例基准)
        this.alertReasons = [];  // 当前警告原因列表 (标题栏红色 + 次标题)
        this.unloadedByUuid = new Map(); // 已卸载记录 (uuid -> 条目)
        this.unRowByUuid = new Map();    // 已卸载列表行 (uuid -> row)
        // 签名初值用 null 而非 "": 保证首次快照为空列表时也执行一次占位符渲染
        this.unloadedSignature = null;

        // 标题栏颜色状态机: 调用方只通过 hdrFrom/hdrTarget 描述目标色, 渐变由统一循环插值
        // (State + Tween 模式: 目标值发布与渲染解耦, 单一 ticker 消费目标状态)
        this.hdrFrom = HEADER_DEFAULT.slice();
        this.hdrCur = HEADER_DEFAULT.slice();
        this.hdrTarget = HEADER_DEFAULT.slice();
        this.hdrTargetAt = performance.now();
        this.hdrMinAt = -1e9; // 上次最小化时刻 (蓝色闪动窗口判定用)

        injectStyle();
        this.buildDom();
        this.bindEvents();
        this.applyI18n();
        this.syncRateDisplay();
        this.initHeaderFx();
    }

    t(key, ...args) {
        const table = LANGS[this.lang] || LANGS.en;
        const v = table[key] ?? LANGS.en[key] ?? key;
        return typeof v === "function" ? v(...args) : v;
    }

    // ---------- DOM 构建 ----------

    buildDom() {
        const panel = (this.panel = document.createElement("div"));
        panel.className = "dynmon-panel";
        panel.innerHTML = `
            <div class="dynmon-header">
                <span class="dynmon-title"></span>
                <span class="dynmon-subtitle"></span>
                <span class="dynmon-alert"></span>
                <span class="dynmon-hspring"></span>
                <span class="dynmon-hbtns">
                    <button class="dynmon-hbtn" data-hact="help" title="">?</button>
                    <button class="dynmon-hbtn" data-hact="pause" title=""></button>
                    <button class="dynmon-hbtn" data-hact="reset" title="">↺</button>
                    <button class="dynmon-hbtn" data-hact="dock" title="">↙</button>
                    <button class="dynmon-hbtn" data-hact="min" title="">–</button>
                </span>
            </div>
            <div class="dynmon-content">
                <div class="dynmon-cards"></div>
                <div class="dynmon-devices"></div>
                <div class="dynmon-chartwrap"><canvas></canvas></div>
                <div class="dynmon-legend"></div>
                <div class="dynmon-actions">
                    <button data-act="clean-ram"></button>
                    <button data-act="clean-vram"></button>
                    <label class="dynmon-aggr"><input type="checkbox"> <span class="dynmon-aggr-label"></span></label>
                    <span class="dynmon-actions-right">
                        <select class="dynmon-select dynmon-links"></select>
                        <select class="dynmon-select dynmon-dirs"></select>
                    </span>
                </div>
                <div class="dynmon-models dynmon-loaded-sec">
                    <div class="dynmon-sec-head" data-sec="loaded">
                        <span class="dynmon-chev">▼</span>
                        <span class="dynmon-count"></span>
                        <button class="dynmon-sec-btn" data-act="unload-all"></button>
                    </div>
                    <div class="dynmon-list dynmon-list-loaded"></div>
                </div>
                <div class="dynmon-models dynmon-unloaded-sec dynmon-sec-collapsed">
                    <div class="dynmon-sec-head" data-sec="unloaded">
                        <span class="dynmon-chev">▼</span>
                        <span class="dynmon-count-unloaded"></span>
                        <button class="dynmon-sec-btn" data-act="clear-unloaded"></button>
                    </div>
                    <div class="dynmon-list dynmon-list-unloaded"></div>
                </div>
            </div>
            <div class="dynmon-statusbar">
                <div class="dynmon-sb-item">
                    <select class="dynmon-lang" title="Language / 语言">
                        <option value="en">EN</option>
                        <option value="zh">中文</option>
                    </select>
                </div>
                <div class="dynmon-sb-item dynmon-rate-group">
                    <button class="dynmon-rate-btn" data-rate="-1">-</button>
                    <button class="dynmon-rate-btn" data-rate="1">+</button>
                    <input class="dynmon-rate-input" type="number" min="0" max="10" step="1">
                    <span>Hz</span>
                </div>
                <div class="dynmon-sb-item dynmon-sb-spring"><span class="dynmon-status"></span></div>
                <div class="dynmon-sb-item"><span class="dynmon-mouse dynmon-sb-val">(0, 0)</span></div>
                <div class="dynmon-sb-item"><span class="dynmon-pos dynmon-sb-val">(0, 0)</span></div>
                <div class="dynmon-sb-item"><span class="dynmon-psize dynmon-sb-val">0x0</span></div>
            </div>
            <div class="dynmon-tooltip"></div>
            <div class="dynmon-resize-hint"></div>
        `;
        document.body.appendChild(panel);

        // 统计卡片 (6 张, 含温度卡)
        this.cardRefs = {};
        const cardsEl = panel.querySelector(".dynmon-cards");
        for (const c of CARDS) {
            const card = document.createElement("div");
            card.className = "dynmon-card";
            card.innerHTML = `
                <div class="dynmon-card-label">${c.label}</div>
                <div class="dynmon-card-value">-</div>
                <div class="dynmon-card-sub"></div>
                <div class="dynmon-bar"><i style="background: ${c.color}"></i></div>
            `;
            cardsEl.appendChild(card);
            this.cardRefs[c.key] = {
                el: card,
                value: card.querySelector(".dynmon-card-value"),
                sub: card.querySelector(".dynmon-card-sub"),
                bar: card.querySelector(".dynmon-bar > i"),
            };
        }

        // 图例 (仅系列色与名称, 不显示百分比)
        this.legendRefs = {};
        const legendEl = panel.querySelector(".dynmon-legend");
        for (const s of CHART_SERIES) {
            const item = document.createElement("span");
            item.innerHTML = `<span class="dynmon-dot" style="background: ${s.color}"></span>${s.label}`;
            legendEl.appendChild(item);
        }

        this.titleEl = panel.querySelector(".dynmon-title");
        this.subtitleEl = panel.querySelector(".dynmon-subtitle");
        this.alertEl = panel.querySelector(".dynmon-alert");
        this.headerEl = panel.querySelector(".dynmon-header");
        // 下拉框占位项: 始终显示为选中文本, 不随选择改变
        this.linksSelect = panel.querySelector(".dynmon-links");
        this.dirsSelect = panel.querySelector(".dynmon-dirs");
        const linkPh = document.createElement("option");
        linkPh.value = "";
        this.linksSelect.appendChild(linkPh);
        const dirPh = document.createElement("option");
        dirPh.value = "";
        this.dirsSelect.appendChild(dirPh);
        this.populateQuickLinks();
        this.pauseBtn = panel.querySelector('[data-hact="pause"]');
        this.helpBtn = panel.querySelector('[data-hact="help"]');
        this.resetBtn = panel.querySelector('[data-hact="reset"]');
        this.dockBtn = panel.querySelector('[data-hact="dock"]');
        this.minBtn = panel.querySelector('[data-hact="min"]');
        this.ramBtn = panel.querySelector('[data-act="clean-ram"]');
        this.vramBtn = panel.querySelector('[data-act="clean-vram"]');
        this.aggrLabel = panel.querySelector(".dynmon-aggr-label");
        this.contentEl = panel.querySelector(".dynmon-content");
        this.devicesEl = panel.querySelector(".dynmon-devices");
        this.canvas = panel.querySelector("canvas");
        this.ctx = this.canvas.getContext("2d");
        this.statusEl = panel.querySelector(".dynmon-status");
        this.aggrCheckbox = panel.querySelector(".dynmon-aggr input");
        this.countEl = panel.querySelector(".dynmon-count");
        this.countUnloadedEl = panel.querySelector(".dynmon-count-unloaded");
        this.listEl = panel.querySelector(".dynmon-list-loaded");
        this.listUnloadedEl = panel.querySelector(".dynmon-list-unloaded");
        this.loadedSecEl = panel.querySelector(".dynmon-loaded-sec");
        this.unloadedSecEl = panel.querySelector(".dynmon-unloaded-sec");
        this.unloadAllBtn = panel.querySelector('[data-act="unload-all"]');
        this.clearUnloadedBtn = panel.querySelector('[data-act="clear-unloaded"]');
        this.tipEl = panel.querySelector(".dynmon-tooltip");
        this.tipVisible = false;
        this.langSelect = panel.querySelector(".dynmon-lang");
        this.rateInput = panel.querySelector(".dynmon-rate-input");
        this.rateGroupEl = panel.querySelector(".dynmon-rate-group");
        this.mouseEl = panel.querySelector(".dynmon-mouse");
        this.posEl = panel.querySelector(".dynmon-pos");
        this.sizeEl = panel.querySelector(".dynmon-psize");

        this.emptyEl = document.createElement("div");
        this.emptyEl.className = "dynmon-empty";
        this.emptyUnloadedEl = document.createElement("div");
        this.emptyUnloadedEl.className = "dynmon-empty";

        // 卡片工具提示文案函数 (applyI18n 时按当前语言解析).
        // 注意: cardTip 是 { 子键: 函数 } 的二级结构, 不能走单层 t(), 需先取子表再调用.
        const tipTable = () => (LANGS[this.lang] || LANGS.en).cardTip;
        this.cardTipFns = {
            cpu: () => tipTable().cpu(this.lastCpuCores ?? "-"),
            ram: () => tipTable().ram(),
            gpu: () => tipTable().gpu(this.lastGpuName ?? ""),
            vram: () => tipTable().vram(),
            cpu_temp: () => tipTable().cpu_temp(),
            gpu_temp: () => tipTable().gpu_temp(),
        };

        // 面板尺寸变化时: 重绘图表 + 刷新尺寸标签
        if (typeof ResizeObserver !== "undefined") {
            this.resizeObserver = new ResizeObserver(() => {
                this.drawChart();
                this.updatePosSizeLabels();
            });
            this.resizeObserver.observe(panel);
        }
    }

    bindEvents() {
        // 标题栏按钮: 帮助 / 暂停 / 重置 / 停靠 / 最小化
        this.panel.addEventListener("click", (e) => {
            const btn = e.target.closest(".dynmon-hbtn[data-hact]");
            if (!btn)
                return;
            e.stopPropagation();
            const act = btn.dataset.hact;
            if (act === "help")
                window.open(GITHUB_URL, "_blank", "noopener");
            else if (act === "pause")
                this.togglePause();
            else if (act === "reset")
                this.resetLayout();
            else if (act === "dock")
                this.dockBottomLeft();
            else if (act === "min")
                this.setMinimized(!this.minimized);
        });

        // 帮助按钮悬浮: 显示面板说明 (复用全局 tooltip 元素)
        this.helpBtn.addEventListener("mouseenter", (e) => {
            this.tipEl.textContent = this.t("helpText");
            this.tipEl.style.display = "block";
            this.tipVisible = true;
            this.positionTip(e);
        });
        this.helpBtn.addEventListener("mouseleave", () => this.hideTip());

        // 双击标题栏 = 最小化/复原
        this.headerEl.addEventListener("dblclick", (e) => {
            if (e.target.closest(".dynmon-hbtn"))
                return;
            this.setMinimized(!this.minimized);
        });

        // 标题栏拖动 (限制以标题栏为准: 标题栏始终完整留在窗口内, 主体允许超出)
        let dragX = 0, dragY = 0, dragging = false;
        this.headerEl.addEventListener("pointerdown", (e) => {
            if (e.target.closest(".dynmon-hbtn"))
                return;
            dragging = true;
            dragX = e.clientX - this.panel.offsetLeft;
            dragY = e.clientY - this.panel.offsetTop;
            const onMove = (ev) => {
                if (!dragging)
                    return;
                this.positioned = true;
                this.panel.style.left = `${ev.clientX - dragX}px`;
                this.panel.style.top = `${ev.clientY - dragY}px`;
                this.panel.style.right = "auto";
                this.panel.style.bottom = "auto";
                this.clampHeaderIntoWindow();
            };
            const onUp = () => {
                dragging = false;
                document.removeEventListener("pointermove", onMove);
                document.removeEventListener("pointerup", onUp);
                this.updatePosSizeLabels();
            };
            document.addEventListener("pointermove", onMove);
            document.addEventListener("pointerup", onUp);
        });

        // 浏览器窗口缩放时强制贴边
        window.addEventListener("resize", () => {
            this.clampHeaderIntoWindow();
            this.updatePosSizeLabels();
        });

        // 全局鼠标坐标 (rAF 节流)
        window.addEventListener("mousemove", (e) => {
            if (this.mouseRaf)
                return;
            this.mouseRaf = true;
            requestAnimationFrame(() => {
                this.mouseRaf = false;
                this.mouseEl.textContent = `(${e.clientX}, ${e.clientY})`;
            });
        });

        // 内容区: 清理按钮 / 列表区按钮 / 下拉框 / 模型行动作
        this.contentEl.addEventListener("click", (e) => {
            const cleanBtn = e.target.closest(".dynmon-actions button[data-act]");
            if (cleanBtn) {
                this.handleCleanAction(cleanBtn.dataset.act);
                return;
            }
            // 列表标题行的操作按钮 (卸载全部 / 清空已卸载记录)
            const secBtn = e.target.closest(".dynmon-sec-btn[data-act]");
            if (secBtn) {
                e.stopPropagation();
                this.handleSectionAction(secBtn.dataset.act);
                return;
            }
            // 列表标题行其它区域点击 = 折叠 / 展开 (阻止冒泡, 避免触发行复制等逻辑)
            const head = e.target.closest(".dynmon-sec-head[data-sec]");
            if (head) {
                e.stopPropagation();
                head.parentElement.classList.toggle("dynmon-sec-collapsed");
                return;
            }
            const row = e.target.closest(".dynmon-row");
            if (!row)
                return;
            const btn = e.target.closest("button[data-act]");
            if (btn) {
                this.handleModelAction(btn.dataset.act, row.dataset.uuid);
                return;
            }
            const m = this.modelByUuid.get(row.dataset.uuid)
                || this.unloadedByUuid.get(row.dataset.uuid);
            if (m) {
                const name = m.filename || m.class || m.uuid;
                copyText(name, () => this.flash(this.t("copied", name)));
            }
        });

        // 快捷链接下拉: 占位文本恒定, 选中即新标签页打开并复位
        this.linksSelect.addEventListener("change", () => {
            const url = this.linksSelect.value;
            this.linksSelect.selectedIndex = 0;
            if (url)
                window.open(url, "_blank", "noopener");
        });

        // 本地目录下拉: 首次展开时拉取, 选中即请求后端打开并复位
        this.dirsSelect.addEventListener("focus", () => this.ensureDirsLoaded());
        this.dirsSelect.addEventListener("change", async () => {
            const path = this.dirsSelect.value;
            this.dirsSelect.selectedIndex = 0;
            if (!path)
                return;
            try {
                const r = await postJSON("/folders/open", { path });
                this.flash(this.t("dirOpened", r.path || path));
            } catch (e) {
                this.flash(this.t("dirOpenFail", e.message), true);
            }
        });

        // 模型行 tooltip (跟随鼠标的自定义提示框)
        this.contentEl.addEventListener("mouseover", (e) => {
            const row = e.target.closest(".dynmon-row");
            if (row?.dataset.tip) {
                this.tipEl.textContent = row.dataset.tip;
                this.tipEl.style.display = "block";
                this.tipVisible = true;
                this.tipRow = row; // 记录关联行, 行被移除时用于联动隐藏
                this.positionTip(e);
            }
        });
        this.contentEl.addEventListener("mousemove", (e) => {
            if (this.tipVisible)
                this.positionTip(e);
        });
        this.contentEl.addEventListener("mouseout", (e) => {
            // 仅当真正离开所在行时才隐藏 (行内子元素间移动不闪烁)
            const row = e.target.closest(".dynmon-row");
            if (row && !row.contains(e.relatedTarget))
                this.hideTip();
        });

        // 语言切换
        this.langSelect.value = this.lang;
        this.langSelect.addEventListener("change", () => {
            this.lang = this.langSelect.value === "zh" ? "zh" : "en";
            setSetting(SETTING_LANG, this.lang);
            this.applyI18n();
        });

        // 刷新率: +/- 按钮与直接输入 (暂停态点 + 解除暂停并置 1)
        this.panel.querySelectorAll(".dynmon-rate-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const delta = parseInt(btn.dataset.rate, 10);
                if (this.paused && delta > 0) {
                    this.paused = false;
                    this.setRate(1);
                    this.syncPauseButton();
                    return;
                }
                this.setRate(this.rate + delta);
            });
        });
        this.rateInput.addEventListener("change", () => {
            const v = parseInt(this.rateInput.value, 10);
            if (this.paused && v > 0) {
                this.paused = false;
                this.syncPauseButton();
            }
            this.setRate(v);
        });
    }

    // ---------- 布局: 夹取 / 重置 / 停靠 / 最小化 ----------

    // 将标题栏 (最小化时即整个面板) 夹取在窗口范围内; 主体允许超出窗口底部/右侧
    clampHeaderIntoWindow() {
        if (!this.positioned)
            return; // 初始 right/bottom 锚定状态由 CSS max-* 约束
        const header = this.minimized ? this.panel : this.headerEl;
        const w = header.offsetWidth;
        const h = header.offsetHeight;
        const left = clamp(this.panel.offsetLeft, EDGE, window.innerWidth - w - EDGE);
        const top = clamp(this.panel.offsetTop, EDGE, window.innerHeight - h - EDGE);
        this.panel.style.left = `${left}px`;
        this.panel.style.top = `${top}px`;
    }

    // 重置 = 恢复默认尺寸 + 停靠左下角 (与停靠按钮同一效果)
    resetLayout() {
        if (this.minimized)
            this.setMinimized(false);
        this.panel.style.width = `${DEFAULT_W}px`;
        this.panel.style.height = `${DEFAULT_H}px`;
        this.dockBottomLeft();
    }

    // 停靠到左下角: 整个面板主体可见, 左边距避开 ComfyUI 左侧栏
    dockBottomLeft() {
        if (this.minimized)
            this.setMinimized(false);
        this.positioned = true;
        const sidebar = this.detectLeftSidebarWidth();
        const w = this.panel.offsetWidth;
        const h = this.panel.offsetHeight;
        this.panel.style.right = "auto";
        this.panel.style.bottom = "auto";
        this.panel.style.left = `${sidebar + EDGE}px`;
        this.panel.style.top = `${Math.max(EDGE, window.innerHeight - h - DOCK_MARGIN)}px`;
        this.updatePosSizeLabels();
    }

    // 探测 ComfyUI 左侧边栏宽度, 探测失败用兜底值 (避免遮挡)
    detectLeftSidebarWidth() {
        const sels = [".comfyui-body-left", ".comfy-sidebar", "#side-toolbar"];
        for (const sel of sels) {
            try {
                const el = document.querySelector(sel);
                if (el) {
                    const rect = el.getBoundingClientRect();
                    // 仅统计贴附在窗口左缘且可见的元素
                    if (rect.width > 8 && rect.left <= 2 && rect.height > 100)
                        return rect.width;
                }
            } catch {
                continue;
            }
        }
        return FALLBACK_SIDEBAR;
    }

    setMinimized(target) {
        if (this.minimized === target)
            return;
        this.minimized = target;
        const panel = this.panel;
        if (target) {
            this.savedSize = { w: panel.offsetWidth, h: panel.offsetHeight };
            panel.classList.add("dynmon-min");
            this.contentEl.style.display = "none";
            panel.querySelector(".dynmon-statusbar").style.display = "none";
            this.flashMinimize(); // 瞬时红色, 由标题栏状态机渐变为蓝色
        } else {
            panel.classList.remove("dynmon-min");
            this.contentEl.style.display = "";
            panel.querySelector(".dynmon-statusbar").style.display = "";
            if (this.savedSize) {
                panel.style.width = `${this.savedSize.w}px`;
                panel.style.height = `${this.savedSize.h}px`;
            }
        }
        this.minBtn.textContent = target ? "+" : "–";
        this.minBtn.title = target ? this.t("restoreTip") : this.t("minimizeTip");
        this.positioned = true;
        this.clampHeaderIntoWindow();
        this.updatePosSizeLabels();
        if (!target)
            this.drawChart();
    }

    updatePosSizeLabels() {
        const x = Math.round(this.panel.offsetLeft);
        const y = Math.round(this.panel.offsetTop);
        const w = this.panel.offsetWidth;
        const h = this.panel.offsetHeight;
        this.posEl.textContent = `(${x}, ${y})`;
        this.sizeEl.textContent = `${w}x${h}`;
    }

    // ---------- i18n 应用 ----------

    applyI18n() {
        this.titleEl.textContent = this.t("title");
        this.subtitleEl.textContent = this.t("subtitle");
        this.syncPauseButton();
        this.helpBtn.title = this.t("helpTip");
        this.resetBtn.title = this.t("resetTip");
        this.dockBtn.title = this.t("dockTip");
        this.minBtn.title = this.minimized ? this.t("restoreTip") : this.t("minimizeTip");
        this.ramBtn.textContent = this.t("cleanRam");
        this.vramBtn.textContent = this.t("cleanVram");
        this.aggrLabel.textContent = this.t("aggressive");
        this.panel.querySelector(".dynmon-aggr").title = this.t("aggressiveTip");

        // 列表区按钮图标与 tooltip
        this.unloadAllBtn.innerHTML = ICONS.unload;
        this.unloadAllBtn.title = this.t("unloadAllTip");
        this.clearUnloadedBtn.innerHTML = ICONS.unload;
        this.clearUnloadedBtn.title = this.t("clearUnloadedTip");

        // 状态栏工具提示
        this.langSelect.title = this.t("langTip");
        this.rateGroupEl.title = this.t("rateTip");
        this.mouseEl.title = this.t("mouseTip");
        this.posEl.title = this.t("posTip");
        this.sizeEl.title = this.t("sizeTip");
        this.statusEl.title = this.t("statusTip");

        // 统计卡片工具提示 (构造时解析好各卡的文案函数)
        for (const key of Object.keys(this.cardTipFns || {}))
            this.cardRefs[key].el.title = this.cardTipFns[key]();

        // 下拉框占位项 (始终显示为选中态)
        this.linksSelect.options[0].textContent = this.t("quickLinks");
        this.dirsSelect.options[0].textContent = this.t("localDirs");

        // 空状态占位文本
        if (this.modelByUuid.size === 0)
            this.emptyEl.textContent = this.t("noModels");
        if (this.unloadedByUuid.size === 0)
            this.emptyUnloadedEl.textContent = this.t("noUnloaded");

        // 已存在的模型行随语言刷新 (两个列表)
        for (const [uuid, row] of this.rowByUuid) {
            const m = this.modelByUuid.get(uuid);
            if (m)
                this.updateRow(row, m);
        }
        for (const [uuid, row] of this.unRowByUuid) {
            const m = this.unloadedByUuid.get(uuid);
            if (m)
                this.updateRow(row, m);
        }
    }

    // ---------- 刷新率 / 暂停 ----------

    syncRateDisplay() {
        // 暂停态显示 0 (保存的设置值不变, 仅展示)
        this.rateInput.value = String(this.paused ? 0 : this.rate);
    }

    syncPauseButton() {
        this.pauseBtn.textContent = this.paused ? "\u25B6" : "\u275A\u275A"; // play / pause
        this.pauseBtn.title = this.t(this.paused ? "playTip" : "pauseTip");
    }

    togglePause() {
        this.paused = !this.paused;
        this.syncRateDisplay();
        this.syncPauseButton();
    }

    setRate(value) {
        this.rate = clamp(parseInt(value, 10) || 0, 0, 10);
        if (this.rate > 0 && this.paused)
            this.paused = false;
        this.syncRateDisplay();
        this.syncPauseButton();
        setSetting(SETTING_RATE, this.rate);
    }

    getPollIntervalMs() {
        return (!this.paused && this.rate > 0) ? 1000 / this.rate : Infinity;
    }

    // ---------- 标题栏颜色状态机 ----------
    // 模式说明: State + Tween. 调用方 (最小化 / 警告 / 恢复) 只发布目标色,
    // 唯一的 ticker 循环负责把当前色向目标色线性插值并渲染, 调用方无需关心渐变过程.

    // 启动标题栏渐变循环 (33ms 约等于 30fps, 足够平滑且开销可忽略)
    initHeaderFx() {
        this.hdrTimer = setInterval(() => this.headerTick(), 33);
    }

    headerTick() {
        if (!this.enabled)
            return;
        const now = performance.now();

        // 目标色优先级: 警告 > 最小化蓝色保持 (不回到默认, 展开才回) > 默认
        let target = HEADER_DEFAULT;
        if (this.alertReasons.length > 0)
            target = HEADER_ALERT;
        else if (this.minimized)
            target = HEADER_FLASH;

        if (target !== this.hdrTarget) {
            this.hdrFrom = this.hdrCur.slice();
            this.hdrTarget = target;
            this.hdrTargetAt = now;
        }

        // 线性插值: 红色闪动全程 1s, 其余过渡用较短时长
        const from = this.hdrFrom;
        const dur = (from === HEADER_FLASH || target === HEADER_FLASH) ? HEADER_FADE_MS : HEADER_FADE_FAST_MS;
        const t = clamp((now - this.hdrTargetAt) / dur, 0, 1);
        for (let i = 0; i < 3; i++)
            this.hdrCur[i] = Math.round(from[i] + (target[i] - from[i]) * t);

        const [r, g, b] = this.hdrCur;
        this.headerEl.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
        this.headerEl.style.borderBottomColor = `rgb(${Math.round(r * 0.6)}, ${Math.round(g * 0.6)}, ${Math.round(b * 0.6)})`;
    }

    // 最小化瞬间: 当前色立即置红 (不渐变), 之后由 ticker 在 1s 内渐变为蓝色
    flashMinimize() {
        this.hdrMinAt = performance.now();
        this.hdrCur = HEADER_ALERT.slice();
        this.hdrFrom = this.hdrCur.slice();
        this.hdrTarget = HEADER_FLASH.slice();
        this.hdrTargetAt = this.hdrMinAt;
    }

    // ---------- 警告计算 ----------

    // 依据快照计算警告原因: 任一温度 > 90 C / 显存剩余极小 / 内存剩余 < 10%
    computeAlerts(data) {
        const reasons = [];
        const hot = [];
        const cpuT = data.cpu?.temp;
        if (cpuT != null && cpuT > 90)
            hot.push(`CPU ${round1(cpuT)}`);
        const gpuT = data.devices?.[0]?.temperature;
        if (gpuT != null && gpuT > 90)
            hot.push(`GPU ${round1(gpuT)}`);
        if (hot.length)
            reasons.push(this.t("alertTemp", hot.join(", ")));

        const d = data.devices?.[0];
        if (d?.vram_total > 0) {
            // 显存溢出判定: 剩余 <= max(总量的 2%, 512 MB) 视为告急
            const free = d.vram_total - d.vram_used;
            const minFree = Math.max(d.vram_total * 0.02, 512 * 1024 * 1024);
            if (free <= minFree)
                reasons.push(this.t("alertVram", fmtBytes(free)));
        }

        const ram = data.ram;
        if (ram?.total > 0 && ram.available / ram.total < 0.10)
            reasons.push(this.t("alertRam", fmtBytes(ram.available)));
        return reasons;
    }

    // ---------- 状态反馈 ----------

    flash(message, isError = false) {
        this.statusEl.textContent = message;
        this.statusEl.classList.toggle("dynmon-status-err", isError);
        clearTimeout(this.statusTimer);
        this.statusTimer = setTimeout(() => {
            this.statusEl.textContent = "";
        }, 3500);
    }

    onError() {
        // 连续轮询失败只提示一次, 恢复后由下一次成功数据覆盖
        if (this.errorShown)
            return;
        this.errorShown = true;
        this.flash(this.t("backendError"), true);
    }

    // ---------- 数据应用 ----------

    applyStats(data) {
        this.errorShown = false;
        this.busy = !!data.busy;
        this.panel.classList.toggle("dynmon-busy", this.busy);
        this.primaryVram = data.devices?.[0]?.vram_total || 0;

        // 警告状态: 更新原因列表 (驱动标题栏红色与警告次标题)
        this.alertReasons = this.computeAlerts(data);
        this.alertEl.textContent = this.alertReasons.join("; ");
        this.alertEl.title = this.alertReasons.join("\n");

        const primary = data.devices?.[0];
        const sample = {
            cpu: round1(data.cpu?.percent) ?? 0,
            ram: round1(data.ram?.percent) ?? 0,
            gpu: round1(primary?.gpu_util),
            vram: round1(primary?.vram_percent) ?? 0,
        };
        this.history.push(sample);
        if (this.history.length > MAX_POINTS)
            this.history.shift();

        this.updateCards(data, primary);
        this.renderModels(data.models || [], data.unloaded_models || []);
        this.drawChart();
    }

    // 卡片颜色: 占用超过阈值后背景与描边向告警色线性渐变 (无数据的卡片保持中性色)
    applyCardTint(cardEl, percent) {
        if (percent == null || percent <= WARN_THRESHOLD) {
            cardEl.style.backgroundColor = "";
            cardEl.style.borderColor = "";
            return;
        }
        const t = clamp((percent - WARN_THRESHOLD) / (100 - WARN_THRESHOLD), 0, 1);
        cardEl.style.backgroundColor = mixColor(CARD_BASE_BG, CARD_WARN_BG, t);
        cardEl.style.borderColor = mixColor(CARD_BASE_BORDER, CARD_WARN_BORDER, t);
    }

    updateCards(data, primary) {
        this.lastCpuCores = data.cpu?.cores ?? null;
        this.lastGpuName = primary?.name || "";
        for (const c of CARDS) {
            const ref = this.cardRefs[c.key];
            const percent = c.pct(data);
            // 温度卡: 100 C = 100%
            const barPercent = percent != null ? clamp(percent, 0, 100) : null;

            if (c.key === "cpu") {
                ref.value.textContent = `${sampleFmt(percent)}%`;
                ref.sub.textContent = this.t("threads", data.cpu?.cores ?? "-");
            } else if (c.key === "ram") {
                const ramSub = `${fmtBytes(data.ram?.used)} / ${fmtBytes(data.ram?.total)}`
                    + (data.ram?.proc_rss != null ? ` · ${this.t("proc", fmtBytes(data.ram.proc_rss))}` : "");
                ref.value.textContent = `${sampleFmt(percent)}%`;
                ref.sub.textContent = ramSub;
            } else if (c.key === "gpu") {
                ref.value.textContent = percent != null ? `${sampleFmt(percent)}%` : "-";
                ref.sub.textContent = primary ? (primary.name || "") : this.t("noGpu");
            } else if (c.key === "vram") {
                ref.value.textContent = `${sampleFmt(percent)}%`;
                ref.sub.textContent = primary
                    ? `${fmtBytes(primary.vram_used)} / ${fmtBytes(primary.vram_total)}`
                    : "-";
            } else if (c.key === "cpu_temp") {
                ref.value.textContent = percent != null ? `${sampleFmt(percent)}` : "-";
                ref.sub.textContent = percent != null ? "C" : "";
            } else if (c.key === "gpu_temp") {
                ref.value.textContent = percent != null ? `${sampleFmt(percent)}` : "-";
                ref.sub.textContent = percent != null ? "C" : (primary ? "" : this.t("noGpu"));
            }

            ref.bar.style.width = `${barPercent ?? 0}%`;
            this.applyCardTint(ref.el, barPercent);
        }

        // 多 GPU 时附加逐设备行
        const devices = data.devices || [];
        if (devices.length > 1) {
            this.devicesEl.innerHTML = devices.map(d =>
                `<div title="${escapeHtml(d.name)}">${escapeHtml(d.name)} · `
                + `${fmtBytes(d.vram_used)} / ${fmtBytes(d.vram_total)} (${sampleFmt(d.vram_percent)}%)`
                + (d.gpu_util != null ? ` · ${this.t("util", sampleFmt(d.gpu_util))}` : "")
                + `</div>`).join("");
            this.devicesEl.style.display = "";
        } else {
            this.devicesEl.innerHTML = "";
            this.devicesEl.style.display = "none";
        }
    }

    // ---------- 下拉框 ----------

    // 快捷链接项 (占位项之后追加, label 为品牌名, 不随语言变化)
    populateQuickLinks() {
        for (const link of QUICK_LINKS) {
            const opt = document.createElement("option");
            opt.value = link.url;
            opt.textContent = link.label;
            opt.title = link.url;
            this.linksSelect.appendChild(opt);
        }
    }

    ensureDirsLoaded() {
        if (this.dirsLoaded)
            return;
        this.dirsLoaded = true;
        fetch(`${API_BASE}/folders`)
            .then(r => r.json())
            .then((data) => {
                const folders = data.folders || [];
                let count = 0;
                for (const f of folders) {
                    for (const p of f.paths) {
                        const opt = document.createElement("option");
                        opt.value = p;
                        opt.textContent = `${f.name} - ${p}`;
                        opt.title = p;
                        this.dirsSelect.appendChild(opt);
                        count++;
                    }
                }
                if (count === 0) {
                    const opt = document.createElement("option");
                    opt.disabled = true;
                    opt.textContent = this.t("noDirs");
                    this.dirsSelect.appendChild(opt);
                }
            })
            .catch((e) => {
                this.dirsLoaded = false; // 失败后允许重试
                this.flash(this.t("dirFetchFail", e.message), true);
            });
    }

    // ---------- 模型列表 ----------

    renderModels(models, unloaded) {
        this.modelByUuid.clear();
        for (const m of models)
            this.modelByUuid.set(m.uuid, m);
        this.unloadedByUuid.clear();
        for (const m of unloaded || [])
            this.unloadedByUuid.set(m.uuid, m);

        this.countEl.textContent = this.t("loadedModels", models.length);
        this.countUnloadedEl.textContent = this.t("unloadedModels", this.unloadedByUuid.size);

        // 已加载列表: uuid 集合变化时增删行, 否则仅刷新文本 (避免高频重排)
        const signature = models.map(m => m.uuid).join("|");
        if (signature !== this.modelsSignature) {
            this.modelsSignature = signature;
            for (const [uuid, row] of this.rowByUuid) {
                if (!this.modelByUuid.has(uuid)) {
                    // 行被移除时若 tooltip 正挂在上面, 必须联动隐藏
                    // (行已脱离 DOM, mouseout 不会触发, 否则弹窗永久残留)
                    if (this.tipRow === row)
                        this.hideTip();
                    row.remove();
                    this.rowByUuid.delete(uuid);
                }
            }
            let anchor = null;
            for (const m of models) {
                let row = this.rowByUuid.get(m.uuid);
                if (!row) {
                    row = this.createRow(m, "loaded");
                    this.rowByUuid.set(m.uuid, row);
                }
                if (anchor === null)
                    this.listEl.prepend(row);
                else
                    anchor.after(row);
                anchor = row;
            }
        }

        for (const m of models) {
            const row = this.rowByUuid.get(m.uuid);
            if (row)
                this.updateRow(row, m);
        }

        // 空状态占位
        if (models.length === 0) {
            this.emptyEl.textContent = this.t("noModels");
            this.listEl.appendChild(this.emptyEl);
        } else {
            this.emptyEl.remove();
        }

        // 已卸载列表 (新在前, 全量重建即可, 条目数量有限且变化低频)
        const uSignature = (unloaded || []).map(m => m.uuid).join("|");
        if (uSignature !== this.unloadedSignature) {
            this.unloadedSignature = uSignature;
            this.listUnloadedEl.textContent = "";
            this.unRowByUuid.clear();
            for (const m of unloaded || []) {
                const row = this.createRow(m, "unloaded");
                this.updateRow(row, m);
                this.unRowByUuid.set(m.uuid, row);
                this.listUnloadedEl.appendChild(row);
            }
            if (this.unloadedByUuid.size === 0) {
                this.emptyUnloadedEl.textContent = this.t("noUnloaded");
                this.listUnloadedEl.appendChild(this.emptyUnloadedEl);
            }
        }
    }

    createRow(m, mode) {
        const row = document.createElement("div");
        row.className = "dynmon-row";
        row.dataset.uuid = m.uuid;
        row.dataset.mode = mode;
        row.innerHTML = `
            <div class="dynmon-row-top">
                <span class="dynmon-loc"></span>
                <span class="dynmon-class"></span>
                <span class="dynmon-fname"></span>
                <span class="dynmon-size"></span>
            </div>
            <div class="dynmon-vbar"><i class="dynmon-vbar-loaded"></i><i class="dynmon-vbar-model"></i></div>
            <div class="dynmon-row-bottom">
                <span class="dynmon-sub"></span>
                <span class="dynmon-time"></span>
                <span class="dynmon-row-btns">
                    <button data-act="copy"></button>
                    <button data-act="open"></button>
                    ${mode === "loaded" ? '<button data-act="unload"></button>' : ""}
                </span>
            </div>
        `;
        row.querySelector('[data-act="copy"]').innerHTML = ICONS.copy;
        row.querySelector('[data-act="open"]').innerHTML = ICONS.open;
        const unloadBtn = row.querySelector('[data-act="unload"]');
        if (unloadBtn)
            unloadBtn.innerHTML = ICONS.unload;
        return row;
    }

    updateRow(row, m) {
        const t = LANGS[this.lang];
        const mode = row.dataset.mode;
        const isRemoved = mode === "unloaded";

        // 已卸载条目展示统一的 "已卸载" 状态 (位置/设备/进度重置, 颜色灰色)
        const badge = row.querySelector(".dynmon-loc");
        badge.textContent = isRemoved ? t.stateRemoved : (t.location[m.location] || m.location);
        badge.className = `dynmon-loc dynmon-loc-${isRemoved ? "removed" : m.location}`;

        row.querySelector(".dynmon-class").textContent = m.class;
        row.querySelector(".dynmon-class").title = m.class;

        const nameEl = row.querySelector(".dynmon-fname");
        nameEl.textContent = m.filename || this.t("pathUnknown");
        nameEl.classList.toggle("dynmon-fname-unknown", !m.filename);

        row.querySelector(".dynmon-size").textContent = fmtBytes(m.size);
        row.querySelector(".dynmon-sub").textContent = isRemoved
            ? `${m.dtype} · ${t.stateRemoved}`
            : buildSubLine(m, t);
        row.dataset.tip = buildDetailText(m, t, isRemoved)
            + (isRemoved
                ? `\n${this.t("unloadedAt", fmtClock(m.unloaded_at))}`
                : `\n${this.t("loadedAt", fmtClock(m.loaded_at))}`);
        row.querySelector(".dynmon-time").textContent =
            fmtClock(isRemoved ? m.unloaded_at : m.loaded_at);

        // 行按钮 tooltip (i18n); 卸载按钮对常驻内存的模型禁用 (卸载语义不适用)
        const btns = row.querySelectorAll(".dynmon-row-btns button");
        btns[0].title = this.t("copyTip");
        btns[1].title = this.t("openTip");
        if (btns[2]) {
            const ramOnly = !isRemoved && m.location === "ram";
            btns[2].disabled = ramOnly;
            btns[2].title = ramOnly ? this.t("unloadRamTip") : this.t("unloadTip");
        }

        // 行状态配色: 使用中 = 绿色调, 空闲 = 基础色, 已卸载 = 强制中性色
        if (isRemoved) {
            row.style.backgroundColor = "";
            row.style.borderColor = "";
        } else if (m.used) {
            row.style.backgroundColor = mixColor(ROW_BASE_BG, ROW_USED_BG, 1);
            row.style.borderColor = mixColor(ROW_BASE_BORDER, ROW_USED_BORDER, 1);
        } else {
            row.style.backgroundColor = "";
            row.style.borderColor = "";
        }

        // 体积占比条: 总区间 = 主设备显存; 红色 (已加载) 在前, 蓝色 (未加载余量) 在后,
        // 两者互斥渲染, 合计宽度 = 模型体积. 已卸载条目全部清零.
        const total = this.primaryVram > 0 ? this.primaryVram : m.size;
        const loadedFrac = isRemoved ? 0 : clamp(m.loaded / total, 0, 1);
        const remainFrac = isRemoved ? 0 : clamp((m.size - m.loaded) / total, 0, 1);
        row.querySelector(".dynmon-vbar-loaded").style.width = `${loadedFrac * 100}%`;
        row.querySelector(".dynmon-vbar-loaded").style.background = BAR_LOADED_COLOR;
        row.querySelector(".dynmon-vbar-model").style.width = `${remainFrac * 100}%`;
        row.querySelector(".dynmon-vbar-model").style.background = BAR_MODEL_COLOR;
    }

    // ---------- 动作 ----------

    async handleCleanAction(act) {
        if (act === "clean-ram") {
            const aggressive = this.aggrCheckbox?.checked || false;
            try {
                const r = await postJSON("/free", { target: "ram", aggressive });
                this.flash(this.t("freedRam", fmtBytes(r.freed || 0)));
            } catch (e) {
                this.flash(this.t("cleanRamFail", e.message), true);
            }
        } else if (act === "clean-vram") {
            try {
                const r = await postJSON("/free", { target: "vram" });
                if (r.queued)
                    this.flash(this.t("queuedClean"));
                else
                    this.flash(this.composeFreeVramMsg(r));
            } catch (e) {
                this.flash(this.t("cleanVramFail", e.message), true);
            }
            scheduleRefresh();
        }
    }

    // 拼接显存清理结果消息: 释放量 + 常驻内存模型的跳过提示
    composeFreeVramMsg(r) {
        let msg = this.t("freedVram", fmtBytes(r.freed || 0));
        if (r.skipped > 0)
            msg += `; ${this.t("freeSkippedMsg", r.skipped)}`;
        return msg;
    }

    // 列表标题行的动作: 卸载全部已加载模型 / 清空已卸载记录
    async handleSectionAction(act) {
        if (act === "unload-all") {
            if (this.busy) {
                this.flash(this.t("busyUnload"), true);
                return;
            }
            try {
                const r = await postJSON("/free", { target: "vram" });
                if (r.queued)
                    this.flash(this.t("queuedClean"));
                else
                    this.flash(this.composeFreeVramMsg(r));
                scheduleRefresh();
            } catch (e) {
                this.flash(this.t("cleanVramFail", e.message), true);
            }
        } else if (act === "clear-unloaded") {
            try {
                await postJSON("/unloaded/clear", {});
                this.flash(this.t("clearedUnloaded"));
            } catch (e) {
                this.flash(this.t("unloadFail", e.message), true);
            }
        }
    }

    async handleModelAction(act, uuid) {
        // 已加载与已卸载两个列表共用行动作, 分别查各自的条目表
        const m = this.modelByUuid.get(uuid) || this.unloadedByUuid.get(uuid);
        if (!m)
            return;

        if (act === "copy") {
            copyText(buildDetailText(m, LANGS[this.lang]), () => this.flash(this.t("copiedFull")));
        } else if (act === "open") {
            try {
                const r = await postJSON("/open", { uuid });
                this.flash(r.path);
            } catch (e) {
                const msg = e.status === 400
                    ? this.t("openNoPath")
                    : e.status === 404
                        ? this.t("openReleased")
                        : this.t("openFail", e.message);
                this.flash(msg, true);
            }
        } else if (act === "unload") {
            if (this.busy) {
                this.flash(this.t("busyUnload"), true);
                return;
            }
            try {
                const r = await postJSON("/unload", { uuid });
                // 结果驱动: 仅当后端验证卸载成功 (注册表条目已移除) 才显示已卸载
                if (r.ok) {
                    this.flash(this.t("unloaded", m.filename || m.class));
                } else {
                    const msg = r.reason === "ram_only" ? this.t("unloadRamMsg")
                        : r.reason === "still_resident"
                            ? this.t("unloadStillMsg", fmtBytes(r.freed || 0))
                            : r.reason === "not_found"
                                ? this.t("unloadNotFoundMsg")
                                : this.t("unloadFail", r.message || r.reason);
                    this.flash(msg, true);
                }
                scheduleRefresh();
            } catch (e) {
                const msg = e.status === 409
                    ? this.t("busyUnloadHttp")
                    : e.status === 404
                        ? this.t("unloadNotFoundMsg")
                        : this.t("unloadFail", e.message);
                this.flash(msg, true);
            }
        }
    }

    // ---------- 折线图 ----------

    drawChart() {
        const canvas = this.canvas;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (w <= 0 || h <= 0)
            return; // 面板不可见 (最小化等)

        // 按 devicePixelRatio 重设 backing store, 保证高清屏清晰
        const dpr = window.devicePixelRatio || 1;
        const bw = Math.round(w * dpr);
        const bh = Math.round(h * dpr);
        if (canvas.width !== bw || canvas.height !== bh) {
            canvas.width = bw;
            canvas.height = bh;
        }
        const ctx = this.ctx;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        // 水平网格 (0 / 25 / 50 / 75 / 100%)
        ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
        ctx.lineWidth = 1;
        for (let p = 0; p <= 100; p += 25) {
            const y = Math.round(h - (p / 100) * (h - 8) - 4) + 0.5;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        const count = this.history.length;
        if (count < 2)
            return;
        const step = w / (MAX_POINTS - 1);
        // 最新点贴右边缘, 老点向左排布 (数据不足 MAX_POINTS 时曲线从左侧开始生长)
        const xAt = (i) => w - (count - 1 - i) * step;

        for (const s of CHART_SERIES) {
            ctx.strokeStyle = s.color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            let drawing = false;
            for (let i = 0; i < count; i++) {
                const v = this.history[i][s.key];
                if (v == null) { // GPU 不可用时跳过该系列的数据点
                    drawing = false;
                    continue;
                }
                const x = xAt(i);
                const y = h - (clamp(v, 0, 100) / 100) * (h - 8) - 4;
                if (!drawing) {
                    ctx.moveTo(x, y);
                    drawing = true;
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.stroke();
        }
    }

    positionTip(e) {
        const tip = this.tipEl;
        let x = e.clientX + 14;
        let y = e.clientY + 16;
        const rect = tip.getBoundingClientRect();
        if (x + rect.width > window.innerWidth - 8)
            x = e.clientX - rect.width - 14;
        if (y + rect.height > window.innerHeight - 8)
            y = e.clientY - rect.height - 16;
        tip.style.left = `${Math.max(8, x)}px`;
        tip.style.top = `${Math.max(8, y)}px`;
    }

    hideTip() {
        this.tipEl.style.display = "none";
        this.tipVisible = false;
        this.tipRow = null;
    }
}


// ============================================================
// 全局调度
// ============================================================

let panel = null;
let heartbeatId = null;
let fetchBusy = false;
let refreshTimer = null;

function heartbeatTick() {
    if (!panel)
        return;
    // 启用开关: 每次心跳读取全局设置 (读取开销可忽略), 关闭时隐藏面板并停止取数
    const enabled = getSetting(SETTING_ENABLE, true) !== false;
    if (enabled !== panel.enabled) {
        panel.enabled = enabled;
        panel.panel.style.display = enabled ? "" : "none";
    }
    if (!panel.enabled)
        return;
    if (panel.minimized)
        return; // 最小化时不刷新 (展开后由下一次心跳立即恢复)

    const now = performance.now();
    const interval = panel.getPollIntervalMs();
    if (fetchBusy || now - panel.lastUpdated < interval - 40)
        return;
    fetchBusy = true;
    fetchStats()
        .then(data => {
            panel.applyStats(data);
            panel.lastUpdated = performance.now();
        })
        .catch(() => {
            panel.onError();
            panel.lastUpdated = now; // 避免失败后以极高频率重试
        })
        .finally(() => {
            fetchBusy = false;
        });
}

// 用户动作 (卸载/清理) 后主动刷一次数据 (绕过频率节流)
function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
        if (!panel || !panel.enabled || panel.minimized)
            return;
        try {
            const data = await fetchStats();
            panel.applyStats(data);
            panel.lastUpdated = performance.now();
        } catch {
            // 忽略, 下一轮心跳会重试
        }
    }, 350);
}

// 监听 ComfyUI 设置 / 模板等对话框: 弹出时自动最小化面板, 全部关闭后自动还原
function setupDialogWatcher() {
    if (typeof MutationObserver === "undefined")
        return;
    let timer = null;
    const DIALOG_SELS = ".p-dialog, .comfy-modal, .comfy-settings";
    const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            if (!panel)
                return;
            const open = Array.from(document.querySelectorAll(DIALOG_SELS))
                .some(el => el.offsetParent !== null || getComputedStyle(el).display !== "none");
            if (open && !panel.minimized) {
                panel.autoMinimized = true;
                panel.setMinimized(true);
            } else if (!open && panel.autoMinimized) {
                panel.autoMinimized = false;
                if (panel.minimized)
                    panel.setMinimized(false);
            }
        }, 150);
    });
    observer.observe(document.body, { childList: true, subtree: true });
}


// ============================================================
// 扩展接入
// ============================================================

app.registerExtension({
    name: "dynamic.resource_monitor",
    settings: [
        {
            id: SETTING_ENABLE,
            name: "Dynamic Resource Monitor: Enabled",
            type: "boolean",
            defaultValue: true,
            category: ["Dynamic", "Resource Monitor"],
        },
        {
            id: SETTING_RATE,
            name: "Dynamic Resource Monitor: Refresh rate (Hz, 0 = paused)",
            type: "number",
            defaultValue: DEFAULT_RATE,
            category: ["Dynamic", "Resource Monitor"],
        },
        {
            id: SETTING_LANG,
            name: "Dynamic Resource Monitor: Language",
            type: "combo",
            options: ["en", "zh"],
            defaultValue: DEFAULT_LANG,
            category: ["Dynamic", "Resource Monitor"],
        },
    ],
    async setup() {
        // setup 钩子中无条件创建浮动面板 (app 就绪后触发, 不依赖任何节点);
        // 是否显示由全局启用设置在每次心跳时决定
        panel = new MonitorPanel();
        heartbeatId = setInterval(heartbeatTick, 100);
        setupDialogWatcher();
    },
});
