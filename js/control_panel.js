// js/control_panel.js
// 资源监控浮动面板 (无节点, 纯前端扩展):
// - fixed 悬浮层: 标题栏 (状态图标 / 拖动 / 暂停 / 重置 / 停靠切换 / 点击穿透 / 最小化, 双击最小化) +
//   内容区 (6 统计卡片 / 折线图 / 模型列表) + 消息行 + 底部状态栏 (语言 / 透明度 / 刷新率 / 坐标 / 位置 / 尺寸)
// - 卡片: 占用超 50% 后背景与描边向告警色线性渐变; 温度卡以 100 C 为 100%
// - 模型列表行: 状态配色 + 体积/已加载占比条 + 图标按钮 (复制/打开/卸载)
// - 按钮行: 清理按钮 + 全进程 + 快捷链接下拉 + 本地目录下拉
// - 刷新率 (0-10 Hz, 0 = 暂停) / 语言 / 透明度 / 启用开关经 ComfyUI settings 持久化 (localStorage 兜底)
// - 打开 ComfyUI 设置/模板等对话框时自动最小化, 关闭后自动还原
// - 停靠模式: 贴附左下角并随窗口尺寸变化保持贴合; 仅浮动态实时记忆坐标, 退出停靠时恢复
import { app } from "../../scripts/app.js";


const API_BASE = "/comfyui_dynamic/monitor";
const MAX_POINTS = 180; // 折线图历史点数 (10 Hz 下约 18 s 窗口)

const DEFAULT_RATE = 2; // 刷新率默认值 (Hz)
const RATE_MIN = 0;     // 刷新率下限 (0 = 暂停)
const RATE_MAX = 10;    // 刷新率上限 (Hz)
const DEFAULT_LANG = "en";

const DEFAULT_OPACITY = 100; // 面板不透明度默认值 (%)
const MIN_OPACITY = 30;      // 面板不透明度下限 (%)
const MAX_OPACITY = 100;     // 面板不透明度上限 (%)

// 面板默认尺寸 (px)
const DEFAULT_W = 400;
const DEFAULT_H = 600;

// 垂直最大化: 面板高度撑满窗口, 顶部/底部各保留该边距 (px);
// 高度以 calc(100vh - 2 * 本值) 经 CSS 变量注入 (见 injectStyle), 窗口缩放时自动跟随
const VMAX_MARGIN_Y = 10;

// 停靠模式专用偏移 (px): 水平 = 左侧栏探测宽度基础上的余量, 垂直 = 距窗口底部的距离
const DOCK_OFFSET_X = 8;
const DOCK_OFFSET_Y = 10;

// 窗口边缘安全边距 (拖动夹取用)
const EDGE = 8;

// 左侧边栏宽度探测失败时的兜底值 (px), 避免停靠时挡住 CUI 左侧栏
const FALLBACK_SIDEBAR = 56;

// 标题栏拖动 / 双击状态机参数 (见 MonitorPanel 标题栏 pointerdown 状态机)
const DRAG_MOVE_PX = 2;  // 拖动位移阈值 (px): 位移超过此值 (不含) 才进入拖动, 按下时相对位置全程保持
const DRAG_DBL_MS = 150; // 双击判定窗口 (ms): 相邻两次按下间隔小于此值视为双击 (按下时触发)

// 卡片告警渐变: 占用超过阈值后, t = (p - 阈值) / (100 - 阈值) 线性混入告警色
const WARN_THRESHOLD = 50;

// 告警阈值 (标题栏红色警告与告警次标题的判定依据, 见 computeAlerts)
const ALERT_TEMP_C = 90;                       // 任一温度超过此值 (C) 触发温度告警
const VRAM_MIN_FREE_FRACTION = 0.02;           // 显存剩余比例低于此值视为告急
const VRAM_MIN_FREE_BYTES = 512 * 1024 * 1024; // 显存剩余字节下限 (与比例阈值取 max)
const RAM_MIN_FREE_FRACTION = 0.10;            // 内存剩余比例低于此值视为告急
// 温度卡满量程: 温度值 (C) 换算占用条百分比与告警渐变的基准 (TEMP_CARD_MAX_C = 100%)
const TEMP_CARD_MAX_C = 100;

// ============================================================
// 颜色系统 (两层): 颜色层在上, 映射层在下, 调色时两处对照编辑
// - 颜色层 RawColors: 项目内全部原始颜色, 全文件唯一允许颜色字面量的位置
//   命名: <色相>__<hex>, hex 为去掉 # 的完整色值 (字母小写, 带透明度为 8 位);
//   值统一为 "#rrggbb" / "#rrggbbaa" 大写形式 (VSC 可直接预览色块)
// - 映射层: 每个 UI 原子元素一项, 只允许引用颜色层 (禁止出现字面量)
//   key 为 camelCase 并与使用位置对应, injectStyle 注入时派生为
//   --dynmon-<组前缀>-<kebab-case>; CSS 经 var() 引用, JS 直接 类名.属性 引用
// ============================================================

// ---------- 颜色层 ----------
class RawColors {
    // 灰阶 (由暗到亮)
    static black__000000 = "#000000";
    static black__00000088 = "#00000088";
    static black__00000099 = "#00000099";
    static black__000000aa = "#000000AA";
    static black__000000cc = "#000000CC";
    static grey__111111 = "#111111";
    static grey__222222 = "#222222";
    static grey__333333 = "#333333";
    static grey__444444 = "#444444";
    static grey__555555 = "#555555";
    static grey__666666 = "#666666";
    static grey__777777 = "#777777";
    static grey__888888 = "#888888";
    static grey__999999 = "#999999";
    static grey__aaaaaa = "#AAAAAA";
    static grey__bbbbbb = "#BBBBBB";
    static grey__cccccc = "#CCCCCC";
    static grey__dddddd = "#DDDDDD";
    static grey__eeeeee = "#EEEEEE";
    static white__ffffff = "#FFFFFF";
    static white__ffffff0f = "#FFFFFF0F"; // 6% 透明白 (折线图网格线)
    // 红
    static red__330000 = "#330000";
    static red__660000 = "#660000";
    static red__660066 = "#660066";
    static red__cc0000 = "#CC0000";
    static red__cc0066 = "#CC0066";
    static red__ff0000 = "#FF0000";
    static red__ff6666 = "#FF6666";
    static red__ffcccc = "#FFCCCC";
    static red__ff6600 = "#FF6600";
    static red__ff0066 = "#FF0066";
    static red__ff66cc = "#FF66CC";
    static red__ff66668c = "#FF66668C"; // 55% 透明红 (占比条已加载段)
    static red__cc66ff = "#CC66FF";
    static red__ffccff = "#FFCCFF";
    static red__1a0a0a = "#1A0A0A"; // 淡暗红 (已卸载列表区底色占位, 后续可调)
    // 绿
    static green__002200 = "#002200";
    static green__003300 = "#003300";
    static green__006600 = "#006600";
    static green__00cc00 = "#00CC00";
    static green__00ff00 = "#00FF00";
    static green__00ff66 = "#00FF66";
    static green__00cc66 = "#00CC66";
    static green__006666 = "#006666";
    static green__66ff66 = "#66FF66";
    static green__ccff66 = "#CCFF66";
    static green__ccffcc = "#CCFFCC";
    static green__66cc00 = "#66CC00";
    // 蓝
    static blue__000033 = "#000033";
    static blue__111122 = "#111122";
    static blue__000066 = "#000066";
    static blue__0000cc = "#0000CC";
    static blue__0000ff = "#0000FF";
    static blue__66ccff = "#66CCFF";
    static blue__66ffcc = "#66FFCC";
    static blue__6666ff = "#6666FF";
    static blue__0066ff = "#0066FF";
    static blue__ccccff = "#CCCCFF";
    static blue__ccffff = "#CCFFFF";
    static blue__66ccff66 = "#66CCFF66"; // 透明蓝 (占比条模型段)
    // 黄 / 橙
    static yellow__ffcc00 = "#FFCC00";
    static yellow__ffff00 = "#FFFF00";
    static yellow__cccc00 = "#CCCC00";
    static yellow__663300 = "#663300";
    static orange__cc6600 = "#CC6600";
    static orange__ff6600 = "#FF6600";
    static yellow__666600 = "#666600";
}
Object.freeze(RawColors);

// ---------- 映射层: 文本 / 前景 ----------
class ForegroundColors {
    // 面板 / 标题栏
    static panel = RawColors.grey__cccccc;              // .dynmon-panel 默认文本 (标题/卡片数值等继承)
    static subtitle = RawColors.grey__999999;           // .dynmon-subtitle 标题栏副标题
    static headerButton = RawColors.grey__888888;       // .dynmon-hbtn 标题栏按钮常态
    static headerButtonHover = RawColors.white__ffffff; // .dynmon-hbtn:hover 标题栏按钮悬停
    static alert = RawColors.red__ff6666;               // .dynmon-alert 标题栏告警文本
    // 指标卡片区
    static cardLabel = RawColors.grey__888888;          // .dynmon-card-label 卡片标签
    static cardSub = RawColors.grey__777777;            // .dynmon-card-sub 卡片副行
    // 设备信息 / 折线图
    static devices = RawColors.grey__777777;            // .dynmon-devices 设备信息行
    static legend = RawColors.grey__999999;             // .dynmon-legend 折线图图例
    // 操作区
    static actionButton = RawColors.grey__cccccc;      // .dynmon-actions button 操作按钮
    static modelSelect = RawColors.grey__cccccc;       // .dynmon-select 模型筛选下拉框
    static aggressiveToggle = RawColors.grey__888888;   // .dynmon-aggr 激进卸载开关文本
    static sectionHeader = RawColors.grey__999999;      // .dynmon-sec-head 分区标题常态
    static sectionHeaderHover = RawColors.grey__cccccc; // .dynmon-sec-head:hover 分区标题悬停
    // 模型列表
    static locationRemoved = RawColors.grey__999999;    // .dynmon-loc-removed 已移除徽章文本
    static classBadge = RawColors.blue__ccffff;         // .dynmon-class 类名徽章文本
    static fileName = RawColors.grey__eeeeee;           // .dynmon-fname 模型文件名
    static fileNameUnknown = RawColors.grey__777777;    // .dynmon-fname-unknown 未知文件名占位
    static size = RawColors.grey__999999;               // .dynmon-size 模型行大小
    static subText = RawColors.grey__888888;            // .dynmon-sub 模型行副文本
    static timestamp = RawColors.grey__666666;          // .dynmon-time 模型行时间戳
    static rowButton = RawColors.grey__999999;          // .dynmon-row-btns button 行按钮常态 (disabled:hover 复用)
    static rowButtonHover = RawColors.white__ffffff;    // .dynmon-row-btns button:hover 行按钮悬停
    static emptyHint = RawColors.grey__666666;          // .dynmon-empty 列表空态提示
    static unloadButton = RawColors.red__ff6666;        // 行卸载按钮 [data-act="unload"] 常态
    static unloadButtonHover = RawColors.red__ff6666;   // 行卸载按钮悬停
    static unloadAllButton = RawColors.red__ff6666;     // .dynmon-sec-btn 卸载全部按钮常态
    static unloadAllButtonHover = RawColors.red__ff6666; // .dynmon-sec-btn:hover 卸载全部按钮悬停
    // 状态栏
    static statusBar = RawColors.grey__888888;          // .dynmon-statusbar 状态栏基础文本
    static statusBarValue = RawColors.grey__aaaaaa;     // .dynmon-sb-val 状态栏数值
    static langSelect = RawColors.grey__bbbbbb;         // .dynmon-lang 语言下拉框
    static rateButton = RawColors.grey__bbbbbb;         // .dynmon-rate-btn 刷新率步进按钮常态
    static rateButtonHover = RawColors.white__ffffff;   // .dynmon-rate-btn:hover 步进按钮悬停
    static rateInput = RawColors.white__ffffff;         // .dynmon-rate-input 刷新率输入框
    // 消息行
    static messageInfo = RawColors.blue__6666ff;        // .dynmon-msgbar 常规消息
    static messageError = RawColors.red__ff6666;        // .dynmon-msgbar.dynmon-status-err 错误消息
    // 弹层
    static tooltip = RawColors.grey__dddddd;            // .dynmon-tooltip 工具提示
    // 位置徽章文本 (与折线图系列同源原始色, 见 SeriesColors)
    static locationVram = RawColors.red__ffcccc;     // .dynmon-loc-vram 徽章文本
    static locationRam = RawColors.blue__ccccff;       // .dynmon-loc-ram 徽章文本
    static locationPartial = RawColors.red__ffccff;    // .dynmon-loc-partial 徽章文本
    // 控件
    static opacitySlider = RawColors.blue__66ccff;      // .dynmon-opacity 透明度滑杆填充 (accent-color)
}
Object.freeze(ForegroundColors);

