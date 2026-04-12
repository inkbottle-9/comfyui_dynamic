import { app } from "../../scripts/app.js";


// 修复断线和刷新问题, 同时修复新建节点 count 值错误的问题


const max__dynamic_ports = 100;

app.registerExtension({
    name: "dynamic.dynamic_io__fix_v4",

    async beforeRegisterNodeDef(type__node, data__node, app) {

        return;

        const meta = data__node.input.meta__dynamic;
        if (!check_meta(meta)) return;

        console.log(`<dynamic_io> [v4] Registering: ${data__node.name}`);

        const on_node_created__origin = type__node.prototype.onNodeCreated;
        const configure_origin = type__node.prototype.configure;

        // 拦截 configure（工作流恢复后调用）
        type__node.prototype.configure = function (config) {
            console.log(`<dynamic_io> [v4] configure: ${this.type} (ID: ${this.id})`);

            // 标记为工作流加载（阻止 setTimeout 的初始化）
            this._pending_dynamic_init = false;

            // 先执行原始 configure（恢复 widget 值和端口连接）
            const result = configure_origin?.apply(this, arguments);

            // configure 完成后，同步端口（此时 widget 值已是工作流保存值）
            if (this._dynamic_io_setup) {
                console.log(`<dynamic_io> [v4] 工作流加载，执行 syncDynamicPorts`);
                syncDynamicPorts(this, meta);
            }

            return result;
        };

        type__node.prototype.onNodeCreated = function () {
            console.log(`<dynamic_io> [v4] onNodeCreated: ${this.type} (ID: ${this.id})`);

            const result = on_node_created__origin?.apply(this, arguments);

            // 初始化动态 IO（劫持 setter，但不立即创建端口）
            setupDynamicIO(this, meta);
            this._dynamic_io_setup = true;

            // 标记等待初始化（区分新建节点 vs 工作流加载）
            this._pending_dynamic_init = true;

            // 延迟检查：如果下一个 tick 仍然是 pending，说明是新建节点（无 configure）
            setTimeout(() => {
                if (this._pending_dynamic_init && this._dynamic_io_setup) {
                    console.log(`<dynamic_io> [v4] 新建节点检测，执行初始端口同步`);
                    this._pending_dynamic_init = false;
                    syncDynamicPorts(this, meta);
                }
            }, 0);

            return result;
        };
    }
});

function check_meta(meta) {
    const valid = meta && meta.dynamic_io &&
        (meta.dynamic_io.flag__dynamic_inputs || meta.dynamic_io.flag__dynamic_outputs) &&
        (!meta.dynamic_io.flag__dynamic_inputs || meta.dynamic_io.name__dynamic_inputs_widget) &&
        (!meta.dynamic_io.flag__dynamic_outputs || meta.dynamic_io.name__dynamic_outputs_widget);

    if (meta && meta.dynamic_io) {
        console.log(`<dynamic_io> [v4] check_meta: inputs=${meta.dynamic_io.flag__dynamic_inputs}, outputs=${meta.dynamic_io.flag__dynamic_outputs}`);
    }
    return valid;
}

function setupDynamicIO(node, meta) {
    console.log(`<dynamic_io> [v4] setupDynamicIO for node ${node.id}`);

    const flag__dynamic_inputs = meta.dynamic_io.flag__dynamic_inputs;
    const flag__dynamic_outputs = meta.dynamic_io.flag__dynamic_outputs;
    const count__fixed_inputs = meta.dynamic_io.count__fixed_inputs || 0;
    const count__fixed_outputs = meta.dynamic_io.count__fixed_outputs || 0;
    const name__dynamic_inputs_widget = meta.dynamic_io.name__dynamic_inputs_widget;
    const name__dynamic_outputs_widget = meta.dynamic_io.name__dynamic_outputs_widget;
    const prefix__dynamic_inputs = meta.dynamic_io.prefix__dynamic_inputs || "input_";
    const prefix__dynamic_outputs = meta.dynamic_io.prefix__dynamic_outputs || "output_";

    if (flag__dynamic_inputs) {
        console.log(`<dynamic_io> [v4] 准备设置输入 widget: ${name__dynamic_inputs_widget}`);
        setupWidget(node, count__fixed_inputs, name__dynamic_inputs_widget, prefix__dynamic_inputs, 'input');
    }
    if (flag__dynamic_outputs) {
        console.log(`<dynamic_io> [v4] 准备设置输出 widget: ${name__dynamic_outputs_widget}`);
        setupWidget(node, count__fixed_outputs, name__dynamic_outputs_widget, prefix__dynamic_outputs, 'output');
    }
}

