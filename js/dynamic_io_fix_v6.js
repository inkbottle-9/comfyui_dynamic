import { app } from "../../scripts/app.js";


// 该脚本文件由 kimi 生成
// 修改 setTimeout 为 queueMicrotask. 添加日志控制开关


const max__dynamic_ports = 100;

// 全局日志开关: 设为 false 可禁用所有 <dynamic_io> 调试日志 (生产环境建议关闭)
const DYNAMIC_IO_DEBUG = false;

// 统一日志输出函数,根据开关决定是否打印
function debugLog(...args) {
    if (DYNAMIC_IO_DEBUG) {
        console.log(...args);
    }
}

// 用于错误日志 (错误信息通常需要打印,不受 debug 开关控制,但格式保持一致)
function errorLog(...args) {
    console.error(...args);
}

app.registerExtension({
    name: "dynamic.dynamic_io__fix_v6",

    async beforeRegisterNodeDef(type__node, data__node, app) {

        // return;

        const meta = data__node.input.meta__dynamic;
        if (!check_meta(meta))
            return;

        debugLog(`<dynamic_io> [v6] Registering: ${data__node.name}`);

        const on_node_created__origin = type__node.prototype.onNodeCreated;
        const configure_origin = type__node.prototype.configure;

        // 拦截 configure (工作流恢复后调用)
        type__node.prototype.configure = function (config) {
            debugLog(`<dynamic_io> [v6] configure: ${this.type} (ID: ${this.id})`);

            // 标记: configure 已调用 (表示这是工作流加载,非新建节点)
            this._configured = true;

            // 先执行原始 configure (恢复 widget 值和端口连接)
            const result = configure_origin?.apply(this, arguments);

            // configure 完成后,同步端口 (此时 widget 值已是工作流保存值)
            if (this._dynamic_io_setup) {
                debugLog(`<dynamic_io> [v6] 工作流加载,执行 syncDynamicPorts`);
                syncDynamicPorts(this, meta);
            }

            return result;
        };

        type__node.prototype.onNodeCreated = function () {
            debugLog(`<dynamic_io> [v6] onNodeCreated: ${this.type} (ID: ${this.id})`);

            const result = on_node_created__origin?.apply(this, arguments);

            // 初始化动态 IO (劫持 setter,但不立即创建端口)
            setupDynamicIO(this, meta);
            this._dynamic_io_setup = true;

            // 使用 queueMicrotask 替代 setTimeout: 更快, 更轻量, 执行时机更确定
            queueMicrotask(() => {
                // 如果 configure 未被调用过,说明是新建节点 (而非工作流加载)
                if (!this._configured) {
                    debugLog(`<dynamic_io> [v6] 新建节点检测 (queueMicrotask),执行初始端口同步`);
                    syncDynamicPorts(this, meta);
                }
            });

            return result;
        };
    }
});

function check_meta(meta) {
    const valid = meta && meta.dynamic_io &&
        (meta.dynamic_io.flag__dynamic_inputs || meta.dynamic_io.flag__dynamic_outputs) &&
        (!meta.dynamic_io.flag__dynamic_inputs || meta.dynamic_io.name__dynamic_inputs_widget) &&
        (!meta.dynamic_io.flag__dynamic_outputs || meta.dynamic_io.name__dynamic_outputs_widget);

    if (DYNAMIC_IO_DEBUG && meta && meta.dynamic_io) {
        debugLog(`<dynamic_io> [v6] check_meta: inputs=${meta.dynamic_io.flag__dynamic_inputs}, outputs=${meta.dynamic_io.flag__dynamic_outputs}`);
    }
    return valid;
}