// ---------- 映射层: 背景 / 填充 ----------
class BackgroundColors {
    // 面板 / 标题栏 (标题栏四态由 headerTick 状态机消费)
    static panel = RawColors.black__000000;             // .dynmon-panel 面板主体
    static header = RawColors.grey__222222;             // 标题栏常规 (原 HEADER_DEFAULT)
    static headerAlert = RawColors.red__660000;         // 标题栏警告 (温度超限 / 显存或内存告急)
    static headerMinimized = RawColors.grey__222222;    // 标题栏最小化保持色 (原 HEADER_FLASH)
    static headerMinimizeFlash = RawColors.red__cc0000; // 标题栏最小化瞬间起始色 (原 HEADER_FLASH_START)
    // 指标卡片区
    static card = RawColors.grey__222222;               // .dynmon-card 基础底色 (原 CARD_BASE_BG)
    static cardWarn = RawColors.red__660000;            // 卡片告警混入端 (原 CARD_WARN_BG)
    static cardUsageTrack = RawColors.grey__666666;     // .dynmon-bar 卡片占用条轨道
    // 画布
    static chartCanvas = RawColors.grey__111111;        // .dynmon-chartwrap canvas 画布底
    // 操作区
    static actionButton = RawColors.grey__222222;       // .dynmon-actions button 操作按钮
    static actionButtonHover = RawColors.red__660000;   // .dynmon-actions button:hover
    static modelSelect = RawColors.grey__222222;        // .dynmon-select 模型筛选下拉框
    static langSelect = RawColors.grey__222222;         // .dynmon-lang 语言下拉框
    static rateButton = RawColors.grey__222222;         // .dynmon-rate-btn 刷新率步进按钮
    static rateButtonHover = RawColors.red__660000;     // .dynmon-rate-btn:hover
    static rateInput = RawColors.black__000000;         // .dynmon-rate-input 刷新率输入框
    // 模型列表
    static unloadedSection = RawColors.red__1a0a0a;     // .dynmon-unloaded-sec 已卸载列表区整体底色
    static rowUsageTrack = RawColors.grey__222222;      // .dynmon-vbar 体积占比条轨道
    static volumeBarModel = RawColors.blue__66ccff66;   // .dynmon-vbar-model 模型总体积段 (JS 内联)
    static volumeBarLoaded = RawColors.red__ff66668c;   // .dynmon-vbar-loaded 已加载段 (JS 内联)
    static rowUsed = RawColors.green__002200;           // .dynmon-row used 状态底色 (JS 内联)
    static locationRemoved = RawColors.grey__333333;    // .dynmon-loc-removed 已移除徽章底
    static locationVram = RawColors.red__660000;     // .dynmon-loc-vram 徽章底
    static locationRam = RawColors.blue__0000cc;       // .dynmon-loc-ram 徽章底
    static locationPartial = RawColors.red__660066;    // .dynmon-loc-partial 徽章底
    static classBadge = RawColors.green__006666;       // .dynmon-class 类名徽章底
    // 消息行 / 状态栏
    static messageBar = RawColors.grey__222222;         // .dynmon-msgbar 消息行底
    static statusBar = RawColors.grey__222222;          // .dynmon-statusbar 状态栏底
    // 弹层
    static tooltip = RawColors.blue__111122;            // .dynmon-tooltip 工具提示底
}
Object.freeze(BackgroundColors);

// ---------- 映射层: 边框 / 分隔线 ----------
class BorderColors {
    // 面板 / 标题栏
    static panel = RawColors.grey__333333;              // .dynmon-panel 面板外框
    static header = RawColors.grey__333333;             // .dynmon-header 下边框静态初值 (运行时由背景色衍生覆盖)
    static card = RawColors.grey__333333;               // .dynmon-card 描边 (原 CARD_BASE_BORDER)
    static cardWarn = RawColors.red__cc0000;            // 卡片告警混入端 (原 CARD_WARN_BORDER)
    static chartCanvas = RawColors.grey__222222;        // 折线图画布描边 (原 border-soft)
    static chartGrid = RawColors.white__ffffff0f;       // canvas 网格线 (原 CHART_GRID_COLOR)
    // 操作区
    static actionButton = RawColors.grey__333333;       // .dynmon-actions button 描边
    static actionButtonHover = RawColors.grey__cccccc;  // 操作按钮悬停描边 (原 border-btn-hover)
    static modelSelect = RawColors.grey__333333;        // .dynmon-select 描边
    static langSelect = RawColors.grey__333333;         // .dynmon-lang 描边
    static rateStepper = RawColors.grey__333333;        // .dynmon-rate-stepper 描边
    static rateStepperDivider = RawColors.grey__333333; // 步进按钮间 inset 分隔线
    static rateInput = RawColors.grey__333333;          // .dynmon-rate-input 描边
    // 模型列表
    static row = RawColors.grey__444444;                // .dynmon-row 描边
    static rowUsed = RawColors.green__00cc00;           // .dynmon-row used 状态描边 (JS 内联)
    static rowHover = RawColors.blue__66ccff;           // .dynmon-row:hover 悬停描边 (原 focus)
    static rowButton = RawColors.grey__333333;          // .dynmon-row-btns button 描边 (disabled:hover 复用)
    static rowButtonHover = RawColors.grey__cccccc;     // 行按钮悬停描边 (原 border-btn-hover-strong)
    static unloadButton = RawColors.red__660000;        // 行卸载按钮描边常态
    static unloadButtonHover = RawColors.red__ff0000;   // 行卸载按钮描边悬停
    static unloadAllButton = RawColors.red__660000;     // .dynmon-sec-btn 卸载全部按钮描边
    static unloadAllButtonHover = RawColors.red__ff0000; // 卸载全部按钮描边悬停
    static unloadedSectionDivider = RawColors.grey__333333; // .dynmon-unloaded-sec 顶部分隔线 (已加载/已卸载列表分界)
    // 状态栏
    static statusBarItemSeparator = RawColors.grey__333333; // .dynmon-sb-item 左侧分隔线
    // 弹层
    static tooltip = RawColors.blue__66ccff;            // .dynmon-tooltip 描边 (原 focus)
    static tooltipSeparator = RawColors.grey__666666;   // .dynmon-tip-sep 提示内分隔线
}
Object.freeze(BorderColors);

// ---------- 映射层: 阴影 (几何 + 颜色层透明黑合成, 颜色改动只动颜色层) ----------
class ShadowColors {
    static panel = `0 2px 16px ${RawColors.black__000000cc}`;   // .dynmon-panel 投影
    static tooltip = `0 2px 16px ${RawColors.black__000000cc}`; // .dynmon-tooltip 投影
}
Object.freeze(ShadowColors);

// ---------- 映射层: 折线图系列 (画布曲线 / 图例圆点 / 卡片占用条, 仅 JS 引用不注入) ----------
class SeriesColors {
    static cpu = RawColors.blue__66ccff;
    static ram = RawColors.blue__0066ff;
    static gpu = RawColors.blue__66ffcc;
    static vram = RawColors.red__cc0066;
    static cpuTemp = RawColors.green__66cc00;
    static gpuTemp = RawColors.yellow__ffcc00;
}
Object.freeze(SeriesColors);

// 映射层注入配置: [类, CSS 变量组前缀], 派生规则 --dynmon-<前缀>-<kebab(key)>
const COLOR_GROUPS = [
    [ForegroundColors, "foreground"],
    [BackgroundColors, "background"],
    [BorderColors, "border"],
    [ShadowColors, "shadow"],
];
const CLASS_BUILTIN_KEYS = new Set(["length", "name", "prototype"]); // 类内建静态属性, 遍历时跳过
// camelCase 转 kebab-case: headerButtonHover -> header-button-hover
const kebabCase = (name) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

// 标题栏颜色状态机渐变时长 (见 MonitorPanel.initHeaderFx): 所有场景统一 0.5s
const HEADER_FADE_MS = 500;

const REPO_URL = "https://github.com/inkbottle-9/comfyui_dynamic"; // 项目仓库 (帮助按钮跳转目标, 快捷链接末项复用)

// 按钮行右侧下拉框 (始终显示占位文本, 不随选择改变)
const QUICK_LINKS = [
    { label: "ComfyUI", url: "https://comfy.org" },
    { label: "ComfyUI Docs", url: "https://docs.comfy.org" },
    { label: "ComfyUI Registry", url: "https://registry.comfy.org" },
    { label: "Comfy-Org (HF)", url: "https://huggingface.co/Comfy-Org" },
    { label: "Hugging Face", url: "https://huggingface.co" },
    { label: "Civitai", url: "https://civitai.com" },
    { label: "Civitai (red)", url: "https://civitai.red" },
    { label: "CivArchive", url: "https://civarchive.com" },
    { label: "OpenModelDB", url: "https://openmodeldb.info" },
    { label: "comfyui_dynamic (GitHub)", url: REPO_URL },
];

// 统计卡片定义 (顺序即展示顺序).
// pct: 从快照取数值的取值函数; color: 占用条颜色 (引用映射层系列色);
// max: 占用条满量程 (温度卡为 TEMP_CARD_MAX_C, 缺省 100)
const CARDS = [
    { key: "cpu", label: "CPU", color: SeriesColors.cpu, pct: (d) => d.cpu?.percent },
    { key: "ram", label: "RAM", color: SeriesColors.ram, pct: (d) => d.ram?.percent },
    { key: "gpu", label: "GPU", color: SeriesColors.gpu, pct: (d) => d.devices?.[0]?.gpu_util },
    { key: "vram", label: "VRAM", color: SeriesColors.vram, pct: (d) => d.devices?.[0]?.vram_percent },
    { key: "cpu_temp", label: "CPU C", color: SeriesColors.cpuTemp, max: TEMP_CARD_MAX_C, pct: (d) => d.cpu?.temp },
    { key: "gpu_temp", label: "GPU C", color: SeriesColors.gpuTemp, max: TEMP_CARD_MAX_C, pct: (d) => d.devices?.[0]?.temperature },
];

// 折线图系列 (全部六项: 利用率 0-100%, 温度单独域, 各系列按 CHART_DOMAIN 线性映射)
const CHART_SERIES = CARDS.slice();

// 折线图各系列 y 轴数值域 [min, max] (线性映射到图表高度, 超界截断; key 缺失时回退 0-100):
// 利用率为百分比天然 0-100; 温度用窄域放大波动可见性 (满量程 20-100 C, 覆盖常见空闲-高载区间)
const CHART_DOMAIN = {
    cpu: [0, 100],
    ram: [0, 100],
    gpu: [0, 100],
    vram: [0, 100],
    cpu_temp: [20, 100],
    gpu_temp: [20, 100],
};
const CHART_DOMAIN_FALLBACK = [0, 100]; // CHART_DOMAIN 未覆盖的 key 的回退域

// 运行时行为参数 (ms): 集中置顶便于调整
const HEARTBEAT_MS = 100;      // 心跳周期: 驱动启用/设置热更新与对话框开关轮询
const FETCH_FAIL_STREAK_THRESHOLD = 3; // 轮询连续失败达到此次数后进入退避
const FETCH_FAIL_BACKOFF_MS = 5000;    // 退避间隔 (ms): 后端不可达时的最低重试周期
const FETCH_TIMEOUT_MS = 5000;         // 单次取数超时 (ms): 挂起连接不设限会令 fetchBusy 永久卡死轮询
const HEADER_TICK_MS = 33;     // 标题栏颜色渐变 tick (约 30fps)
const MSG_CLEAR_MS = 3500;     // 消息行自动清空延时
const ACTION_REFRESH_MS = 350; // 用户动作 (卸载/清理) 后主动刷新延时

// 折线图绘制参数 (canvas 直接绘制, 不经 CSS; 网格线颜色见 BorderColors.chartGrid)
const CHART_PAD_Y = 4; // 曲线/网格上下安全边距 (px)

// 左侧栏探测启发式 (detectLeftSidebarWidth): 判定贴附窗口左缘的导航栏元素
const SIDEBAR_PROBE_MIN_W = 8;    // 最小宽度 (px)
const SIDEBAR_PROBE_MAX_LEFT = 2; // 距窗口左缘最大距离 (px)
const SIDEBAR_PROBE_MIN_H = 100;  // 最小高度 (px, 排除小工具条)

// 设置键 (ComfyUI settings id / localStorage 键共用);
// 经 export 供 js/warning.js 等并列模块引用, 避免字面量多处同步
export const SETTING_ID__RATE = "dynamic.ResourceMonitor.refreshRate";
export const SETTING_ID__LANG = "dynamic.ResourceMonitor.language";
export const SETTING_ID__OPACITY = "dynamic.ResourceMonitor.opacity";
export const SETTING_ID__ENABLE = "dynamic.ResourceMonitor.enabled";

