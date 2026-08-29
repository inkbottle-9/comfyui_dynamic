// dynamic_ports.js
// 动态端口管理脚本 (取代旧版 dynamic_io_fix_v6.js)
//
// 与旧版的区别:
// - 不再劫持 prototype.onNodeCreated / prototype.configure, 改用官方扩展钩子
//   nodeCreated / loadedGraphNode (loadedGraphNode 在整个图含连线配置完成后触发,
//   时序由前端框架保证, 不再需要 _configured 之类的状态猜测)
// - 不再用 Object.defineProperty 劫持 widget.value 的 setter,
//   改用官方文档化的 widget.callback 响应用户修改
// - 不再从后端 INPUT_TYPES 读取 meta__dynamic 元数据, 改为在本文件内
//   按节点类型名维护配置表 (节点数量少且固定, 更直观)
// - 不再依赖"固定端口数量"偏移计算, 改为按端口名称识别动态端口,
//   对前端版本间 widget socket 行为的差异更具鲁棒性
// - count 锁 (端口有连接时禁止移除, 并回写实际数量) 逻辑保留
import { app } from "../../scripts/app.js";


// 动态端口数量上限 (与后端 widget 的 max 保持一致)
const MAX_DYNAMIC_PORTS = 100;

// 全局日志开关: 设为 true 可启用 <dynamic_ports> 调试日志
const DYNAMIC_PORTS_DEBUG = false;

// 统一日志输出函数, 根据开关决定是否打印
function debugLog(...args) {
    if (DYNAMIC_PORTS_DEBUG) {
        console.log(...args);
    }
}

// 错误日志 (错误信息通常需要打印, 不受 debug 开关控制)
function errorLog(...args) {
    console.error(...args);
}

// 各节点的动态端口配置表, 键为后端 V3 schema 中的 node_id.
// inputs/outputs 各自可选, 字段含义:
//   widget: 驱动端口数量的 widget 名称
//   prefix: 动态端口名称前缀 (实际端口名为 prefix + 数字序号, 如 input_0)
// 若 inputs 与 outputs 的 widget 同名, 则为共享模式 (一个控件同时驱动两侧, 两侧数量保持一致)
const NODE_CONFIGS = {
    DynamicScriptNode: {
        inputs: { widget: "input_ports_count", prefix: "input_" },
        outputs: { widget: "output_ports_count", prefix: "output_" },
    },
    DynamicPipeAnyNode: {
        inputs: { widget: "ports_count", prefix: "input_" },
        outputs: { widget: "ports_count", prefix: "output_" },
    },
    DynamicSwitchAnyNode: {
        inputs: { widget: "cases_count", prefix: "case_" },
    },
};

// 判断端口名是否是目标动态端口 (prefix + 纯数字序号).
// 注意必须用 $ 锚定结尾: 否则 "cases_count" 会被 "case_" 前缀误匹配,
// "input_ports_count" 会被 "input_" 前缀误匹配
function matchDynamicPortName(name, prefix) {
    if (typeof name !== "string" || !name.startsWith(prefix))
        return null;
    const suffix = name.slice(prefix.length);
    if (!/^\d+$/.test(suffix))
        return null;
    return parseInt(suffix, 10);
}

// 获取节点某一侧 (input/output) 的全部动态端口, 按序号升序排列.
// 返回元素: { slot: 在 node.inputs/node.outputs 中的下标, index: 动态序号, port: 端口对象 }
function getDynamicPorts(node, prefix, isInput) {
    const list = isInput ? (node.inputs || []) : (node.outputs || []);
    const result = [];
    for (let slot = 0; slot < list.length; slot++) {
        const index = matchDynamicPortName(list[slot]?.name, prefix);
        if (index !== null)
            result.push({ slot, index, port: list[slot] });
    }
    result.sort((a, b) => a.index - b.index);
    return result;
}