function setupDynamicIO(node, meta) {
    debugLog(`<dynamic_io> [v6] setupDynamicIO for node ${node.id}`);

    const flag__dynamic_inputs = meta.dynamic_io.flag__dynamic_inputs;
    const flag__dynamic_outputs = meta.dynamic_io.flag__dynamic_outputs;
    const count__fixed_inputs = meta.dynamic_io.count__fixed_inputs || 0;
    const count__fixed_outputs = meta.dynamic_io.count__fixed_outputs || 0;
    const name__dynamic_inputs_widget = meta.dynamic_io.name__dynamic_inputs_widget;
    const name__dynamic_outputs_widget = meta.dynamic_io.name__dynamic_outputs_widget;
    const prefix__dynamic_inputs = meta.dynamic_io.prefix__dynamic_inputs || "input_";
    const prefix__dynamic_outputs = meta.dynamic_io.prefix__dynamic_outputs || "output_";

    // 检测共享 widget 模式: 同一个控件同步驱动输入与输出
    const is_shared_widget = flag__dynamic_inputs && flag__dynamic_outputs &&
        name__dynamic_inputs_widget === name__dynamic_outputs_widget;

    if (is_shared_widget) {
        debugLog(`<dynamic_io> [v6] 检测到共享 widget 模式: ${name__dynamic_inputs_widget}`);
        setupSharedWidget(node, count__fixed_inputs, count__fixed_outputs,
            name__dynamic_inputs_widget,
            prefix__dynamic_inputs, prefix__dynamic_outputs);
    } else {
        if (flag__dynamic_inputs) {
            setupWidget(node, count__fixed_inputs, name__dynamic_inputs_widget, prefix__dynamic_inputs, 'input');
        }
        if (flag__dynamic_outputs) {
            setupWidget(node, count__fixed_outputs, name__dynamic_outputs_widget, prefix__dynamic_outputs, 'output');
        }
    }
}


function setupWidget(node, count__fixed, widget_name, prefix, type) {
    const widget = node.widgets?.find(w => w.name === widget_name);
    if (!widget) {
        debugLog(`<dynamic_io> [v6] 警告: 未找到 widget "${widget_name}"`);
        return;
    }

    if (widget._dynamic_io_hooked) {
        debugLog(`<dynamic_io> [v6] widget "${widget_name}" 已被劫持,跳过`);
        return;
    }

    // 劫持前先保存 Python 定义的原始默认值
    const raw_default_value = widget.value;
    debugLog(`<dynamic_io> [v6] Setup ${type} widget "${widget_name}" | 原始默认值: ${raw_default_value}`);

    widget._dynamic_io_hooked = true;

    // 初始化为 -1 表示尚未初始化,等待 syncDynamicPorts 首次赋值
    let current_target = -1;

    // 将原始默认值存储到 widget 供后续使用
    widget._dynamic_raw_default = raw_default_value;

    // 劫持 widget.value
    Object.defineProperty(widget, 'value', {
        get() {
            return current_target;
        },
        set(new_value) {
            const num_value = Math.max(0, Math.min(max__dynamic_ports, parseInt(new_value) || 0));

            debugLog(`<dynamic_io> [v6] ${type} setter: ${current_target} -> ${num_value} (输入值: ${new_value})`);

            // 值变化时更新端口 (-1 表示首次初始化,必定触发)
            if (num_value !== current_target) {
                const old_target = current_target;
                current_target = num_value;

                const update_fn = type === 'input' ? update_input_ports : update_output_ports;
                const actual = update_fn(node, count__fixed, num_value, prefix, widget_name);

                // 如果因连接锁定,同步实际值
                if (actual !== num_value) {
                    debugLog(`<dynamic_io> [v6] ${type} 因连接锁定,调整至: ${actual}`);
                    current_target = actual;
                }

                // 触发重绘 (初始化时不重复触发)
                if (old_target !== -1) {
                    node.setDirtyCanvas(true, true);
                }
            } else {
                debugLog(`<dynamic_io> [v6] ${type} setter: 值未变化,跳过端口更新`);
            }
        },
        configurable: true,
        enumerable: true
    });

    // 绑定 callback (用户手动调整 widget 值时)
    const widget_callback__origin = widget.callback;
    widget.callback = function (value) {
        debugLog(`<dynamic_io> [v6] ${type} callback 触发: ${value}`);
        widget_callback__origin?.call(this, value);
        const num = parseInt(value) || 0;
        if (widget.value !== num) {
            widget.value = num;
        }
    };

    debugLog(`<dynamic_io> [v6] widget "${widget_name}" 劫持完成,current_target: ${widget.value}, 原始默认值已保存: ${widget._dynamic_raw_default}`);
}