function setupWidget(node, count__fixed, widget_name, prefix, type) {
    const widget = node.widgets?.find(w => w.name === widget_name);
    if (!widget) {
        console.log(`<dynamic_io> [v4] 警告: 未找到 widget "${widget_name}"`);
        return;
    }

    if (widget._dynamic_io_hooked) {
        console.log(`<dynamic_io> [v4] widget "${widget_name}" 已被劫持，跳过`);
        return;
    }

    // 关键修复：劫持前先保存 Python 定义的原始默认值
    const raw_default_value = widget.value;
    console.log(`<dynamic_io> [v4] Setup ${type} widget "${widget_name}" | 原始默认值: ${raw_default_value}`);

    widget._dynamic_io_hooked = true;

    // 初始化为 -1 表示尚未初始化，等待 syncDynamicPorts 首次赋值
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

            console.log(`<dynamic_io> [v4] ${type} setter: ${current_target} -> ${num_value} (输入值: ${new_value})`);

            // 值变化时更新端口（-1 表示首次初始化，必定触发）
            if (num_value !== current_target) {
                const old_target = current_target;
                current_target = num_value;

                const update_fn = type === 'input' ? update_input_ports : update_output_ports;
                const actual = update_fn(node, count__fixed, num_value, prefix, widget_name);

                // 如果因连接锁定，同步实际值
                if (actual !== num_value) {
                    console.log(`<dynamic_io> [v4] ${type} 因连接锁定，调整至: ${actual}`);
                    current_target = actual;
                }

                // 触发重绘（初始化时不重复触发）
                if (old_target !== -1) {
                    node.setDirtyCanvas(true, true);
                }
            } else {
                console.log(`<dynamic_io> [v4] ${type} setter: 值未变化，跳过端口更新`);
            }
        },
        configurable: true,
        enumerable: true
    });

    // 绑定 callback（用户手动调整 widget 值时）
    const widget_callback__origin = widget.callback;
    widget.callback = function (value) {
        console.log(`<dynamic_io> [v4] ${type} callback 触发: ${value}`);
        widget_callback__origin?.call(this, value);
        const num = parseInt(value) || 0;
        if (widget.value !== num) {
            widget.value = num;
        }
    };

    console.log(`<dynamic_io> [v4] widget "${widget_name}" 劫持完成，current_target: ${widget.value}, 原始默认值已保存: ${widget._dynamic_raw_default}`);
}

