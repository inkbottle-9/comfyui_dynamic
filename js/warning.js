// warning.js
// 安全警告脚本 (现代化重写版)
//
// 与旧版的区别:
// - 不再劫持 prototype.onNodeCreated / prototype.onConfigure, 改用官方扩展钩子
//   nodeCreated / loadedGraphNode / afterConfigureGraph
// - 不再从后端 INPUT_TYPES 读取 meta__dynamic 元数据, 改为在本文件内按节点类型名维护配置表
// - 不再把状态对象挂到 graph 实例上, 改为模块级闭包状态
// - 对话框改用官方 Dialog API (app.extensionManager.dialog.confirm),
//   该 API 在桌面端 (Electron) 与网页端行为一致; 旧版浏览器的 window.confirm 作为兜底
// - 新增全局设置 (见下方 settings 注册), 可关闭"加载工作流时弹出安全警告"
import { app } from "../../scripts/app.js";


// 全局设置项 id: 控制加载工作流时, 遇到已解除包导入限制的脚本节点是否弹出警告
const SETTING_ID__WARN_ON_LOAD = "Dynamic.ScriptNode.WarnOnLoad";

// 全局日志开关
const WARNING_DEBUG = false;

function debugLog(...args) {
    if (WARNING_DEBUG) {
        console.log(...args);
    }
}

const string__warning_load =
    `
You are opening a workflow that contains script nodes with package import restrictions removed.
You MUST verify the code in these nodes is safe BEFORE executing the workflow.
Malicious code can steal your personal information, files, or cause other damage.
If you do not understand this warning, or do not know why it appears, click "Cancel".
The workflow will still load, but the affected nodes will remain restricted for increased security
(not completely secure).

您正在打开一个带有解除了包导入限制的脚本节点的工作流,
在确认节点中代码的安全性之前请务必不能执行工作流;
恶意代码可能会窃取您的个人信息, 文件, 或造成其它损失;
如果您不了解上述内容, 或您不知道为何出现此警告, 请点击 "取消",
工作流仍会加载, 但相关节点会保持包导入限制以提升安全性 (并非完全安全).
`;

const string__warning_open =
    `
You are about to remove package import restrictions for this node.
Once removed, the node can execute arbitrary code.
You MUST confirm the code is safe BEFORE executing the workflow.
Malicious code can steal your personal information, files, or cause other damage.
If you do not understand this warning, or do not know why it appears, click "Cancel".

您正在尝试解除该节点的包导入限制, 解除包导入限制后节点可以执行任意代码,
在确认节点中代码的安全性之前请务必不能执行工作流;
恶意代码可能会窃取您的个人信息, 文件, 或造成其它损失;
如果您不了解上述内容, 或您不知道为何出现此警告, 请点击 "取消".
`;

// 危险状态的节点颜色
const DANGER_NODE_COLORS = {
    color__background: "#660000",      // 深红色背景
    color__foreground: "#ff0000",      // 亮红色标题
    color__warning: "#ffcc66",         // 警告图标颜色
};

// 正常状态的节点颜色 (undefined 表示恢复默认)
const NORMAL_NODE_COLORS = {
    color__background: undefined,
    color__foreground: undefined,
};

// 需要安全警告的节点配置表, 键为后端 V3 schema 中的 node_id.
// widget: 控制危险状态的控件名称
// warningValue: 控件处于该值时视为危险状态
// rollbackValue: 用户取消警告时回滚到的安全值
const NODE_CONFIGS = {
    DynamicScriptNode: {
        widget: "remove_import_restrictions",
        warningValue: true,
        rollbackValue: false,
    },
};

// 模块级状态 (旧版挂在 graph 实例上, 这里改为闭包, 每次工作流加载处理后清空):
// 本次加载中处于危险状态、等待用户确认的控件集合: widget -> { node, confirmed, rollback }
const pendingWidgets = new Map();
// 本次会话中用户是否已经确认过警告 (确认过一次后, 会话内再次开启不再重复弹窗)
let flag__confirmed = false;


// 读取全局设置: 是否在加载工作流时弹出警告 (默认开启)
function getSettingWarnOnLoad() {
    const value = app.extensionManager?.setting?.get?.(SETTING_ID__WARN_ON_LOAD);
    // 设置不存在 (未注册成功或旧版前端) 时回退到默认值 true
    return value === undefined ? true : !!value;
}

// 显示危险警告对话框, 返回用户是否确认 (取消也视为未确认)
async function showWarningDialog(message) {
    const dialog = app.extensionManager?.dialog;
    if (dialog?.confirm) {
        // 官方 Dialog API, 返回 true / false / null (null 为用户直接关闭)
        const result = await dialog.confirm({
            title: "Warning !!!",
            message: message,
        });
        return result === true;
    }
    // 兜底: 旧版前端没有 extensionManager.dialog 时使用浏览器原生确认框
    return window.confirm(message);
}