function setupSharedWidget(node, count__fixed_inputs, count__fixed_outputs, widget_name, prefix__inputs, prefix__outputs) {
    const widget = node.widgets?.find(w => w.name === widget_name);
    if (!widget) {
        debugLog(`<dynamic_io> [v6] 警告: 未找到共享 widget "${widget_name}"`);
        return;
    }
    if (widget._dynamic_io_hooked) {
        debugLog(`<dynamic_io> [v6] 共享 widget "${widget_name}" 已被劫持,跳过`);
        return;
    }

    const raw_default_value = widget.value;
    debugLog(`<dynamic_io> [v6] Setup shared widget "${widget_name}" | 原始默认值: ${raw_default_value}`);

    widget._dynamic_io_hooked = true;
    let current_target = -1;
    widget._dynamic_raw_default = raw_default_value;

    Object.defineProperty(widget, 'value', {
        get() {
            return current_target;
        },
        set(new_value) {
            const num_value = Math.max(0, Math.min(max__dynamic_ports, parseInt(new_value) || 0));

            debugLog(`<dynamic_io> [v6] shared setter: ${current_target} -> ${num_value} (输入值: ${new_value})`);

            if (num_value !== current_target) {
                const old_target = current_target;
                current_target = num_value;

                let actual_input = update_input_ports(node, count__fixed_inputs, num_value, prefix__inputs, widget_name);
                let actual_output = update_output_ports(node, count__fixed_outputs, num_value, prefix__outputs, widget_name);

                // 若任一侧因连接被锁定到更高数量, 取最大值并保持两侧严格同步
                const actual = Math.max(actual_input, actual_output);
                if (actual !== num_value) {
                    debugLog(`<dynamic_io> [v6] shared 因连接锁定, 同步至: ${actual} (input=${actual_input}, output=${actual_output})`);
                    current_target = actual;
                    if (actual_input !== actual) {
                        actual_input = update_input_ports(node, count__fixed_inputs, actual, prefix__inputs, widget_name);
                    }
                    if (actual_output !== actual) {
                        actual_output = update_output_ports(node, count__fixed_outputs, actual, prefix__outputs, widget_name);
                    }
                }

                if (old_target !== -1) {
                    node.setDirtyCanvas(true, true);
                }
            } else {
                debugLog(`<dynamic_io> [v6] shared setter: 值未变化, 跳过端口更新`);
            }
        },
        configurable: true,
        enumerable: true
    });

    const widget_callback__origin = widget.callback;
    widget.callback = function (value) {
        debugLog(`<dynamic_io> [v6] shared callback 触发: ${value}`);
        widget_callback__origin?.call(this, value);
        const num = parseInt(value) || 0;
        if (widget.value !== num) {
            widget.value = num;
        }
    };

    debugLog(`<dynamic_io> [v6] 共享 widget "${widget_name}" 劫持完成`);
}