// 同步端口：比较当前实际端口数与 widget 目标值，必要时重建
function syncDynamicPorts(node, meta) {
    console.log(`<dynamic_io> [v4] Syncing ports for node ${node.id}`);

    const flag__dynamic_inputs = meta.dynamic_io.flag__dynamic_inputs;
    const flag__dynamic_outputs = meta.dynamic_io.flag__dynamic_outputs;
    const count__fixed_inputs = meta.dynamic_io.count__fixed_inputs || 0;
    const count__fixed_outputs = meta.dynamic_io.count__fixed_outputs || 0;
    const name__dynamic_inputs_widget = meta.dynamic_io.name__dynamic_inputs_widget;
    const name__dynamic_outputs_widget = meta.dynamic_io.name__dynamic_outputs_widget;
    const prefix__dynamic_inputs = meta.dynamic_io.prefix__dynamic_inputs || "input_";
    const prefix__dynamic_outputs = meta.dynamic_io.prefix__dynamic_outputs || "output_";

    // 同步输入端口
    if (flag__dynamic_inputs) {
        const widget = node.widgets?.find(w => w.name === name__dynamic_inputs_widget);
        if (widget) {
            // 关键修复：检测首次初始化状态（value 为 -1 且保存了原始默认值）
            let target_value;
            if (widget.value === -1 && widget._dynamic_raw_default !== undefined) {
                // 新建节点首次初始化：使用 Python 原始默认值
                target_value = Math.max(0, Math.min(max__dynamic_ports, parseInt(widget._dynamic_raw_default) || 0));
                console.log(`<dynamic_io> [v4] Input 首次初始化，使用原始默认值: ${target_value} (raw: ${widget._dynamic_raw_default})`);
            } else {
                // 工作流加载或后续修改：使用当前值
                target_value = Math.max(0, Math.min(max__dynamic_ports, parseInt(widget.value) || 0));
                console.log(`<dynamic_io> [v4] Input 使用当前值: ${target_value}`);
            }

            const current_total = node.inputs?.length || count__fixed_inputs;
            const actual_dynamic = Math.max(0, current_total - count__fixed_inputs);

            console.log(`<dynamic_io> [v4] Input check: 目标=${target_value}, 当前总计=${current_total}, 固定=${count__fixed_inputs}, 动态=${actual_dynamic}`);

            // 只有在不匹配时才触发 setter
            if (actual_dynamic !== target_value) {
                console.log(`<dynamic_io> [v4] 输入端口不匹配 (${actual_dynamic} != ${target_value})，触发重建`);
                widget.value = target_value;
            } else {
                console.log(`<dynamic_io> [v4] 输入端口数量匹配，无需重建`);
            }
        } else {
            console.log(`<dynamic_io> [v4] 同步时未找到输入 widget: ${name__dynamic_inputs_widget}`);
        }
    }

    // 同步输出端口（类似逻辑）
    if (flag__dynamic_outputs) {
        const widget = node.widgets?.find(w => w.name === name__dynamic_outputs_widget);
        if (widget) {
            let target_value;
            if (widget.value === -1 && widget._dynamic_raw_default !== undefined) {
                target_value = Math.max(0, Math.min(max__dynamic_ports, parseInt(widget._dynamic_raw_default) || 0));
                console.log(`<dynamic_io> [v4] Output 首次初始化，使用原始默认值: ${target_value} (raw: ${widget._dynamic_raw_default})`);
            } else {
                target_value = Math.max(0, Math.min(max__dynamic_ports, parseInt(widget.value) || 0));
                console.log(`<dynamic_io> [v4] Output 使用当前值: ${target_value}`);
            }

            const current_total = node.outputs?.length || count__fixed_outputs;
            const actual_dynamic = Math.max(0, current_total - count__fixed_outputs);

            console.log(`<dynamic_io> [v4] Output check: 目标=${target_value}, 当前总计=${current_total}, 固定=${count__fixed_outputs}, 动态=${actual_dynamic}`);

            if (actual_dynamic !== target_value) {
                console.log(`<dynamic_io> [v4] 输出端口不匹配 (${actual_dynamic} != ${target_value})，触发重建`);
                widget.value = target_value;
            } else {
                console.log(`<dynamic_io> [v4] 输出端口数量匹配，无需重建`);
            }
        } else {
            console.log(`<dynamic_io> [v4] 同步时未找到输出 widget: ${name__dynamic_outputs_widget}`);
        }
    }
}