// 判断端口是否存在连接
function isPortConnected(port, isInput) {
    if (!port)
        return false;
    // 输入端口: link 为单个连接 id 或 null
    if (isInput)
        return port.link !== null && port.link !== undefined;
    // 输出端口: links 为连接 id 数组
    return Array.isArray(port.links) && port.links.length > 0;
}

// 将某一侧的动态端口数量同步到目标值 (带 count 锁: 有连接的端口禁止移除).
// 返回实际生效的动态端口数量 (可能因 count 锁而大于目标值).
function syncSidePorts(node, sideConfig, target, isInput) {
    const prefix = sideConfig.prefix;
    const label = isInput ? "input" : "output";

    target = Math.max(0, Math.min(MAX_DYNAMIC_PORTS, Math.floor(target) || 0));

    const dynamicPorts = getDynamicPorts(node, prefix, isInput);
    const current = dynamicPorts.length;

    debugLog(`<dynamic_ports> node ${node.id} ${label}: current=${current}, target=${target}`);

    if (target === current)
        return current;

    // 增加端口: 保证序号 0..target-1 连续存在 (移除总是从尾部进行, 序号天然连续)
    if (target > current) {
        for (let i = 0; i < target; i++) {
            const name = `${prefix}${i}`;
            const exists = dynamicPorts.some(p => p.index === i);
            if (!exists) {
                debugLog(`<dynamic_ports> node ${node.id} add ${label} port: ${name}`);
                if (isInput)
                    node.addInput(name, "*");
                else
                    node.addOutput(name, "*");
            }
        }
        node.setDirtyCanvas(true, true);
        return target;
    }

    // 减少端口: 从序号最大的动态端口开始, 遇到有连接的端口即停止 (count 锁)
    for (let i = current - 1; i >= target; i--) {
        const entry = dynamicPorts[i];
        if (!entry)
            continue;

        if (isPortConnected(entry.port, isInput)) {
            const lockedCount = entry.index + 1;
            debugLog(`<dynamic_ports> node ${node.id} [count lock] ${label} port "${entry.port.name}" is connected, locked at ${lockedCount}`);
            return lockedCount;
        }

        debugLog(`<dynamic_ports> node ${node.id} remove ${label} port [slot ${entry.slot}]: ${entry.port.name}`);
        if (isInput)
            node.removeInput(entry.slot);
        else
            node.removeOutput(entry.slot);
    }

    node.setDirtyCanvas(true, true);
    return target;
}

// 读取并规整 widget 的目标值
function getWidgetTargetValue(widget) {
    return Math.max(0, Math.min(MAX_DYNAMIC_PORTS, parseInt(widget.value) || 0));
}

// 同步一个节点的全部动态端口.
// 若因 count 锁导致实际数量与 widget 值不一致, 会将 widget 值回写为实际数量
// (回写 widget.value 不会触发 callback, 不会造成递归).
function syncDynamicPorts(node, config) {
    const cfgInput = config.inputs;
    const cfgOutput = config.outputs;

    // 共享 widget 模式: 同一个控件同时驱动输入与输出, 两侧数量保持严格一致
    const isShared = cfgInput && cfgOutput && cfgInput.widget === cfgOutput.widget;

    if (isShared) {
        const widget = node.widgets?.find(w => w.name === cfgInput.widget);
        if (!widget) {
            debugLog(`<dynamic_ports> node ${node.id} shared widget "${cfgInput.widget}" not found`);
            return;
        }
        const target = getWidgetTargetValue(widget);
        const actualInput = syncSidePorts(node, cfgInput, target, true);
        const actualOutput = syncSidePorts(node, cfgOutput, target, false);
        // 若任一侧因连接被锁定到更高数量, 取最大值并同步另一侧
        const actual = Math.max(actualInput, actualOutput);
        if (actual !== target) {
            debugLog(`<dynamic_ports> node ${node.id} shared locked at ${actual} (input=${actualInput}, output=${actualOutput})`);
            syncSidePorts(node, cfgInput, actual, true);
            syncSidePorts(node, cfgOutput, actual, false);
            widget.value = actual;
        }
        return;
    }

    if (cfgInput) {
        const widget = node.widgets?.find(w => w.name === cfgInput.widget);
        if (widget) {
            const target = getWidgetTargetValue(widget);
            const actual = syncSidePorts(node, cfgInput, target, true);
            if (actual !== target)
                widget.value = actual;
        } else {
            debugLog(`<dynamic_ports> node ${node.id} input widget "${cfgInput.widget}" not found`);
        }
    }

    if (cfgOutput) {
        const widget = node.widgets?.find(w => w.name === cfgOutput.widget);
        if (widget) {
            const target = getWidgetTargetValue(widget);
            const actual = syncSidePorts(node, cfgOutput, target, false);
            if (actual !== target)
                widget.value = actual;
        } else {
            debugLog(`<dynamic_ports> node ${node.id} output widget "${cfgOutput.widget}" not found`);
        }
    }
}