function syncDynamicPorts(node, meta) {
    debugLog(`<dynamic_io> [v6] Syncing ports for node ${node.id}`);

    const flag__dynamic_inputs = meta.dynamic_io.flag__dynamic_inputs;
    const flag__dynamic_outputs = meta.dynamic_io.flag__dynamic_outputs;
    const count__fixed_inputs = meta.dynamic_io.count__fixed_inputs || 0;
    const count__fixed_outputs = meta.dynamic_io.count__fixed_outputs || 0;
    const name__dynamic_inputs_widget = meta.dynamic_io.name__dynamic_inputs_widget;
    const name__dynamic_outputs_widget = meta.dynamic_io.name__dynamic_outputs_widget;
    const prefix__dynamic_inputs = meta.dynamic_io.prefix__dynamic_inputs || "input_";
    const prefix__dynamic_outputs = meta.dynamic_io.prefix__dynamic_outputs || "output_";

    // 共享 widget 模式: 一次比对, 一次触发, 同步两侧
    const is_shared_widget = flag__dynamic_inputs && flag__dynamic_outputs &&
        name__dynamic_inputs_widget === name__dynamic_outputs_widget;

    if (is_shared_widget) {
        const widget = node.widgets?.find(w => w.name === name__dynamic_inputs_widget);
        if (widget) {
            let target_value;
            if (widget.value === -1 && widget._dynamic_raw_default !== undefined) {
                target_value = Math.max(0, Math.min(max__dynamic_ports, parseInt(widget._dynamic_raw_default) || 0));
                debugLog(`<dynamic_io> [v6] Shared 首次初始化, 使用原始默认值: ${target_value}`);
            } else {
                target_value = Math.max(0, Math.min(max__dynamic_ports, parseInt(widget.value) || 0));
                debugLog(`<dynamic_io> [v6] Shared 使用当前值: ${target_value}`);
            }

            const current_input_total = node.inputs?.length || count__fixed_inputs;
            const current_input_dynamic = Math.max(0, current_input_total - count__fixed_inputs);
            const current_output_total = node.outputs?.length || count__fixed_outputs;
            const current_output_dynamic = Math.max(0, current_output_total - count__fixed_outputs);

            debugLog(`<dynamic_io> [v6] Shared check: 目标=${target_value}, 输入动态=${current_input_dynamic}, 输出动态=${current_output_dynamic}`);

            if (current_input_dynamic !== target_value || current_output_dynamic !== target_value) {
                debugLog(`<dynamic_io> [v6] 共享端口不匹配, 触发重建`);
                widget.value = target_value;
            } else {
                debugLog(`<dynamic_io> [v6] 共享端口数量匹配, 无需重建`);
            }
        } else {
            debugLog(`<dynamic_io> [v6] 同步时未找到共享 widget: ${name__dynamic_inputs_widget}`);
        }
        return;
    }

    // ==========================================
    // 以下保持 v6 原有逻辑完全不变
    // ==========================================
    if (flag__dynamic_inputs) {
        const widget = node.widgets?.find(w => w.name === name__dynamic_inputs_widget);
        if (widget) {
            let target_value;
            if (widget.value === -1 && widget._dynamic_raw_default !== undefined) {
                target_value = Math.max(0, Math.min(max__dynamic_ports, parseInt(widget._dynamic_raw_default) || 0));
                debugLog(`<dynamic_io> [v6] Input 首次初始化, 使用原始默认值: ${target_value} (raw: ${widget._dynamic_raw_default})`);
            } else {
                target_value = Math.max(0, Math.min(max__dynamic_ports, parseInt(widget.value) || 0));
                debugLog(`<dynamic_io> [v6] Input 使用当前值: ${target_value}`);
            }

            const current_total = node.inputs?.length || count__fixed_inputs;
            const actual_dynamic = Math.max(0, current_total - count__fixed_inputs);

            debugLog(`<dynamic_io> [v6] Input check: 目标=${target_value}, 当前总计=${current_total}, 固定=${count__fixed_inputs}, 动态=${actual_dynamic}`);

            if (actual_dynamic !== target_value) {
                debugLog(`<dynamic_io> [v6] 输入端口不匹配 (${actual_dynamic} != ${target_value}), 触发重建`);
                widget.value = target_value;
            } else {
                debugLog(`<dynamic_io> [v6] 输入端口数量匹配, 无需重建`);
            }
        } else {
            debugLog(`<dynamic_io> [v6] 同步时未找到输入 widget: ${name__dynamic_inputs_widget}`);
        }
    }

    if (flag__dynamic_outputs) {
        const widget = node.widgets?.find(w => w.name === name__dynamic_outputs_widget);
        if (widget) {
            let target_value;
            if (widget.value === -1 && widget._dynamic_raw_default !== undefined) {
                target_value = Math.max(0, Math.min(max__dynamic_ports, parseInt(widget._dynamic_raw_default) || 0));
                debugLog(`<dynamic_io> [v6] Output 首次初始化, 使用原始默认值: ${target_value} (raw: ${widget._dynamic_raw_default})`);
            } else {
                target_value = Math.max(0, Math.min(max__dynamic_ports, parseInt(widget.value) || 0));
                debugLog(`<dynamic_io> [v6] Output 使用当前值: ${target_value}`);
            }

            const current_total = node.outputs?.length || count__fixed_outputs;
            const actual_dynamic = Math.max(0, current_total - count__fixed_outputs);

            debugLog(`<dynamic_io> [v6] Output check: 目标=${target_value}, 当前总计=${current_total}, 固定=${count__fixed_outputs}, 动态=${actual_dynamic}`);

            if (actual_dynamic !== target_value) {
                debugLog(`<dynamic_io> [v6] 输出端口不匹配 (${actual_dynamic} != ${target_value}), 触发重建`);
                widget.value = target_value;
            } else {
                debugLog(`<dynamic_io> [v6] 输出端口数量匹配, 无需重建`);
            }
        } else {
            debugLog(`<dynamic_io> [v6] 同步时未找到输出 widget: ${name__dynamic_outputs_widget}`);
        }
    }
}