// 更新输入端口（带连接保护 / count 锁）
function update_input_ports(node, count__fixed, count__target, prefix, widget_name) {
    try {
        count__target = Math.max(0, Math.min(max__dynamic_ports, Math.floor(count__target)));
        const target = count__target;

        const current_total = node.inputs?.length || count__fixed;
        const current_dynamic = Math.max(0, current_total - count__fixed);

        console.log(`<dynamic_io> [v4] Update inputs: 固定=${count__fixed}, 当前动态=${current_dynamic}, 目标=${target}, 当前总计=${current_total}`);

        if (target === current_dynamic) {
            console.log(`<dynamic_io> [v4] 输入端口无需变化`);
            return target;
        }

        // 添加端口（增量）
        if (target > current_dynamic) {
            console.log(`<dynamic_io> [v4] 准备添加 ${target - current_dynamic} 个输入端口`);
            for (let i = current_dynamic; i < target; i++) {
                const name = `${prefix}${i}`;
                const exists = node.inputs?.some(inp => inp.name === name);
                if (!exists) {
                    const idx = count__fixed + i;
                    console.log(`<dynamic_io> [v4] 添加输入端口 [${idx}]: ${name}`);
                    node.addInput(name, "*");
                } else {
                    console.log(`<dynamic_io> [v4] 输入端口 ${name} 已存在，跳过`);
                }
            }
            node.setDirtyCanvas(true, true);
            return target;
        }

        // 移除端口（从后往前，遇连接即停 - count 锁机制）
        if (target < current_dynamic) {
            console.log(`<dynamic_io> [v4] 准备移除输入端口，从 ${current_dynamic} 减至 ${target}（从后往前检查连接）`);

            for (let i = current_total - 1; i >= count__fixed + target; i--) {
                if (i < 0 || !node.inputs[i]) continue;

                const input = node.inputs[i];
                const is_connected = input.link !== null && input.link !== undefined;

                console.log(`<dynamic_io> [v4] 检查输入端口 [${i}] "${input.name}": 连接状态=${is_connected}, link=${input.link}`);

                if (is_connected) {
                    const locked_count = i - count__fixed + 1;
                    console.log(`<dynamic_io> [v4] [COUNT 锁] 端口 "${input.name}" 有连接，锁定计数为 ${locked_count}，停止移除`);
                    return locked_count;
                }

                console.log(`<dynamic_io> [v4] 移除输入端口 [${i}]: ${input.name}`);
                node.removeInput(i);
            }

            node.setDirtyCanvas(true, true);
            console.log(`<dynamic_io> [v4] 成功移除至 ${target} 个动态输入端口`);
            return target;
        }
    } catch (e) {
        console.error(`<dynamic_io> [v4] Error update_input_ports:`, e);
        return 0;
    }
}

// 更新输出端口（带 count 锁）
function update_output_ports(node, count__fixed, count__target, prefix, widget_name) {
    try {
        count__target = Math.max(0, Math.min(max__dynamic_ports, Math.floor(count__target)));
        const target = count__target;

        const current_total = node.outputs?.length || count__fixed;
        const current_dynamic = Math.max(0, current_total - count__fixed);

        console.log(`<dynamic_io> [v4] Update outputs: 固定=${count__fixed}, 当前动态=${current_dynamic}, 目标=${target}, 当前总计=${current_total}`);

        if (target === current_dynamic) return target;

        if (target > current_dynamic) {
            console.log(`<dynamic_io> [v4] 准备添加 ${target - current_dynamic} 个输出端口`);
            for (let i = current_dynamic; i < target; i++) {
                const name = `${prefix}${i}`;
                const exists = node.outputs?.some(out => out.name === name);
                if (!exists) {
                    const idx = count__fixed + i;
                    console.log(`<dynamic_io> [v4] 添加输出端口 [${idx}]: ${name}`);
                    node.addOutput(name, "*");
                } else {
                    console.log(`<dynamic_io> [v4] 输出端口 ${name} 已存在，跳过`);
                }
            }
            node.setDirtyCanvas(true, true);
            return target;
        }

        if (target < current_dynamic) {
            console.log(`<dynamic_io> [v4] 准备移除输出端口，从 ${current_dynamic} 减至 ${target}（从后往前检查连接）`);

            for (let i = current_total - 1; i >= count__fixed + target; i--) {
                if (i < 0 || !node.outputs[i]) continue;

                const output = node.outputs[i];
                const has_links = output.links && output.links.length > 0;

                console.log(`<dynamic_io> [v4] 检查输出端口 [${i}] "${output.name}": 连接数=${output.links?.length || 0}`);

                if (has_links) {
                    const locked_count = i - count__fixed + 1;
                    console.log(`<dynamic_io> [v4] [COUNT 锁] 端口 "${output.name}" 有连接，锁定计数为 ${locked_count}，停止移除`);
                    return locked_count;
                }

                console.log(`<dynamic_io> [v4] 移除输出端口 [${i}]: ${output.name}`);
                node.removeOutput(i);
            }

            node.setDirtyCanvas(true, true);
            console.log(`<dynamic_io> [v4] 成功移除至 ${target} 个动态输出端口`);
            return target;
        }
    } catch (e) {
        console.error(`<dynamic_io> [v4] Error update_output_ports:`, e);
        return 0;
    }
}