// 为节点绑定 widget 变更回调 (用户手动修改计数控件时同步端口)
function hookWidgetCallback(node, config) {
    // 收集需要劫持的 widget 名称 (共享模式下去重)
    const widgetNames = new Set();
    if (config.inputs)
        widgetNames.add(config.inputs.widget);
    if (config.outputs)
        widgetNames.add(config.outputs.widget);

    for (const widgetName of widgetNames) {
        const widget = node.widgets?.find(w => w.name === widgetName);
        if (!widget) {
            debugLog(`<dynamic_ports> node ${node.id} widget "${widgetName}" not found, skip hook`);
            continue;
        }
        if (widget._dynamic_ports_hooked)
            continue;
        widget._dynamic_ports_hooked = true;

        // widget.callback 是官方文档化的控件变更回调, 仅在用户修改值时触发
        // (程序化的 widget.value 赋值不会触发, 因此 syncDynamicPorts 内部的回写是安全的)
        const originalCallback = widget.callback;
        widget.callback = function () {
            // 先调用原始回调, 保持控件原有行为
            originalCallback?.apply(this, arguments);
            try {
                // 规整控件值 (越界裁剪 / 非数字兜底), 再同步端口
                const clamped = getWidgetTargetValue(widget);
                if (widget.value !== clamped)
                    widget.value = clamped;
                syncDynamicPorts(node, config);
            } catch (e) {
                errorLog(`<dynamic_ports> node ${node.id} sync error:`, e);
            }
        };
        debugLog(`<dynamic_ports> node ${node.id} hooked widget "${widgetName}"`);
    }
}

app.registerExtension({
    name: "dynamic.dynamic_ports",

    // 官方钩子: 节点创建后调用 (新建节点与工作流加载都会触发).
    // 此时 widgets 已就绪, 但加载中的节点尚未恢复工作流保存的值.
    async nodeCreated(node) {
        const config = NODE_CONFIGS[node?.comfyClass];
        if (!config)
            return;
        debugLog(`<dynamic_ports> nodeCreated: ${node.comfyClass} (ID: ${node.id})`);
        hookWidgetCallback(node, config);
        // 对新建节点, 按控件默认值创建初始端口;
        // 对加载中的节点, 这里创建的端口随后会被 litegraph 的 configure 用保存数据覆盖,
        // 最终由 loadedGraphNode 中的同步兜底, 两边都安全
        syncDynamicPorts(node, config);
    },

    // 官方钩子: 工作流加载时, 每个节点在整个图 (含连线) 配置完成后调用.
    // 此时 widget 值与端口连接均已恢复, 是同步端口的可靠时机.
    async loadedGraphNode(node) {
        const config = NODE_CONFIGS[node?.comfyClass];
        if (!config)
            return;
        debugLog(`<dynamic_ports> loadedGraphNode: ${node.comfyClass} (ID: ${node.id})`);
        hookWidgetCallback(node, config);
        syncDynamicPorts(node, config);
    },
});