// 更新输入端口 (带连接保护 / count 锁)
function update_input_ports(node, count__fixed, count__target, prefix, widget_name) {
    try {
        count__target = Math.max(0, Math.min(max__dynamic_ports, Math.floor(count__target)));
        const target = count__target;

        const current_total = node.inputs?.length || count__fixed;
        const current_dynamic = Math.max(0, current_total - count__fixed);

        debugLog(`<dynamic_io> [v6] Update inputs: 固定=${count__fixed}, 当前动态=${current_dynamic}, 目标=${target}, 当前总计=${current_total}`);

        if (target === current_dynamic) {
            debugLog(`<dynamic_io> [v6] 输入端口无需变化`);
            return target;
        }

        // 添加端口 (增量)
        if (target > current_dynamic) {
            debugLog(`<dynamic_io> [v6] 准备添加 ${target - current_dynamic} 个输入端口`);
            for (let i = current_dynamic; i < target; i++) {
                const name = `${prefix}${i}`;
                const exists = node.inputs?.some(inp => inp.name === name);
                if (!exists) {
                    const idx = count__fixed + i;
                    debugLog(`<dynamic_io> [v6] 添加输入端口 [${idx}]: ${name}`);
                    node.addInput(name, "*");
                } else {
                    debugLog(`<dynamic_io> [v6] 输入端口 ${name} 已存在,跳过`);
                }
            }
            node.setDirtyCanvas(true, true);
            return target;
        }

        // 移除端口 (从后往前,遇连接即停 - count 锁机制)
        if (target < current_dynamic) {
            debugLog(`<dynamic_io> [v6] 准备移除输入端口,从 ${current_dynamic} 减至 ${target} (从后往前检查连接)`);

            for (let i = current_total - 1; i >= count__fixed + target; i--) {
                if (i < 0 || !node.inputs[i]) continue;

                const input = node.inputs[i];
                const is_connected = input.link !== null && input.link !== undefined;

                debugLog(`<dynamic_io> [v6] 检查输入端口 [${i}] "${input.name}": 连接状态=${is_connected}, link=${input.link}`);

                if (is_connected) {
                    const locked_count = i - count__fixed + 1;
                    debugLog(`<dynamic_io> [v6] [COUNT 锁] 端口 "${input.name}" 有连接,锁定计数为 ${locked_count},停止移除`);
                    return locked_count;
                }

                debugLog(`<dynamic_io> [v6] 移除输入端口 [${i}]: ${input.name}`);
                node.removeInput(i);
            }

            node.setDirtyCanvas(true, true);
            debugLog(`<dynamic_io> [v6] 成功移除至 ${target} 个动态输入端口`);
            return target;
        }
    } catch (e) {
        errorLog(`<dynamic_io> [v6] Error update_input_ports:`, e);
        return 0;
    }
}

// 更新输出端口 (带 count 锁)
function update_output_ports(node, count__fixed, count__target, prefix, widget_name) {
    try {
        count__target = Math.max(0, Math.min(max__dynamic_ports, Math.floor(count__target)));
        const target = count__target;

        const current_total = node.outputs?.length || count__fixed;
        const current_dynamic = Math.max(0, current_total - count__fixed);

        debugLog(`<dynamic_io> [v6] Update outputs: 固定=${count__fixed}, 当前动态=${current_dynamic}, 目标=${target}, 当前总计=${current_total}`);

        if (target === current_dynamic) return target;

        if (target > current_dynamic) {
            debugLog(`<dynamic_io> [v6] 准备添加 ${target - current_dynamic} 个输出端口`);
            for (let i = current_dynamic; i < target; i++) {
                const name = `${prefix}${i}`;
                const exists = node.outputs?.some(out => out.name === name);
                if (!exists) {
                    const idx = count__fixed + i;
                    debugLog(`<dynamic_io> [v6] 添加输出端口 [${idx}]: ${name}`);
                    node.addOutput(name, "*");
                } else {
                    debugLog(`<dynamic_io> [v6] 输出端口 ${name} 已存在,跳过`);
                }
            }
            node.setDirtyCanvas(true, true);
            return target;
        }

        if (target < current_dynamic) {
            debugLog(`<dynamic_io> [v6] 准备移除输出端口,从 ${current_dynamic} 减至 ${target} (从后往前检查连接)`);

            for (let i = current_total - 1; i >= count__fixed + target; i--) {
                if (i < 0 || !node.outputs[i]) continue;

                const output = node.outputs[i];
                const has_links = output.links && output.links.length > 0;

                debugLog(`<dynamic_io> [v6] 检查输出端口 [${i}] "${output.name}": 连接数=${output.links?.length || 0}`);

                if (has_links) {
                    const locked_count = i - count__fixed + 1;
                    debugLog(`<dynamic_io> [v6] [COUNT 锁] 端口 "${output.name}" 有连接,锁定计数为 ${locked_count},停止移除`);
                    return locked_count;
                }

                debugLog(`<dynamic_io> [v6] 移除输出端口 [${i}]: ${output.name}`);
                node.removeOutput(i);
            }

            node.setDirtyCanvas(true, true);
            debugLog(`<dynamic_io> [v6] 成功移除至 ${target} 个动态输出端口`);
            return target;
        }
    } catch (e) {
        errorLog(`<dynamic_io> [v6] Error update_output_ports:`, e);
        return 0;
    }
}