// 更新节点颜色
function updateNodeColor(node, isWarning) {
    if (!node)
        return;
    node.bgcolor = isWarning
        ? DANGER_NODE_COLORS.color__background
        : NORMAL_NODE_COLORS.color__background;
    // 强制重绘
    node.setDirtyCanvas(true, true);
}

// 用户手动切换控件时的处理流程, 返回是否应该切换到危险值
async function processManualToggle(value, node, config) {
    let result = false;
    // 只有切换到危险值时才需要警告
    if (value === config.warningValue) {
        if (!flag__confirmed) {
            // showWarningDialog 是异步函数, 这里通过 await 阻塞式等待用户选择
            flag__confirmed = await showWarningDialog(string__warning_open);
        }
        result = flag__confirmed;
    }
    updateNodeColor(node, result);
    return result;
}

app.registerExtension({
    name: "dynamic.warning",

    // 注册全局设置项 (新前端官方方式: 声明式 settings 数组,
    // 读取时使用 app.extensionManager.setting.get(id))
    settings: [
        {
            id: SETTING_ID__WARN_ON_LOAD,
            name: "Script Node: warn when loading workflows with unrestricted import (加载含有解除包导入限制脚本节点的工作流时弹出安全警告)",
            type: "boolean",
            defaultValue: true,
            tooltip: "When enabled, a confirmation dialog is shown if a loaded workflow contains DynamicScriptNode with import restrictions removed; the restriction is kept unless you confirm.",
        },
    ],

    // 官方钩子: 节点创建后调用, 绑定控件的回调以监听用户手动切换
    async nodeCreated(node) {
        const config = NODE_CONFIGS[node?.type];
        if (!config)
            return;

        const widget = node.widgets?.find(w => w.name === config.widget);
        if (!widget)
            return;

        // widget.callback 是官方文档化的控件变更回调, 仅在用户修改值时触发.
        // 注意点击切换时控件的值已经被前端强制改变了, 无法保存旧值,
        // 因此取消时通过回写 rollbackValue 来撤销
        const originalCallback = widget.callback;
        widget.callback = function () {
            // 调用原始回调, 保持控件原有行为
            originalCallback?.apply(this, arguments);

            // 获取结果, 注意 processManualToggle 是 async 的 (内部最终可能调用对话框)
            processManualToggle(widget.value, node, config).then((confirmed) => {
                // 赋值
                widget.value = confirmed ? config.warningValue : config.rollbackValue;
            });
        };

        // 初始更新节点颜色 (恢复到常规颜色)
        updateNodeColor(node, false);
    },

    // 官方钩子: 工作流加载时, 每个节点在整个图配置完成后调用.
    // 此时 widget 的值已经恢复为工作流保存的值.
    async loadedGraphNode(node) {
        const config = NODE_CONFIGS[node?.type];
        if (!config)
            return;

        const widget = node.widgets?.find(w => w.name === config.widget);
        if (!widget)
            return;

        // 只处理处于危险状态的节点
        if (widget.value !== config.warningValue)
            return;

        // 全局设置关闭了加载警告: 不做任何干预, 仅把节点标记为危险颜色
        if (!getSettingWarnOnLoad()) {
            debugLog(`<dynamic_warning> warn-on-load disabled, keep node ${node.id} as-is`);
            updateNodeColor(node, true);
            return;
        }

        // 记录到待确认集合, 并先把控件回滚到安全值,
        // 确保在用户确认之前控件不会错误地停留在危险状态
        if (!pendingWidgets.has(widget)) {
            pendingWidgets.set(widget, {
                node,
                // 用户确认时恢复的值 (即工作流保存的值)
                confirmed: widget.value,
                // 用户取消时保持的值
                rollback: config.rollbackValue,
            });
        }
        widget.value = config.rollbackValue;
        updateNodeColor(node, false);
    },

    // 官方钩子: 工作流加载完成后调用, 统一弹出一次确认对话框
    async afterConfigureGraph() {
        // 没有待确认的节点时直接返回
        if (pendingWidgets.size === 0)
            return;

        // 下一帧时弹出提示, 避免阻塞图的渲染
        requestAnimationFrame(async () => {
            try {
                // 本次加载的确认结果不影响会话级 flag__confirmed 的语义:
                // 加载确认通过后, 视为用户已经知晓风险, 会话内后续手动开启也不再弹窗
                flag__confirmed = await showWarningDialog(string__warning_load);

                for (const [widget, entry] of pendingWidgets) {
                    // 直接写回控件值 (不经过 callback, 避免再次触发警告流程)
                    widget.value = flag__confirmed ? entry.confirmed : entry.rollback;
                    updateNodeColor(entry.node, flag__confirmed);
                }
            } finally {
                // 每次加载只提示一次, 处理完后清空容器
                pendingWidgets.clear();
            }
        });
    },
});