// 行内图标 (SVG, currentColor 继承按钮颜色, 卸载按钮通过 CSS 置红)
const ICONS = {
    copy: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    open: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8V6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2"/><path d="M3 8h18l-2 11H5L3 8z"/></svg>',
    unload: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M10 11v6M14 11v6"/></svg>',
    // 标题栏状态图标 (主标题左侧, 随状态切换, 见 syncHeaderIcon): 常态仪表盘 / 告警红色三角
    headerGauge: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>',
    headerAlert: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 20h16a2 2 0 0 0 1.73-2Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    // 点击穿透按钮 (图标 = 点击后进入的状态, 与暂停按钮约定一致):
    // 关闭态显示带斜线的指针 (点击开启穿透), 开启态显示普通指针 (点击恢复拦截)
    pointerOff: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="m13 13 6 6"/><path d="M2 2l20 20"/></svg>',
    pointer: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="m13 13 6 6"/></svg>',
    // 垂直最大化按钮 (Windows 窗口最大化风格):
    // 常态单矩形 (点击撑满), 最大化态双矩形还原形 (点击恢复原高度), 与 Windows 按钮图标约定一致
    vmax: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="6" width="16" height="12"/></svg>',
    vmaxRestore: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="9" width="11" height="11"/><path d="M9 9V4h11v11h-5"/></svg>',
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
        undockTip: "Undock: restore previous floating position",
        minimizeTip: "Minimize (double-click title)",
        restoreTip: "Restore",
        vmaxTip: "Vertical maximize: fill page height",
        vmaxRestoreTip: "Restore panel height (vertically maximized)",
        backendDown: "Backend disconnected",
        passthroughTipOn: "Click-through is ON (panel ignores mouse, except this button). Click to disable",
        passthroughTipOff: "Click-through is OFF. Click to let mouse events pass through the panel",
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
        helpTitle: "Resource Monitor - comfyui_dynamic",
        // 帮助文案中的数值直接插值顶部常量, 避免双份维护 (未列出的除外);
        // 版式约定: 冒号引导的分组标题独占一行 (冒号后换行), 同组内以分号间隔的条目逐行排列,
        // 斜杠间隔的并列项保持单行 (tooltip 为 white-space: pre-wrap, \n 直接生效)
        helpText: [
            "Resource monitor floating panel from the comfyui_dynamic plugin.",
            "",
            "Cards:",
            "CPU / RAM / GPU / VRAM utilization and CPU / GPU temperature "
            + "(temperature full scale = " + TEMP_CARD_MAX_C + " C)",
            "Card background/border fade to red above " + WARN_THRESHOLD + "% usage",
            "Chart:",
            "History of all six series above",
            "Utilization is mapped to 0-100%, temperature to a "
            + CHART_DOMAIN.cpu_temp[0] + "-" + CHART_DOMAIN.cpu_temp[1]
            + " C window for better visibility",
            "",
            "Loaded models:",
            "Green border = in use",
            "Bottom bar shows model size relative to the primary GPU VRAM "
            + "(red = resident in VRAM, blue = remaining in RAM)",
            "Row buttons:",
            "Copy full details / locate the file in the file manager / unload from VRAM",
            "Unloaded models:",
            "Models released since page load (newest first, reference only)",
            "",
            "Header:",
            "The icon left of the title is a dashboard in normal state and a red warning triangle on alerts",
            "Alerts:",
            "Any temp above " + ALERT_TEMP_C + " C / VRAM almost full / RAM free below "
            + Math.round(RAM_MIN_FREE_FRACTION * 100) + "% / backend disconnected "
            + "(the subtitle then shows the disconnection)",
            "Red flash = just minimized",
            "Header buttons:",
            "Help (this text) / click-through toggle / pause / reset (default size + dock) "
            + "/ dock toggle / vertical maximize / minimize",
            "Double-click the title to minimize",
            "Drag to move",
            "Click-through makes the panel ignore all mouse events except its toggle button",
            "",
            "Actions:",
            "Free VRAM defers to after the current task when busy",
            "Free RAM always runs immediately, even during a task",
            "",
            "Status bar:",
            "Language / opacity (" + MIN_OPACITY + "-" + MAX_OPACITY + "%) / refresh rate (0-"
            + RATE_MAX + " Hz, 0 = paused) / mouse position / panel position and size",
            "Settings persist via ComfyUI settings (localStorage fallback)",
            "",
            "This ? button:",
            "Single-click copies this help text to the clipboard",
            "Double-click opens the project GitHub repository:",
            REPO_URL,
        ].join("\n"),
        langTip: "UI language",
        rateTip: "Refresh rate (0-" + RATE_MAX + " Hz, 0 = paused)",
        opacityTip: "Panel opacity (" + MIN_OPACITY + "-" + MAX_OPACITY + "%)",
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
        removeRecordTip: "Remove this record from the list",
        recordRemoved: "Record removed",
        removeFail: (m) => `Remove failed: ${m}`,
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
        helpCopied: "Help text copied to clipboard",
        helpCopyFail: "Copy failed",
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
        openNoFile: "Model file is not on disk",
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
        undockTip: "退出停靠: 恢复之前的浮动位置",
        minimizeTip: "最小化 (可双击标题栏)",
        restoreTip: "还原",
        vmaxTip: "垂直最大化: 高度撑满页面",
        vmaxRestoreTip: "还原面板高度 (当前垂直最大化)",
        backendDown: "后端已断连",
        passthroughTipOn: "点击穿透已开启 (面板忽略鼠标, 仅本按钮可交互). 点击关闭",
        passthroughTipOff: "点击穿透已关闭. 点击开启后, 鼠标事件将穿透面板直达下层内容",
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
        helpTitle: "资源监控 - comfyui_dynamic",
        // 帮助文案中的数值直接插值顶部常量, 避免双份维护 (未列出的除外);
        // 版式约定与 en 基准一致: 冒号引导的分组标题独占一行, 分号间隔的条目逐行排列
        helpText: [
            "comfyui_dynamic 插件自带的资源监控浮动面板.",
            "",
            "统计卡片:",
            "CPU / RAM / GPU / VRAM 利用率与 CPU / GPU 温度 (温度满量程 = " + TEMP_CARD_MAX_C + " C)",
            "占用超过 " + WARN_THRESHOLD + "% 后卡片背景与描边渐变为红色",
            "折线图:",
            "上述六个系列的近期历史",
            "利用率映射到 0-100%, 温度映射到 "
            + CHART_DOMAIN.cpu_temp[0] + "-" + CHART_DOMAIN.cpu_temp[1] + " C 窗口以提高可读性",
            "",
            "已加载模型:",
            "绿色边框 = 正在使用",
            "底部横条显示模型体积与主 GPU 显存的比例 (红色 = 已加载进显存, 蓝色 = 仍在内存的部分)",
            "行按钮:",
            "复制完整信息 / 在文件管理器中定位文件 / 从显存卸载",
            "已卸载模型:",
            "页面打开后被释放的模型记录 (最新在前, 仅供参考)",
            "",
            "标题栏:",
            "主标题左侧图标常态为仪表盘, 出现警告时变为红色三角",
            "警告条件:",
            "任一温度超过 " + ALERT_TEMP_C + " C / 显存告急 / 内存剩余不足 "
            + Math.round(RAM_MIN_FREE_FRACTION * 100) + "% / 后端断连 "
            + "(断连时副标题显示断连提示)",
            "红色闪动 = 刚被最小化",
            "标题栏按钮:",
            "帮助 (本段文本) / 点击穿透切换 / 暂停 / 重置 (默认尺寸 + 停靠) "
            + "/ 停靠切换 / 垂直最大化 / 最小化",
            "双击标题栏触发最小化",
            "按住可拖动",
            "点击穿透开启后, 面板忽略除该按钮外的全部鼠标事件",
            "",
            "清理按钮:",
            "清理显存在任务执行中会延迟到任务结束后自动执行",
            "清理内存始终立即生效, 即使任务执行中",
            "",
            "状态栏:",
            "语言 / 不透明度 (" + MIN_OPACITY + "-" + MAX_OPACITY + "%) / 刷新率 (0-"
            + RATE_MAX + " Hz, 0 = 暂停) / 鼠标位置 / 面板位置与尺寸",
            "设置项持久化到 ComfyUI 设置 (无 API 时回退 localStorage)",
            "",
            "本 ? 按钮:",
            "单击复制本段帮助文本到剪贴板",
            "双击打开项目 GitHub 仓库:",
            REPO_URL,
        ].join("\n"),
        langTip: "界面语言",
        rateTip: "刷新率 (0-" + RATE_MAX + " Hz, 0 = 暂停)",
        opacityTip: "面板不透明度 (" + MIN_OPACITY + "-" + MAX_OPACITY + "%)",
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
        removeRecordTip: "删除该条记录",
        recordRemoved: "已删除该条记录",
        removeFail: (m) => `删除失败: ${m}`,
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
        helpCopied: "帮助文本已复制到剪贴板",
        helpCopyFail: "复制失败",
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
        openNoFile: "模型文件已不在磁盘上",
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

// "#rrggbb" 颜色解析为 [r, g, b] 数值数组, 供颜色插值运算.
// 兼容 8 位 "#rrggbbaa": alpha 段被忽略并输出警告 (插值仅支持不透明色),
// 避免映射层误用带透明度色值时面板构造整体失败
function hexRgb(hex) {
    if (/^#[0-9a-fA-F]{8}$/.test(hex)) {
        console.warn(`[comfyui_dynamic] hexRgb: alpha part ignored (interpolation needs opaque color): ${hex}`);
        hex = hex.slice(0, 7);
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(hex))
        throw new Error(`invalid color: ${hex}`);
    return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}

// 颜色线性混合: 两个 "#rrggbb" 颜色按 t (0-1) 从 a 混到 b, 返回 rgb() 字符串
function mixColor(a, b, t) {
    const ca = hexRgb(a);
    const cb = hexRgb(b);
    const ch = (i) => Math.round(ca[i] + (cb[i] - ca[i]) * t);
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
    // 超时中断: fetchBusy 仅在 promise settle 后复位, 无超时的挂起连接会让
    // 轮询静默停摆 (失败退避机制也无从介入); 超时按普通失败计入退避计数
    const res = await fetch(`${API_BASE}/stats`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
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
/* 颜色变量体系:
    - 全部颜色 (含阴影) 由文件顶部映射层 (ForegroundColors / BackgroundColors / BorderColors /
      ShadowColors) 经 injectStyle() 注入, 变量名派生规则 --dynmon-<组前缀>-<kebab(key)>;
    - 本文件不出现任何颜色字面量, 调色请到映射层与颜色层;
    - 此处仅保留非颜色的布局变量 (z-index 等). */
:root {
    /* 层级 */
    --dynmon-z-panel: 99990;
    --dynmon-z-tip: 99999;
}
.dynmon-panel { position: fixed; bottom: 10px; right: 10px; width: var(--dynmon-w-default); height: var(--dynmon-h-default);
    min-width: 280px; min-height: 120px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px);
    display: flex; flex-direction: column;
    background: var(--dynmon-background-panel); border: 1px solid var(--dynmon-border-panel); border-radius: 8px; overflow: hidden;
    box-shadow: var(--dynmon-shadow-panel); z-index: var(--dynmon-z-panel); resize: both;
    color: var(--dynmon-foreground-panel); font-family: sans-serif; font-size: 12px; user-select: none; }
/* 垂直最大化: 高度撑满窗口 (上下边距经 --dynmon-vmax-h 扣除), !important 覆盖内联高度;
   需置于 .dynmon-min 之前: 两类同特异性, 后者 (height auto) 胜出, 保证最小化始终优先 */
.dynmon-panel.dynmon-vmax { height: var(--dynmon-vmax-h) !important; }
.dynmon-panel.dynmon-min { min-width: 0; min-height: 0; max-width: none; max-height: none;
    width: auto !important; height: auto !important; resize: none; }
/* 折叠后仅剩标题栏: 隐藏与主体间的分界线 (标题栏渐变循环仅内联写边框颜色,
   不影响此处的宽度/样式, 故本规则在折叠期间始终生效) */
.dynmon-panel.dynmon-min .dynmon-header { border-bottom: none; }
.dynmon-header { display: flex; align-items: center; gap: 8px; padding: 6px 10px;
    background: var(--dynmon-background-header); border-bottom: 1px solid var(--dynmon-border-header); cursor: move; flex: none; white-space: nowrap; }
.dynmon-title { font-weight: 600; font-size: 12px; }
.dynmon-subtitle { font-size: 10px; color: var(--dynmon-foreground-subtitle); }
.dynmon-min .dynmon-subtitle { display: none; }
.dynmon-alert { font-size: 10px; color: var(--dynmon-foreground-alert); overflow: hidden; text-overflow: ellipsis; }
.dynmon-min .dynmon-alert { display: none; }
.dynmon-hbtn { background: transparent; border: none; color: var(--dynmon-foreground-header-button); cursor: pointer;
    font-size: 13px; line-height: 1; padding: 2px 4px; }
.dynmon-hbtn:hover { color: var(--dynmon-foreground-header-button-hover); }
.dynmon-hbtn svg { display: block; }
/* 标题栏状态图标 (主标题左侧): 常态继承标题文本色, 告警态切换为告警前景色 */
.dynmon-hicon { display: inline-flex; align-items: center; flex: none; color: inherit; }
.dynmon-hicon svg { display: block; }
.dynmon-hicon.dynmon-hicon-alert { color: var(--dynmon-foreground-alert); }
/* 点击穿透: 面板整体放行全部鼠标事件 (pointer-events: none 仅影响命中测试,
   按钮事件仍可冒泡至面板监听器), 仅穿透切换按钮保留交互 */
.dynmon-panel.dynmon-passthrough { pointer-events: none; }
.dynmon-panel.dynmon-passthrough .dynmon-hbtn[data-hact="passthrough"] { pointer-events: auto; }
.dynmon-hbtns { display: flex; align-items: center; gap: 2px; }
.dynmon-hspring { flex: 1; }
.dynmon-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }
.dynmon-cards { flex: none; display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; padding: 8px 8px 0; }
.dynmon-card { background: var(--dynmon-background-card); border: 1px solid var(--dynmon-border-card); border-radius: 6px; padding: 5px 7px; min-width: 0;
    transition: background-color .25s linear, border-color .25s linear; }
.dynmon-card-label { font-size: 9px; color: var(--dynmon-foreground-card-label); letter-spacing: .3px; }
.dynmon-card-value { font-size: 13px; font-weight: 600; margin: 2px 0; }
.dynmon-card-sub { font-size: 9px; color: var(--dynmon-foreground-card-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dynmon-bar { height: 3px; background: var(--dynmon-background-card-usage-track); border-radius: 2px; margin-top: 4px; overflow: hidden; }
.dynmon-bar > i { display: block; height: 100%; width: 0%; transition: width .2s; }
.dynmon-devices { flex: none; padding: 4px 10px 0; font-size: 10px; color: var(--dynmon-foreground-devices); }
.dynmon-devices > div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dynmon-chartwrap { flex: none; padding: 8px 8px 0; }
.dynmon-chartwrap canvas { width: 100%; height: 140px; display: block; background: var(--dynmon-background-chart-canvas); border: 1px solid var(--dynmon-border-chart-canvas); border-radius: 6px; }
.dynmon-legend { flex: none; display: flex; gap: 10px; padding: 4px 10px 0; font-size: 10px; color: var(--dynmon-foreground-legend); flex-wrap: wrap; }
.dynmon-legend .dynmon-dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
.dynmon-actions { flex: none; display: flex; align-items: center; gap: 6px; padding: 6px 8px; flex-wrap: wrap; }
/* 操作按钮与模型筛选下拉框同为控件, 但按映射层约定各自持有独立颜色项, 故拆分设色 */
.dynmon-actions button, .dynmon-select { border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; outline: none; flex: none; }
.dynmon-actions button { background: var(--dynmon-background-action-button); color: var(--dynmon-foreground-action-button); border: 1px solid var(--dynmon-border-action-button); }
.dynmon-actions button:hover { background: var(--dynmon-background-action-button-hover); border-color: var(--dynmon-border-action-button-hover); }
.dynmon-aggr { display: inline-flex; align-items: center; gap: 3px; font-size: 10px; color: var(--dynmon-foreground-aggressive-toggle); cursor: pointer; flex: none; }
.dynmon-actions-right { margin-left: auto; display: inline-flex; gap: 6px; flex: none; }
.dynmon-select { width: 120px; background: var(--dynmon-background-model-select); color: var(--dynmon-foreground-model-select); border: 1px solid var(--dynmon-border-model-select); }
.dynmon-models { padding: 0 8px 8px; }
/* 列表区: 已加载/已卸载两分区的共同父容器, 承载二者合计的可分配垂直空间;
   已卸载区的 max-height 50% 以本容器为基准解析, 语义为 "列表区的一半" 而非整个内容区的一半
   (无此包裹层时 50% 按整个内容区解析, 固定元素越高偏差越大) */
.dynmon-lists { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.dynmon-loaded-sec { flex: 1 1 auto; min-height: 60px; display: flex; flex-direction: column; }
/* 已卸载区: 未展开/条目少时保持内容高度 (flex none, 已加载区 flex 1 1 auto 吃掉全部剩余空间);
   条目多时封顶列表区一半高度 (max-height 50% 以 .dynmon-lists 为基准), 超出部分转入列表内部滚动,
   顶部灰色分隔线增强与已加载列表的分界可读性 */
.dynmon-unloaded-sec { flex: none; max-height: 50%; display: flex; flex-direction: column;
    background: var(--dynmon-background-unloaded-section);
    border-top: 1px solid var(--dynmon-border-unloaded-section-divider); }
.dynmon-unloaded-sec .dynmon-list { flex: 0 1 auto; overflow-y: auto; min-height: 0; }
.dynmon-sec-head { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--dynmon-foreground-section-header); padding: 2px; cursor: pointer; }
.dynmon-sec-head:hover { color: var(--dynmon-foreground-section-header-hover); }
.dynmon-chev { font-size: 9px; width: 10px; display: inline-block; transition: transform .15s; }
.dynmon-sec-collapsed .dynmon-chev { transform: rotate(-90deg); }
.dynmon-sec-collapsed .dynmon-list { display: none; }
.dynmon-sec-btn { background: transparent; color: var(--dynmon-foreground-unload-all-button); border: 1px solid var(--dynmon-border-unload-all-button); border-radius: 4px;
    width: 22px; height: 20px; display: inline-flex; align-items: center; justify-content: center;
    cursor: pointer; padding: 0; margin-left: auto; }
.dynmon-sec-btn:hover { color: var(--dynmon-foreground-unload-all-button-hover); border-color: var(--dynmon-border-unload-all-button-hover); }
.dynmon-list { display: flex; flex-direction: column; gap: 4px; }
.dynmon-loaded-sec .dynmon-list { flex: 1 1 auto; overflow-y: auto; min-height: 40px; }
.dynmon-row { border: 1px solid var(--dynmon-border-row); border-radius: 6px; padding: 5px 8px; cursor: copy; flex: none;
    transition: background-color .2s linear, border-color .2s linear; }
.dynmon-row:hover { border-color: var(--dynmon-border-row-hover); }
.dynmon-row-top { display: flex; align-items: center; gap: 5px; min-width: 0; }
.dynmon-loc { font-size: 9px; padding: 1px 5px; border-radius: 3px; flex: none; }
.dynmon-loc-vram { background: var(--dynmon-background-location-vram); color: var(--dynmon-foreground-location-vram); }
.dynmon-loc-ram { background: var(--dynmon-background-location-ram); color: var(--dynmon-foreground-location-ram); }
.dynmon-loc-partial { background: var(--dynmon-background-location-partial); color: var(--dynmon-foreground-location-partial); }
.dynmon-loc-removed { background: var(--dynmon-background-location-removed); color: var(--dynmon-foreground-location-removed); }
.dynmon-class { font-size: 9px; padding: 1px 5px; border-radius: 3px; background: var(--dynmon-background-class-badge); color: var(--dynmon-foreground-class-badge); flex: none; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dynmon-fname { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--dynmon-foreground-file-name); }
.dynmon-fname-unknown { color: var(--dynmon-foreground-file-name-unknown); font-style: italic; }
.dynmon-size { flex: none; font-size: 10px; color: var(--dynmon-foreground-size); }
.dynmon-vbar { height: 4px; border-radius: 2px; background: var(--dynmon-background-row-usage-track); margin-top: 4px; overflow: hidden; display: flex; }
.dynmon-vbar > i { display: block; height: 100%; }
.dynmon-row-bottom { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.dynmon-sub { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; color: var(--dynmon-foreground-sub-text); }
.dynmon-time { flex: none; font-size: 9px; color: var(--dynmon-foreground-timestamp); font-variant-numeric: tabular-nums; }
.dynmon-row-btns { display: flex; gap: 4px; flex: none; }
.dynmon-row-btns button { background: transparent; color: var(--dynmon-foreground-row-button); border: 1px solid var(--dynmon-border-row-button); border-radius: 4px;
    width: 22px; height: 20px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
.dynmon-row-btns button:hover { color: var(--dynmon-foreground-row-button-hover); border-color: var(--dynmon-border-row-button-hover); }
/* 卸载按钮与删除记录按钮共用同一红色样式 (两列表第三按钮外观完全对称, 仅功能不同) */
.dynmon-row-btns button[data-act="unload"], .dynmon-row-btns button[data-act="remove"] { color: var(--dynmon-foreground-unload-button); border-color: var(--dynmon-border-unload-button); }
.dynmon-row-btns button[data-act="unload"]:hover, .dynmon-row-btns button[data-act="remove"]:hover { color: var(--dynmon-foreground-unload-button-hover); border-color: var(--dynmon-border-unload-button-hover); }
.dynmon-row-btns button:disabled { opacity: .35; cursor: not-allowed; }
.dynmon-row-btns button:disabled:hover { color: var(--dynmon-foreground-row-button); border-color: var(--dynmon-border-row-button); } /* disabled hover 恢复常态色 */
.dynmon-row-btns button:disabled[data-act="unload"]:hover, .dynmon-row-btns button:disabled[data-act="remove"]:hover { color: var(--dynmon-foreground-unload-button); border-color: var(--dynmon-border-unload-button); }
.dynmon-busy .dynmon-row-btns button[data-act="unload"] { opacity: .35; }
.dynmon-empty { font-size: 11px; color: var(--dynmon-foreground-empty-hint); text-align: center; padding: 10px; }
.dynmon-tooltip { position: fixed; z-index: var(--dynmon-z-tip); background: var(--dynmon-background-tooltip); border: 1px solid var(--dynmon-border-tooltip); color: var(--dynmon-foreground-tooltip); font-size: 11px; line-height: 1.5; padding: 8px 10px; border-radius: 6px; pointer-events: none; white-space: pre-wrap; word-break: break-all; overflow-wrap: anywhere; display: none; min-width: 120px; max-width: 480px; box-shadow: var(--dynmon-shadow-tooltip); }
.dynmon-tip-sep { border-top: 1px solid var(--dynmon-border-tooltip-separator); margin: 4px 0; }
.dynmon-msgbar { flex: none; height: 18px; line-height: 18px; padding: 0 8px; font-size: 10px; color: var(--dynmon-foreground-message-info);
    background: var(--dynmon-background-message-bar); border-top: 1px solid var(--dynmon-border-card); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dynmon-msgbar.dynmon-status-err { color: var(--dynmon-foreground-message-error); }
.dynmon-statusbar { display: flex; align-items: stretch; flex: none; font-size: 10px; color: var(--dynmon-foreground-status-bar);
    border-top: 1px solid var(--dynmon-border-card); background: var(--dynmon-background-status-bar); white-space: nowrap; }
.dynmon-sb-item { display: flex; align-items: center; gap: 4px; padding: 4px 8px; border-left: 1px solid var(--dynmon-border-status-bar-item-separator); flex: none; }
.dynmon-sb-item:first-child { border-left: none; }
.dynmon-sb-spring { flex: 1 1 auto; min-width: 0; overflow: hidden; }
.dynmon-lang { background: var(--dynmon-background-lang-select); color: var(--dynmon-foreground-lang-select); border: 1px solid var(--dynmon-border-lang-select); border-radius: 3px; font-size: 10px; padding: 1px 2px; cursor: pointer; outline: none; }
.dynmon-rate-stepper { display: inline-flex; border: 1px solid var(--dynmon-border-rate-stepper); border-radius: 3px; overflow: hidden; }
.dynmon-rate-btn { background: var(--dynmon-background-rate-button); color: var(--dynmon-foreground-rate-button); border: none; width: 16px; height: 16px; line-height: 1; font-size: 11px; cursor: pointer; padding: 0; }
.dynmon-rate-btn + .dynmon-rate-btn { box-shadow: inset 1px 0 0 var(--dynmon-border-rate-stepper-divider); }
.dynmon-rate-btn:hover { color: var(--dynmon-foreground-rate-button-hover); background: var(--dynmon-background-rate-button-hover); }
.dynmon-opacity { width: 56px; accent-color: var(--dynmon-foreground-opacity-slider); cursor: pointer; padding: 0; margin: 0; }
.dynmon-rate-input { width: 30px; background: var(--dynmon-background-rate-input); color: var(--dynmon-foreground-rate-input); border: 1px solid var(--dynmon-border-rate-input); border-radius: 3px; font-size: 10px; text-align: center; padding: 1px 0; outline: none; }
.dynmon-rate-input::-webkit-inner-spin-button, .dynmon-rate-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.dynmon-rate-input { -moz-appearance: textfield; appearance: textfield; }
.dynmon-sb-val { color: var(--dynmon-foreground-status-bar-value); }
.dynmon-panel:not(.dynmon-min) .dynmon-resize-hint { position: absolute; right: 0; bottom: 0; width: 14px; height: 14px; cursor: nwse-resize; }
`;

function injectStyle() {
    if (document.getElementById("dynmon-style"))
        return;
    const style = document.createElement("style");
    style.id = "dynmon-style";
    style.textContent = CSS;
    document.head.appendChild(style);

    // 共享变量注入 [JS]: CSS 中不带默认值的 --dynmon-* 变量统一由此注入,
    // 保证 JS 常量是唯一数据源 (改常量后 CSS 自动跟随, 不存在双份定义)
    const root = document.documentElement.style;
    root.setProperty("--dynmon-w-default", `${DEFAULT_W}px`);   // 面板默认尺寸
    root.setProperty("--dynmon-h-default", `${DEFAULT_H}px`);
    root.setProperty("--dynmon-vmax-h", `calc(100vh - ${VMAX_MARGIN_Y * 2}px)`); // 垂直最大化高度
    // 颜色变量: 遍历映射层静态类批量注入, 变量名派生规则 --dynmon-<组前缀>-<kebabCase(键)>;
    // SeriesColors 仅 JS 内联引用 (折线图绘制), 不注入 CSS
    const injected = new Set(["--dynmon-w-default", "--dynmon-h-default", "--dynmon-vmax-h"]);
    for (const [cls, prefix] of COLOR_GROUPS) {
        for (const key of Object.getOwnPropertyNames(cls)) {
            if (CLASS_BUILTIN_KEYS.has(key) || typeof cls[key] !== "string")
                continue;
            const name = `--dynmon-${prefix}-${kebabCase(key)}`;
            root.setProperty(name, cls[key]);
            injected.add(name);
        }
    }
    // 校验: CSS 引用的 --dynmon-* 变量必须已有定义 (JS 注入或 CSS 内置), 防止改名后拼写漂移
    const defined = new Set(injected);
    for (const m of CSS.matchAll(/(--dynmon-[a-z0-9-]+)\s*:/g))
        defined.add(m[1]);
    for (const m of CSS.matchAll(/var\((--dynmon-[a-z0-9-]+)\)/g))
        if (!defined.has(m[1]))
            console.warn(`[comfyui_dynamic] undefined CSS variable: ${m[1]}`);
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

function buildDetailText(m, t, isRemoved = false) {
    const pct = m.size > 0 ? Math.round((m.loaded / m.size) * 100) : 0;
    const lines = [`${m.class}${m.filename ? ` - ${m.filename}` : ""}`];
    if (m.path)
        lines.push(`${t.detailPath}: ${m.path}`);
    else
        lines.push(`${t.detailPath}: unknown`);
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
    lines.push(`UUID: ${m.uuid}`);
    return lines.join("\n");
}


// ============================================================
// 浮动监控面板 (单例)
// ============================================================

class MonitorPanel {
    constructor() {
        this.lang = getSetting(SETTING_ID__LANG, DEFAULT_LANG) === "zh" ? "zh" : "en";
        this.rate = clamp(parseInt(getSetting(SETTING_ID__RATE, DEFAULT_RATE), 10) || 0, RATE_MIN, RATE_MAX);
        this.paused = this.rate === 0; // 初始刷新率为 0 时视为暂停态
        this.enabled = true;
        this.lastUpdated = -1e9;
        this.history = [];       // 折线图历史: { cpu, ram, gpu, vram, cpu_temp, gpu_temp }
        this.busy = false;
        this.lastCpuCores = null; // 卡片 tooltip 用的最近元信息
        this.lastGpuName = "";
        this.modelByUuid = new Map();
        this.rowByUuid = new Map();
        this.modelsSignature = null;
        this.errorShown = false;
        this.statusTimer = null;
        this.helpClickAt = 0;     // 帮助按钮上一次点击时刻 (双击判定, 见 handleHelpClick)
        this.helpClickTimer = null; // 挂起的单击复制动作定时器
        this.minimized = false;  // 最小化状态 (显式初始化, 不依赖 undefined 隐式行为)
        this.vmax = false;       // 垂直最大化状态 (高度撑满窗口, 见 setVerticalMax)
        this.passthrough = false;       // 点击穿透开关 (开启时面板放行除切换按钮外的全部鼠标事件)
        this.autoMinPrevDocked = false; // 弹窗触发自动最小化前的停靠状态 (关闭弹窗后完整还原用)
        this.savedSize = null;   // 最小化前的尺寸 { w, h }
        this.savedVMaxSize = null; // 垂直最大化前的内联高度原值 (style.height, 还原用)
        this.savedVMaxTop = null;  // 垂直最大化前的内联 top 快照 (还原兜底, 浮动态优先用 floatPos 记忆)
        this.docked = false;     // 是否处于停靠模式 (左下角, 随窗口尺寸变化保持贴合)
        this.floatPos = null;    // 浮动状态坐标记忆 { left, top } (仅浮动态更新, 供退出停靠时恢复)
        this.opacity = clamp(parseInt(getSetting(SETTING_ID__OPACITY, DEFAULT_OPACITY), 10) || DEFAULT_OPACITY,
            MIN_OPACITY, MAX_OPACITY); // 面板不透明度 (MIN_OPACITY - MAX_OPACITY %)
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

        // 标题栏颜色状态机: 调用方只通过 setHdrTarget 发布目标色 (BackgroundColors 中 header*
        // 系列为 "#RRGGBB" 字符串, VSC 可预览), 初始时解析为数值; 渐变由统一循环插值
        // (State + Tween 模式: 目标值发布与渲染解耦, 单一 ticker 消费目标状态)
        this.hdrApplied = false; // 稳态短路标志: 颜色已到位且目标未变时跳过每帧样式写入
        this.hdrCur = hexRgb(BackgroundColors.header);
        this.hdrFrom = this.hdrCur.slice();
        this.setHdrTarget(BackgroundColors.header, performance.now());
        this.hdrMinAt = -1e9; // 上次最小化时刻 (蓝色闪动窗口判定用)

        injectStyle();
        this.buildDom();
        this.bindEvents();
        this.applyI18n();
        this.syncRateDisplay();
        this.applyOpacity();
        this.initHeaderFx();
        // 初始即停靠左下角 (与重置按钮一致; 无浮动记忆, 退出停靠时原地转为浮动)
        this.dockBottomLeft();
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
                <span class="dynmon-hicon"></span>
                <span class="dynmon-title"></span>
                <span class="dynmon-subtitle"></span>
                <span class="dynmon-alert"></span>
                <span class="dynmon-hspring"></span>
                <span class="dynmon-hbtns">
                    <button class="dynmon-hbtn" data-hact="help" title="">?</button>
                    <button class="dynmon-hbtn" data-hact="passthrough" title=""></button>
                    <button class="dynmon-hbtn" data-hact="pause" title=""></button>
                    <button class="dynmon-hbtn" data-hact="reset" title="">↺</button>
                    <button class="dynmon-hbtn" data-hact="dock" title="">↙</button>
                    <button class="dynmon-hbtn" data-hact="vmax" title=""></button>
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
                <div class="dynmon-lists">
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
            </div>
            <div class="dynmon-msgbar"></div>
            <div class="dynmon-statusbar">
                <div class="dynmon-sb-item">
                    <select class="dynmon-lang" title="Language / 语言">
                        <option value="en">EN</option>
                        <option value="zh">中文</option>
                    </select>
                </div>
                <div class="dynmon-sb-item"><input class="dynmon-opacity" type="range" min="${MIN_OPACITY}" max="${MAX_OPACITY}" step="5"></div>
                <div class="dynmon-sb-item dynmon-rate-group">
                    <span class="dynmon-rate-stepper">
                        <button class="dynmon-rate-btn" data-rate="-1">-</button>
                        <button class="dynmon-rate-btn" data-rate="1">+</button>
                    </span>
                    <input class="dynmon-rate-input" type="number" min="${RATE_MIN}" max="${RATE_MAX}" step="1">
                    <span>Hz</span>
                </div>
                <div class="dynmon-sb-item dynmon-sb-spring"></div>
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
        this.hiconEl = panel.querySelector(".dynmon-hicon");           // 主标题左侧状态图标
        this.passthroughBtn = panel.querySelector('[data-hact="passthrough"]');
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
        this.vmaxBtn = panel.querySelector('[data-hact="vmax"]');
        this.minBtn = panel.querySelector('[data-hact="min"]');
        this.ramBtn = panel.querySelector('[data-act="clean-ram"]');
        this.vramBtn = panel.querySelector('[data-act="clean-vram"]');
        this.aggrLabel = panel.querySelector(".dynmon-aggr-label");
        this.contentEl = panel.querySelector(".dynmon-content");
        this.devicesEl = panel.querySelector(".dynmon-devices");
        this.canvas = panel.querySelector("canvas");
        this.ctx = this.canvas.getContext("2d");
        this.msgEl = panel.querySelector(".dynmon-msgbar"); // 独立消息行 (状态栏上方)
        this.opacityInput = panel.querySelector(".dynmon-opacity");
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
        this.tipRow = null; // tooltip 当前关联行 (行移除/列表重建时联动隐藏)
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
        // 标题栏按钮: 帮助 / 暂停 / 重置 / 停靠 / 垂直最大化 / 最小化
        this.panel.addEventListener("click", (e) => {
            const btn = e.target.closest(".dynmon-hbtn[data-hact]");
            if (!btn)
                return;
            e.stopPropagation();
            const act = btn.dataset.hact;
            if (act === "help")
                this.handleHelpClick();
            else if (act === "pause")
                this.togglePause();
            else if (act === "reset")
                this.resetLayout();
            else if (act === "dock")
                this.toggleDock();
            else if (act === "vmax")
                this.toggleVerticalMax();
            else if (act === "passthrough")
                this.setPassthrough(!this.passthrough);
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

        // 标题栏拖动与双击 (自定义状态机, 不使用内置 dblclick: 其判定阈值不可定制,
        // 且与拖动状态无关联, 无法实现拖动清除点击记忆):
        // - pointerdown: 记录按下点与抓取偏移 (相对位置自此固定), 并做双击判定
        //   (与上一次按下间隔 < DRAG_DBL_MS 即切换最小化并清空点击记忆)
        // - pointermove: 位移超过 DRAG_MOVE_PX (不含) 才进入拖动, 进入时清除点击记忆
        //   (被拖动的按压不计入点击序列); 拖动全程保持按下时刻的相对位置
        // - pointerup/cancel: 结束按压, 无位移的按压自然成为下一次双击判定的记忆
        // 健壮性: setPointerCapture 保证鼠标移出窗口/卡顿丢事件时仍能收到抬起消息;
        // pointercancel 与 buttons 位掩码检查兜底, 杜绝拖动状态卡死
        let downX = 0, downY = 0;
        let dragX = 0, dragY = 0, dragging = false, dragId = -1;
        let lastPressAt = 0; // 上一次按下的时刻, 双击判定用 (拖动 / 触发双击 / 取消时清零)
        const onMove = (ev) => {
            if (ev.pointerId !== dragId)
                return;
            // 左键已物理松开但 pointerup 丢失 (卡顿场景): 立即结束拖动
            if (!(ev.buttons & 1)) {
                endDrag();
                return;
            }
            if (!dragging) {
                // 位移未超过阈值: 仍处于按下状态, 面板保持不动
                if (Math.hypot(ev.clientX - downX, ev.clientY - downY) <= DRAG_MOVE_PX)
                    return;
                dragging = true;
                lastPressAt = 0; // 拖动清除点击记忆
                // 停靠态拖动 = 退出停靠且不恢复记忆 (拖动位置随即覆盖浮动记忆, 逻辑上等效)
                if (this.docked)
                    this.exitDock(false);
            }
            this.positioned = true;
            this.panel.style.left = `${ev.clientX - dragX}px`;
            // 垂直最大化: 高度由窗口决定, 拖动仅水平移动 (垂直位置锁定在最大化位置)
            if (!this.vmax)
                this.panel.style.top = `${ev.clientY - dragY}px`;
            this.panel.style.right = "auto";
            this.panel.style.bottom = "auto";
            this.clampHeaderIntoWindow();
        };
        const endDrag = () => {
            if (dragId === -1)
                return;
            dragging = false;
            dragId = -1;
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
            document.removeEventListener("pointercancel", onCancel);
            this.updatePosSizeLabels();
        };
        const onUp = (ev) => {
            if (ev.pointerId !== dragId)
                return;
            endDrag();
        };
        const onCancel = (ev) => {
            if (ev.pointerId !== dragId)
                return;
            const wasDragging = dragging;
            endDrag();
            if (!wasDragging)
                lastPressAt = 0; // 被系统中断的按压不应计入点击序列
        };
        this.headerEl.addEventListener("pointerdown", (e) => {
            if (e.target.closest(".dynmon-hbtn"))
                return;
            if (e.button !== 0)
                return; // 仅左键拖动
            // 双击判定 (按下时触发, 与操作系统窗口管理一致): 与上一次按下间隔足够近即切换最小化;
            // 触发后该次按压被完全吞掉, 不进入按压状态 (不记录抓取偏移 / 不注册监听),
            // 与 Windows 行为一致: 双击后按住移动不会转为拖动; 记忆已清零, 三连击不会连续判定
            const now = performance.now();
            if (now - lastPressAt < DRAG_DBL_MS) {
                lastPressAt = 0;
                this.setMinimized(!this.minimized);
                return;
            }
            lastPressAt = now;
            dragId = e.pointerId;
            downX = e.clientX;
            downY = e.clientY;
            // 抓取偏移在按下时刻固定: 拖动全程保持按下时标题栏与指针的相对位置
            dragX = e.clientX - this.panel.offsetLeft;
            dragY = e.clientY - this.panel.offsetTop;
            try {
                // 捕获指针: 后续 move/up 定向派发, 窗口外松开也能收到 (事件仍冒泡至 document)
                this.headerEl.setPointerCapture(e.pointerId);
            } catch {
                // 指针已失效: 忽略, document 级监听 + buttons 检查兜底
            }
            document.addEventListener("pointermove", onMove);
            document.addEventListener("pointerup", onUp);
            document.addEventListener("pointercancel", onCancel);
        });

        // 浏览器窗口缩放: 停靠态重新贴合左下角, 浮动态夹取回窗口内
        window.addEventListener("resize", () => {
            if (this.docked)
                this.applyDockPosition();
            else
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
                this.renderRowTip(row.dataset.tip);
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
            setSetting(SETTING_ID__LANG, this.lang);
            this.applyI18n();
            this.refreshLayout(); // 轻量刷新: 强制回流 + 派生布局重算, 消除切换后的一次性位移
        });

        // 面板透明度滑动条: 拖动实时应用, 松手时持久化 (MIN_OPACITY - MAX_OPACITY %)
        this.opacityInput.addEventListener("input", () => {
            this.opacity = clamp(parseInt(this.opacityInput.value, 10) || DEFAULT_OPACITY, MIN_OPACITY, MAX_OPACITY);
            this.panel.style.opacity = `${this.opacity / 100}`;
        });
        this.opacityInput.addEventListener("change", () => {
            setSetting(SETTING_ID__OPACITY, this.opacity);
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
        // 垂直最大化: 垂直位置恒为最大化顶边, 不做夹取计算
        const top = this.vmax ? VMAX_MARGIN_Y
            : clamp(this.panel.offsetTop, EDGE, window.innerHeight - h - EDGE);
        this.panel.style.left = `${left}px`;
        this.panel.style.top = `${top}px`;
        // 仅浮动态更新记忆坐标 (停靠态不覆盖, 保证退出停靠能回到原浮动位置);
        // 垂直最大化: floatPos 的垂直记忆保留不擦除 (顶边不是用户的浮动位置记忆,
        // 水平随拖动/夹取正常刷新)
        if (!this.docked) {
            const memTop = this.vmax && this.floatPos ? this.floatPos.top : top;
            this.floatPos = { left, top: memTop };
        }
    }

    // 重置 = 恢复默认尺寸 + 进入停靠模式 (与初始位置语义一致)
    resetLayout() {
        if (this.minimized)
            this.setMinimized(false);
        this.setVerticalMax(false); // 先退出垂直最大化, 避免类样式 !important 覆盖下面的内联高度
        this.panel.style.width = `${DEFAULT_W}px`;
        this.panel.style.height = `${DEFAULT_H}px`;
        this.dockBottomLeft();
    }

    // 垂直最大化开关 (on = 高度撑满窗口, 上下各留 VMAX_MARGIN_Y; 类似 Windows 顶边双击的垂直最大化):
    // 以 CSS 类 + !important 实现, 内联高度原样保留 (还原时直接恢复, 不做计算备份);
    // 记录内联 top 作恢复兜底; 浮动态还原时垂直位置以 floatPos 记忆为准 (vmax 期间可能停靠往返),
    // 停靠态由 applyDockPosition 依新高度重贴;
    // 与最小化互斥: 折叠态点击最大化先展开, 最小化时先退出最大化 (均经 setMinimized/setVerticalMax 入口保证)
    setVerticalMax(on) {
        if (this.vmax === on)
            return;
        // 折叠态点击最大化: 先展开再最大化 (与 Windows 对最小化窗口点击最大化等效);
        // 否则 dynmon-min 的 height auto !important (规则置后) 会压过 dynmon-vmax, 面板保持折叠
        if (on && this.minimized)
            this.setMinimized(false);
        this.vmax = on;
        const panel = this.panel;
        if (on) {
            this.savedVMaxSize = panel.style.height; // 内联高度原值 (含原生 resize 写入的值)
            this.savedVMaxTop = panel.style.top;
            panel.classList.add("dynmon-vmax");
            if (!this.docked)
                panel.style.top = `${VMAX_MARGIN_Y}px`; // 顶边对齐窗口上缘, 高度变量补足撑满
        } else {
            panel.classList.remove("dynmon-vmax");
            if (this.savedVMaxSize !== null)
                panel.style.height = this.savedVMaxSize;
            // 垂直位置恢复: 浮动态以 floatPos 记忆为准 (savedVMaxTop 是按下最大化那一刻的
            // top 快照, vmax 期间经历停靠往返后已过期; floatPos 垂直分量在 vmax 态被完整保留),
            // 无 floatPos 时回退快照; 停靠态由下方 applyDockPosition 重算, 快照恢复随即被覆盖
            if (!this.docked && this.floatPos)
                panel.style.top = `${this.floatPos.top}px`;
            else if (this.savedVMaxTop !== null)
                panel.style.top = this.savedVMaxTop;
        }
        // 位置随新尺寸重算: 停靠态重新贴合左下角, 浮动态夹取保证标题栏可见
        if (this.docked)
            this.applyDockPosition();
        else if (!this.minimized)
            this.clampHeaderIntoWindow();
        this.syncVMaxButton();
        this.updatePosSizeLabels();
    }

    toggleVerticalMax() {
        this.setVerticalMax(!this.vmax);
    }

    // 停靠/退出停靠切换 (箭头按钮): 箭头方向由 syncDockButton 依状态显示
    toggleDock() {
        if (!this.docked) {
            this.dockBottomLeft(); // 进入停靠 (最小化时即标题栏停靠)
            return;
        }
        // 退出停靠: 最小化时先展开 (保持停靠) 再退出, 恢复记忆位置
        if (this.minimized)
            this.setMinimized(false);
        this.exitDock();
    }

    // 进入停靠模式: 贴附左下角并随窗口尺寸变化保持; 不改动浮动记忆
    dockBottomLeft() {
        this.docked = true;
        this.positioned = true;
        this.applyDockPosition();
        this.syncDockButton();
        this.updatePosSizeLabels();
    }

    // 退出停靠模式: restore = true 时回到记忆坐标, 无记忆则原地转为浮动;
    // restore = false 用于停靠中拖动 (记忆位置随即被拖动值覆盖)
    exitDock(restore = true) {
        this.docked = false;
        if (restore && this.floatPos) {
            this.panel.style.left = `${this.floatPos.left}px`;
            // 垂直最大化: 垂直位置保持最大化顶边, floatPos 的垂直记忆仅保留不应用 (亦不擦除)
            this.panel.style.top = this.vmax ? `${VMAX_MARGIN_Y}px` : `${this.floatPos.top}px`;
        }
        this.syncDockButton();
        if (!this.minimized)
            this.clampHeaderIntoWindow(); // 窗口可能已变化, 恢复后夹取 (并刷新浮动记忆)
        this.updatePosSizeLabels();
    }

    // 停靠定位: 左侧避开 ComfyUI 左侧栏, 底部保持专用偏移常量
    applyDockPosition() {
        const sidebar = this.detectLeftSidebarWidth();
        const h = this.panel.offsetHeight;
        this.panel.style.right = "auto";
        this.panel.style.bottom = "auto";
        this.panel.style.left = `${sidebar + DOCK_OFFSET_X}px`;
        // 垂直最大化: 垂直位置恒为最大化顶边 (不经底部偏移反推, 该计算仅在边距常量
        // 恰好满足 2 * VMAX_MARGIN_Y == DOCK_OFFSET_Y + EDGE 时才与顶边语义一致)
        this.panel.style.top = this.vmax ? `${VMAX_MARGIN_Y}px`
            : `${Math.max(EDGE, window.innerHeight - h - DOCK_OFFSET_Y)}px`;
    }

    // 停靠按钮随状态同步 (箭头方向反映当前是否停靠, 而非点击动作);
    // 停靠状态变化来源多样 (按钮/最小化/拖动), 统一由状态驱动
    syncDockButton() {
        this.dockBtn.textContent = this.docked ? "\u2197" : "\u2199";
        this.dockBtn.title = this.t(this.docked ? "undockTip" : "dockTip");
    }

    // 垂直最大化按钮随状态同步 (还原形图标 = 当前处于最大化, 与 Windows 按钮图标约定一致)
    syncVMaxButton() {
        this.vmaxBtn.innerHTML = this.vmax ? ICONS.vmaxRestore : ICONS.vmax;
        this.vmaxBtn.title = this.t(this.vmax ? "vmaxRestoreTip" : "vmaxTip");
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
                    if (rect.width > SIDEBAR_PROBE_MIN_W && rect.left <= SIDEBAR_PROBE_MAX_LEFT
                        && rect.height > SIDEBAR_PROBE_MIN_H)
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
            // 最大化态先还原 (恢复内联高度/top 并同步按钮): savedSize 记录还原后的尺寸,
            // 折叠即退出最大化, 还原时回到最大化前的原始尺寸 (与 Windows 语义一致)
            if (this.vmax)
                this.setVerticalMax(false);
            this.savedSize = { w: panel.offsetWidth, h: panel.offsetHeight };
            panel.classList.add("dynmon-min");
            this.contentEl.style.display = "none";
            panel.querySelector(".dynmon-statusbar").style.display = "none";
            panel.querySelector(".dynmon-msgbar").style.display = "none";
            this.flashMinimize(); // 瞬时红色, 由标题栏状态机渐变为蓝色
            // 浮动态最小化: 标题栏同时停靠到左下角 (进入停靠模式, 不影响浮动记忆);
            // 已停靠时主体已折叠, 需以折叠后的标题栏高度重新贴合左下角
            if (!this.docked)
                this.dockBottomLeft();
            else
                this.applyDockPosition();
        } else {
            panel.classList.remove("dynmon-min");
            this.contentEl.style.display = "";
            panel.querySelector(".dynmon-statusbar").style.display = "";
            panel.querySelector(".dynmon-msgbar").style.display = "";
            if (this.savedSize) {
                panel.style.width = `${this.savedSize.w}px`;
                panel.style.height = `${this.savedSize.h}px`;
            }
            // 停靠态展开: 保持停靠模式, 以展开后的完整高度重新贴合左下角
            // (退出停靠仅由停靠按钮 / 拖动触发)
            if (this.docked)
                this.applyDockPosition();
        }
        this.minBtn.textContent = target ? "+" : "–";
        this.minBtn.title = target ? this.t("restoreTip") : this.t("minimizeTip");
        this.positioned = true;
        if (!this.docked)
            this.clampHeaderIntoWindow(); // 停靠态由 applyDockPosition 定位, 不做通用夹取
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

    // 面板透明度应用 (滑动条实时调用; tooltip 为面板子元素, 一并跟随透明度)
    applyOpacity() {
        this.opacityInput.value = String(this.opacity);
        this.panel.style.opacity = `${this.opacity / 100}`;
    }

    // 语言切换后的轻量刷新: 强制同步回流并重算派生布局状态.
    // 原生 DOM 无显式重渲染调用, 同步读取布局属性 (offsetHeight) 即引擎的强制重排入口,
    // 可冲掉文本替换后的悬空布局状态, 再重算依赖布局的派生值保证立即收敛
    refreshLayout() {
        void this.panel.offsetHeight; // 同步回流
        if (this.docked)
            this.applyDockPosition();
        else
            this.clampHeaderIntoWindow();
        this.updatePosSizeLabels();
        this.drawChart();
    }

    // ---------- i18n 应用 ----------

    applyI18n() {
        this.titleEl.textContent = this.t("title");
        this.syncSubtitle();   // 副标题受断连状态影响, 统一由该函数决定内容
        this.syncHeaderIcon(); // 状态图标随告警状态切换
        this.syncPauseButton();
        this.passthroughBtn.innerHTML = this.passthrough ? ICONS.pointer : ICONS.pointerOff;
        this.passthroughBtn.title = this.t(this.passthrough ? "passthroughTipOn" : "passthroughTipOff");
        // 问号按钮不设原生 title: 避免原生提示约 1s 后弹出并遮挡自定义帮助弹窗
        this.resetBtn.title = this.t("resetTip");
        this.syncDockButton();
        this.syncVMaxButton();
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
        this.opacityInput.title = this.t("opacityTip");
        this.mouseEl.title = this.t("mouseTip");
        this.posEl.title = this.t("posTip");
        this.sizeEl.title = this.t("sizeTip");
        this.msgEl.title = this.t("statusTip");

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
        this.rate = clamp(parseInt(value, 10) || 0, RATE_MIN, RATE_MAX);
        // 统一 paused 语义: rate=0 即暂停态 (与初始加载 rate=0 时的状态一致)
        this.paused = this.rate === 0;
        this.syncRateDisplay();
        this.syncPauseButton();
        setSetting(SETTING_ID__RATE, this.rate);
    }

    getPollIntervalMs() {
        return (!this.paused && this.rate > 0) ? 1000 / this.rate : Infinity;
    }

    // ---------- 标题栏颜色状态机 ----------
    // 模式说明: State + Tween. 调用方 (最小化 / 警告 / 恢复) 只发布目标色 (BackgroundColors
    // 中 header* 系列为 "#RRGGBB" 字符串, 便于 VSC 预览), 目标切换时经 setHdrTarget 解析一次为 [r, g, b] 数值,
    // 唯一的 ticker 循环负责把当前色向目标色线性插值并渲染, 插值路径无解析开销.

    // 启动标题栏渐变循环 (HEADER_TICK_MS 约等于 30fps, 足够平滑且开销可忽略)
    initHeaderFx() {
        this.hdrTimer = setInterval(() => this.headerTick(), HEADER_TICK_MS);
    }

    // 设置插值目标: 记录解析后的 [r, g, b] 与起点, 供 headerTick 逐帧插值
    setHdrTarget(hex, at) {
        this.hdrFrom = this.hdrCur.slice();
        this.hdrTargetHex = hex;
        this.hdrTarget = hexRgb(hex);
        this.hdrTargetAt = at;
    }

    headerTick() {
        if (!this.enabled)
            return;
        const now = performance.now();

        // 目标色优先级: 警告 (指标告警或后端断连) > 最小化保持色 (当前与常规色相同,
        // 闪红后回落, 展开前不参与告警/默认切换) > 默认
        let target = BackgroundColors.header;
        if (this.alertReasons.length > 0 || this.errorShown)
            target = BackgroundColors.headerAlert;
        else if (this.minimized)
            target = BackgroundColors.headerMinimized;

        // 目标切换时才重新记录起点并解析 (同一目标重复赋值不重置渐变进度)
        if (target !== this.hdrTargetHex)
            this.setHdrTarget(target, now);

        // 线性插值: 统一 0.5s 过渡时长
        const from = this.hdrFrom;
        const t = clamp((now - this.hdrTargetAt) / HEADER_FADE_MS, 0, 1);
        for (let i = 0; i < 3; i++)
            this.hdrCur[i] = Math.round(from[i] + (this.hdrTarget[i] - from[i]) * t);

        // 稳态短路: 插值已到位且上一帧已写入相同颜色时, 跳过每帧无效样式写入
        if (t >= 1 && this.hdrApplied)
            return;
        this.hdrApplied = t >= 1;
        const [r, g, b] = this.hdrCur;
        this.headerEl.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
        this.headerEl.style.borderBottomColor = `rgb(${Math.round(r * 0.6)}, ${Math.round(g * 0.6)}, ${Math.round(b * 0.6)})`;
    }

    // 最小化瞬间: 当前色立即置 headerMinimizeFlash 红 (不渐变), 之后由 ticker 渐变为保持色
    flashMinimize() {
        this.hdrMinAt = performance.now();
        this.hdrApplied = false; // 颜色瞬间跳变, 强制下一帧重写样式
        this.hdrCur = hexRgb(BackgroundColors.headerMinimizeFlash);
        this.setHdrTarget(BackgroundColors.headerMinimized, this.hdrMinAt);
    }

    // ---------- 标题栏图标 / 副标题 / 点击穿透 ----------

    // 标题栏状态图标随状态切换: 告警 (指标告警或后端断连) 时显示红色警告三角, 常态为仪表盘
    syncHeaderIcon() {
        const alert = this.alertReasons.length > 0 || this.errorShown;
        this.hiconEl.innerHTML = alert ? ICONS.headerAlert : ICONS.headerGauge;
        this.hiconEl.classList.toggle("dynmon-hicon-alert", alert);
    }

    // 副标题: 正常显示插件名, 后端断连时替换为断连提示 (恢复后由 applyStats 还原)
    syncSubtitle() {
        this.subtitleEl.textContent = this.errorShown ? this.t("backendDown") : this.t("subtitle");
    }

    // 点击穿透开关: 面板整体 pointer-events: none, 仅本按钮保留交互 (见 CSS .dynmon-passthrough).
    // 事件冒泡不受 pointer-events 影响 (其只作用于命中测试), 面板级点击监听器照常工作;
    // 穿透期间拖动/双击/其余按钮均失效, 属预期行为. 开关为运行时状态, 不做持久化
    setPassthrough(on) {
        this.passthrough = on;
        this.panel.classList.toggle("dynmon-passthrough", on);
        this.passthroughBtn.innerHTML = on ? ICONS.pointer : ICONS.pointerOff;
        this.passthroughBtn.title = this.t(on ? "passthroughTipOn" : "passthroughTipOff");
    }

    // ---------- 帮助按钮: 单击复制 / 双击打开仓库 ----------

    // 单击/双击分派: 自定义双击判定, 复用标题栏状态机的 DRAG_DBL_MS 窗口常量.
    // 首次点击后挂起单击动作至窗口结束; 窗口内出现第二次点击则取消单击并执行双击动作.
    // 悬浮提示 (helpText 预览) 由 mouseenter 独立处理, 与点击分派互不影响
    handleHelpClick() {
        const now = performance.now();
        if (now - this.helpClickAt < DRAG_DBL_MS) {
            // 双击: 取消挂起的单击复制, 打开项目仓库
            clearTimeout(this.helpClickTimer);
            this.helpClickAt = 0;
            this.helpClickTimer = null;
            window.open(REPO_URL, "_blank", "noopener");
            return;
        }
        this.helpClickAt = now;
        clearTimeout(this.helpClickTimer);
        this.helpClickTimer = setTimeout(() => {
            this.helpClickAt = 0;
            this.helpClickTimer = null;
            this.copyHelpText();
        }, DRAG_DBL_MS);
    }

    // 复制帮助文本到剪贴板 (与悬浮提示显示的内容一致), 复用全局 copyText 封装
    copyHelpText() {
        copyText(this.t("helpText"),
            () => this.flash(this.t("helpCopied")),
            () => this.flash(this.t("helpCopyFail"), true));
    }

    // ---------- 警告计算 ----------

    // 依据快照计算警告原因: 任一温度超 ALERT_TEMP_C / 显存告急 / 内存剩余低于 RAM_MIN_FREE_FRACTION
    computeAlerts(data) {
        const reasons = [];
        const hot = [];
        const cpuT = data.cpu?.temp;
        if (cpuT != null && cpuT > ALERT_TEMP_C)
            hot.push(`CPU ${round1(cpuT)}`);
        const gpuT = data.devices?.[0]?.temperature;
        if (gpuT != null && gpuT > ALERT_TEMP_C)
            hot.push(`GPU ${round1(gpuT)}`);
        if (hot.length)
            reasons.push(this.t("alertTemp", hot.join(", ")));

        const d = data.devices?.[0];
        // 显存告急仅对真实 GPU 设备判定 (CPU 设备的显存口径实为系统内存, 避免与 RAM 告警重复)
        if (d?.type === "cuda" && d.vram_total > 0) {
            // 显存溢出判定: 剩余 <= max(总量的 VRAM_MIN_FREE_FRACTION, VRAM_MIN_FREE_BYTES) 视为告急
            const free = d.vram_total - d.vram_used;
            const minFree = Math.max(d.vram_total * VRAM_MIN_FREE_FRACTION, VRAM_MIN_FREE_BYTES);
            if (free <= minFree)
                reasons.push(this.t("alertVram", fmtBytes(free)));
        }

        const ram = data.ram;
        if (ram?.total > 0 && ram.available / ram.total < RAM_MIN_FREE_FRACTION)
            reasons.push(this.t("alertRam", fmtBytes(ram.available)));
        return reasons;
    }

    // ---------- 状态反馈 ----------

    flash(message, isError = false) {
        // 消息显示在状态栏上方的独立消息行 (固定高度, 不挤压状态栏布局)
        this.msgEl.textContent = message;
        this.msgEl.classList.toggle("dynmon-status-err", isError);
        clearTimeout(this.statusTimer);
        this.statusTimer = setTimeout(() => {
            this.msgEl.textContent = "";
        }, MSG_CLEAR_MS);
    }

    onError() {
        // 连续轮询失败只提示一次, 恢复后由下一次成功数据覆盖
        if (this.errorShown)
            return;
        this.errorShown = true;
        this.flash(this.t("backendError"), true);
        this.syncSubtitle();   // 副标题切换为断连提示
        this.syncHeaderIcon(); // 图标切换为警告三角, 标题栏转入红色警告
    }

    // ---------- 数据应用 ----------

    applyStats(data) {
        this.errorShown = false;
        this.busy = !!data.busy;
        this.panel.classList.toggle("dynmon-busy", this.busy);
        // 体积占比条的基准: 仅真实 GPU 显存可用 (CPU 设备口径为系统内存, 回退 0)
        const primary0 = data.devices?.[0];
        this.primaryVram = primary0 && primary0.type === "cuda" ? (primary0.vram_total || 0) : 0;

        // 警告状态: 更新原因列表 (驱动标题栏红色与警告次标题)
        this.alertReasons = this.computeAlerts(data);
        this.alertEl.textContent = this.alertReasons.join("; ");
        this.alertEl.title = this.alertReasons.join("\n");
        this.syncSubtitle();   // 后端已恢复: 副标题还原为插件名
        this.syncHeaderIcon(); // 图标随告警状态切换

        const primary = data.devices?.[0];
        const sample = {
            cpu: round1(data.cpu?.percent) ?? 0,
            ram: round1(data.ram?.percent) ?? 0,
            gpu: round1(primary?.gpu_util),
            vram: round1(primary?.vram_percent) ?? 0,
            cpu_temp: round1(data.cpu?.temp),        // null = 不可用 (缺 LibreHardwareMonitor 等)
            gpu_temp: round1(primary?.temperature),  // null = GPU 不可用
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
        cardEl.style.backgroundColor = mixColor(BackgroundColors.card, BackgroundColors.cardWarn, t);
        cardEl.style.borderColor = mixColor(BorderColors.card, BorderColors.cardWarn, t);
    }

    updateCards(data, primary) {
        this.lastCpuCores = data.cpu?.cores ?? null;
        this.lastGpuName = primary?.name || "";
        // 主设备是否为真实 GPU: CPU 设备的 "显存" 口径实为系统内存, 相关卡片按无 GPU 展示
        const hasCuda = !!primary && primary.type === "cuda";
        for (const c of CARDS) {
            const ref = this.cardRefs[c.key];
            const percent = c.pct(data);
            // 占用条满量程: 常规卡 100%, 温度卡 TEMP_CARD_MAX_C (c.max 指定)
            const fullScale = c.max ?? 100;
            const barPercent = percent != null ? clamp(percent / fullScale * 100, 0, 100) : null;

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
                ref.sub.textContent = hasCuda ? (primary.name || "") : this.t("noGpu");
            } else if (c.key === "vram") {
                ref.value.textContent = hasCuda && percent != null ? `${sampleFmt(percent)}%` : "-";
                ref.sub.textContent = hasCuda
                    ? `${fmtBytes(primary.vram_used)} / ${fmtBytes(primary.vram_total)}`
                    : "-";
            } else if (c.key === "cpu_temp") {
                ref.value.textContent = percent != null ? `${sampleFmt(percent)}` : "-";
                ref.sub.textContent = percent != null ? "C" : "";
            } else if (c.key === "gpu_temp") {
                ref.value.textContent = hasCuda && percent != null ? `${sampleFmt(percent)}` : "-";
                ref.sub.textContent = hasCuda && percent != null ? "C"
                    : (hasCuda ? "" : this.t("noGpu"));
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
            .then(r => {
                if (!r.ok)
                    throw new Error(`http ${r.status}`); // 后端报错走 catch 提示并允许重试, 而非误显示为无目录
                return r.json();
            })
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

        // 行移除或列表全量重建后, tooltip 可能仍挂在已脱离 DOM 的旧行上, 联动隐藏
        if (this.tipRow && !this.tipRow.isConnected)
            this.hideTip();
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
                    ${mode === "loaded"
                ? '<button data-act="unload"></button>'
                : '<button data-act="remove"></button>'}
                </span>
            </div>
        `;
        row.querySelector('[data-act="copy"]').innerHTML = ICONS.copy;
        row.querySelector('[data-act="open"]').innerHTML = ICONS.open;
        // 第三按钮: 已加载 = 卸载, 已卸载 = 删除记录; 外观完全对称 (同图标同红色样式, 仅功能不同)
        const actionBtn = row.querySelector('[data-act="unload"], [data-act="remove"]');
        if (actionBtn)
            actionBtn.innerHTML = ICONS.unload;
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

        // 行按钮 tooltip (i18n); 卸载按钮对常驻内存的模型禁用 (卸载语义不适用);
        // 已卸载行的第三按钮为删除记录 (与已加载行按钮位置对称)
        const btns = row.querySelectorAll(".dynmon-row-btns button");
        btns[0].title = this.t("copyTip");
        btns[1].title = this.t("openTip");
        if (btns[2]) {
            if (isRemoved) {
                btns[2].title = this.t("removeRecordTip");
            } else {
                const ramOnly = m.location === "ram";
                btns[2].disabled = ramOnly;
                btns[2].title = ramOnly ? this.t("unloadRamTip") : this.t("unloadTip");
            }
        }

        // 行状态配色: 使用中 = 绿色调, 空闲 = 基础色, 已卸载 = 强制中性色
        if (isRemoved) {
            row.style.backgroundColor = "";
            row.style.borderColor = "";
        } else if (m.used) {
            row.style.backgroundColor = BackgroundColors.rowUsed;
            row.style.borderColor = BorderColors.rowUsed;
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
        row.querySelector(".dynmon-vbar-loaded").style.background = BackgroundColors.volumeBarLoaded;
        row.querySelector(".dynmon-vbar-model").style.width = `${remainFrac * 100}%`;
        row.querySelector(".dynmon-vbar-model").style.background = BackgroundColors.volumeBarModel;
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
            // 已卸载条目按卸载语义渲染 (状态字段置空), 与该行 tooltip 口径一致
            const isRemoved = m === this.unloadedByUuid.get(uuid);
            copyText(buildDetailText(m, LANGS[this.lang], isRemoved),
                () => this.flash(this.t("copiedFull")));
        } else if (act === "open") {
            try {
                const r = await postJSON("/open", { uuid });
                this.flash(r.path);
            } catch (e) {
                const msg = e.status === 400
                    ? this.t("openNoPath")
                    : e.status === 410
                        ? this.t("openNoFile")
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
                    const msg = r.reason === "busy" ? this.t("busyUnloadHttp")
                        : r.reason === "ram_only" ? this.t("unloadRamMsg")
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
        } else if (act === "remove") {
            // 删除单条已卸载记录: 后端移除后主动刷新 (下次快照即不含该条, 签名变化触发重建)
            try {
                await postJSON("/unloaded/remove", { uuid });
                this.flash(this.t("recordRemoved"));
                scheduleRefresh();
            } catch (e) {
                this.flash(this.t("removeFail", e.message), true);
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
        ctx.strokeStyle = BorderColors.chartGrid;
        ctx.lineWidth = 1;
        for (let p = 0; p <= 100; p += 25) {
            const y = Math.round(h - (p / 100) * (h - 2 * CHART_PAD_Y) - CHART_PAD_Y) + 0.5;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        const count = this.history.length;
        if (count < 2)
            return;
        const step = w / (MAX_POINTS - 1);
        // 最新点恒贴右边缘, 历史点向左排布 (数据不足 MAX_POINTS 时曲线从右缘向左生长)
        const xAt = (i) => w - (count - 1 - i) * step;

        for (const s of CHART_SERIES) {
            // 系列数值域 -> 图表高度线性映射 (超界截断到绘图区内)
            const [dMin, dMax] = CHART_DOMAIN[s.key] ?? CHART_DOMAIN_FALLBACK;
            const yOf = (v) => h - (clamp(v, dMin, dMax) - dMin) / (dMax - dMin) * (h - 2 * CHART_PAD_Y) - CHART_PAD_Y;
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
                const y = yOf(v);
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

    // 行 tooltip 渲染: 纯文本按行拆分后逐行注入, 名称与路径 (前两行, 均可能换行) 之后
    // 各插入一条 UI 分隔线; 全程 textContent 注入, 避免模型名/路径注入 HTML
    renderRowTip(text) {
        const tip = this.tipEl;
        tip.textContent = "";
        const lines = text.split("\n");
        lines.forEach((line, i) => {
            if (i === 1 || i === 2) {
                const sep = document.createElement("div");
                sep.className = "dynmon-tip-sep";
                tip.appendChild(sep);
            }
            const div = document.createElement("div");
            div.textContent = line;
            tip.appendChild(div);
        });
    }
}


// ============================================================
// 全局调度
// ============================================================

let panel = null;
let heartbeatId = null;
let fetchBusy = false;
let refreshTimer = null;
let fetchFailStreak = 0; // 轮询连续失败计数 (达到阈值后退避, 成功后清零)

// 设置热更新: 在 CUI 设置对话框中修改的三项于心跳中比对生效 (enabled 已单独处理).
// 比较基准是上次心跳读到的设置存储值 (缓存), 而非面板运行时状态:
// 面板控件的持久化时机晚于实时应用 (如透明度在 input 实时生效, change 松手才写设置),
// 若直接与面板状态比较, 心跳会把拖动中的临时状态回滚为旧设置值并重写把手, 造成闪烁;
// 以设置存储值自身的变化为触发, 拖动中的临时差异不会被误判为外部修改.
// 位于最小化短路之前: 弹窗自动最小化期间 (用户正操作设置对话框) 修改同样即时可见
const hotSettingsCache = { rate: null, lang: null, opacity: null };

function syncSettingsHot() {
    const rateSetting = getSetting(SETTING_ID__RATE, DEFAULT_RATE);
    if (rateSetting !== hotSettingsCache.rate) {
        hotSettingsCache.rate = rateSetting;
        const rate = clamp(parseInt(rateSetting, 10) || 0, RATE_MIN, RATE_MAX);
        if (rate !== panel.rate)
            panel.setRate(rate); // 内部会回写一次相同设置值, 无副作用
    }

    const langSetting = getSetting(SETTING_ID__LANG, DEFAULT_LANG);
    if (langSetting !== hotSettingsCache.lang) {
        hotSettingsCache.lang = langSetting;
        const lang = langSetting === "zh" ? "zh" : "en";
        if (lang !== panel.lang) {
            panel.lang = lang;
            panel.langSelect.value = lang;
            panel.applyI18n();
            panel.refreshLayout();
        }
    }

    const opacitySetting = getSetting(SETTING_ID__OPACITY, DEFAULT_OPACITY);
    if (opacitySetting !== hotSettingsCache.opacity) {
        hotSettingsCache.opacity = opacitySetting;
        const opacity = clamp(parseInt(opacitySetting, 10) || DEFAULT_OPACITY, MIN_OPACITY, MAX_OPACITY);
        if (opacity !== panel.opacity) {
            panel.opacity = opacity;
            panel.applyOpacity();
        }
    }
}

function heartbeatTick() {
    if (!panel)
        return;
    processDialogState(); // 对话框开关轮询: 自动最小化/还原 (不依赖 DOM 突变事件)
    // 启用开关: 每次心跳读取全局设置 (读取开销可忽略), 关闭时隐藏面板并停止取数
    const enabled = getSetting(SETTING_ID__ENABLE, true) !== false;
    if (enabled !== panel.enabled) {
        panel.enabled = enabled;
        panel.panel.style.display = enabled ? "" : "none";
    }
    syncSettingsHot(); // 刷新率 / 语言 / 透明度热更新
    if (!panel.enabled)
        return;
    if (panel.minimized)
        return; // 最小化时不刷新 (展开后由下一次心跳立即恢复)

    const now = performance.now();
    // 有效间隔: 连续失败达到阈值后退避到 FETCH_FAIL_BACKOFF_MS,
    // 避免后端不可达时仍按用户配置频率 (最高 10 Hz) 无限空敲死端口;
    // 暂停态 getPollIntervalMs 返回 Infinity, 与退避取 max 后保持暂停语义
    const interval = Math.max(panel.getPollIntervalMs(),
        fetchFailStreak >= FETCH_FAIL_STREAK_THRESHOLD ? FETCH_FAIL_BACKOFF_MS : 0);
    if (fetchBusy || now - panel.lastUpdated < interval - 40)
        return;
    fetchBusy = true;
    fetchStats()
        .then(data => {
            fetchFailStreak = 0;
            panel.applyStats(data);
            panel.lastUpdated = performance.now();
        })
        .catch(() => {
            fetchFailStreak++;
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
            fetchFailStreak = 0; // 主动刷新成功同样视为恢复, 复位退避计数
            panel.applyStats(data);
            panel.lastUpdated = performance.now();
        } catch {
            // 忽略, 下一轮心跳会重试
        }
    }, ACTION_REFRESH_MS);
}

// 对话框自动最小化/还原: 由心跳驱动轮询判定弹窗开关状态.
// 弃用 MutationObserver (实测): 本版 CUI 前端的设置/模板等对话框预先创建于 DOM,
// 仅以 display 切换可见性, 打开/关闭均无 childList 突变, observer 永不触发;
// 心跳轮询不依赖突变事件, 对挂载式/切换式弹窗统一生效.
// 选择器: role="dialog" 匹配新前端的对话框元素; 旧类名向后兼容其他版本与扩展弹窗.
// 误触发防护: role="dialog" 可能命中小型浮层 (下拉列表等), 尺寸超过阈值才视为大面积弹窗;
// 旧类名本身即模态容器, 不做尺寸过滤.
const DIALOG_SELS = '[role="dialog"], .comfy-modal, .comfy-settings, .p-dialog';
const DIALOG_MIN_W = 200; // role=dialog 误触发防护: 最小宽度 (px)
const DIALOG_MIN_H = 100; // role=dialog 误触发防护: 最小高度 (px)

// 弹窗可见性: 元素须实际参与渲染 (自身或任一祖先 display: none 时判定为隐藏).
// 不可用 "offsetParent !== null || display !== none" 的 OR 组合: 祖先级隐藏下
// offsetParent 为 null 但 computed display 仍是设定值, OR 条件整体为真,
// 隐藏弹窗被误判为打开会导致面板被错误最小化; checkVisibility 额外排除
// visibility: hidden, 旧环境回退 getClientRects (仅感知 display 链)
const isDialogVisible = (el) => typeof el.checkVisibility === "function"
    ? el.checkVisibility()
    : el.getClientRects().length > 0;

function processDialogState() {
    if (!panel)
        return;
    const open = Array.from(document.querySelectorAll(DIALOG_SELS))
        .some(el => isDialogVisible(el)
            && (el.getAttribute("role") !== "dialog"
                || (el.offsetWidth > DIALOG_MIN_W && el.offsetHeight > DIALOG_MIN_H)));
    if (open && !panel.minimized) {
        panel.autoMinPrevDocked = panel.docked; // 记录最小化前停靠状态, 关闭后完整还原
        panel.autoMinimized = true;
        panel.setMinimized(true);
    } else if (!open && panel.autoMinimized) {
        panel.autoMinimized = false;
        if (panel.minimized)
            panel.setMinimized(false);
        // 完整还原: 最小化前为浮动时, setMinimized 展开路径会保持停靠,
        // 此处退回原浮动位置 (floatPos 在最小化期间未被触碰, 位置记忆仍有效)
        if (!panel.autoMinPrevDocked && panel.docked)
            panel.exitDock(true);
    }
}


// ============================================================
// 扩展接入
// ============================================================

const name__plugin = "Comfy Dynamic"
const title__settings = "Control Panel"

app.registerExtension({
    name: "dynamic.resource_monitor",
    settings: [
        {
            id: SETTING_ID__ENABLE,
            name: "Dynamic Resource Monitor: Enabled",
            type: "boolean",
            defaultValue: true,
            // 注意类别列表必须有三个元素, 两个值无法注册
            category: [name__plugin, title__settings, SETTING_ID__ENABLE],
        },
        {
            id: SETTING_ID__RATE,
            name: "Dynamic Resource Monitor: Refresh rate (Hz, 0 = paused)",
            type: "number",
            defaultValue: DEFAULT_RATE,
            category: [name__plugin, title__settings, SETTING_ID__RATE],
        },
        {
            id: SETTING_ID__LANG,
            name: "Dynamic Resource Monitor: Language",
            type: "combo",
            options: ["en", "zh"],
            defaultValue: DEFAULT_LANG,
            category: [name__plugin, title__settings, SETTING_ID__LANG],
        },
        {
            id: SETTING_ID__OPACITY,
            name: "Dynamic Resource Monitor: Panel opacity (30-100%)",
            type: "number",
            defaultValue: DEFAULT_OPACITY,
            category: [name__plugin, title__settings, SETTING_ID__OPACITY],
        },
    ],
    async setup() {
        // setup 钩子中无条件创建浮动面板 (app 就绪后触发, 不依赖任何节点);
        // 是否显示由全局启用设置在每次心跳时决定
        panel = new MonitorPanel();
        heartbeatId = setInterval(heartbeatTick, HEARTBEAT_MS); // 心跳同时驱动对话框状态轮询
    },
});
