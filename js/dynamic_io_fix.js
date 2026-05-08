import { app } from "../../scripts/app.js";


// 修复了断线和刷新问题, 但新建节点 count 值错误设置为 -1


const max__dynamic_ports = 100;

app.registerExtension({
    name: "dynamic.dynamic_io__fix",

    async beforeRegisterNodeDef(type__node, data__node, app) {

        return;

        const meta = data__node.input.meta__dynamic;
        if (!check_meta(meta)) return;

        console.log(`<dynamic_io> Registering: ${data__node.name}`);

        const on_node_created__origin = type__node.prototype.onNodeCreated;
        const configure_origin = type__node.prototype.configure;

        // 拦截 configure (工作流恢复后调用)
        type__node.prototype.configure = function (config) {
            console.log(`<dynamic_io> configure: ${this.type} (ID: ${this.id})`);

            // 先执行原始 configure (恢复 widget 值和端口)
            const result = configure_origin?.apply(this, arguments);

            // configure 完成后,同步端口 (关键: 此时工作流值已就绪)
            if (this._dynamic_io_setup) {
                syncDynamicPorts(this, meta);
            }

            return result;
        };

        type__node.prototype.onNodeCreated = function () {
            console.log(`<dynamic_io> onNodeCreated: ${this.type} (ID: ${this.id})`);

            const result = on_node_created__origin?.apply(this, arguments);

            // 初始化动态 IO (劫持 setter,但不强制重建端口)
            setupDynamicIO(this, meta);
            this._dynamic_io_setup = true;

            return result;
        };
    }
});

function check_meta(meta) {
    return meta && meta.dynamic_io &&
        (meta.dynamic_io.flag__dynamic_inputs || meta.dynamic_io.flag__dynamic_outputs) &&
        (!meta.dynamic_io.flag__dynamic_inputs || meta.dynamic_io.name__dynamic_inputs_widget) &&
        (!meta.dynamic_io.flag__dynamic_outputs || meta.dynamic_io.name__dynamic_outputs_widget);
}

function setupDynamicIO(node, meta) {
    const flag__dynamic_inputs = meta.dynamic_io.flag__dynamic_inputs;
    const flag__dynamic_outputs = meta.dynamic_io.flag__dynamic_outputs;
    const count__fixed_inputs = meta.dynamic_io.count__fixed_inputs || 0;
    const count__fixed_outputs = meta.dynamic_io.count__fixed_outputs || 0;
    const name__dynamic_inputs_widget = meta.dynamic_io.name__dynamic_inputs_widget;
    const name__dynamic_outputs_widget = meta.dynamic_io.name__dynamic_outputs_widget;
    const prefix__dynamic_inputs = meta.dynamic_io.prefix__dynamic_inputs || "input_";
    const prefix__dynamic_outputs = meta.dynamic_io.prefix__dynamic_outputs || "output_";

    if (flag__dynamic_inputs) {
        setupWidget(node, count__fixed_inputs, name__dynamic_inputs_widget, prefix__dynamic_inputs, 'input');
    }
    if (flag__dynamic_outputs) {
        setupWidget(node, count__fixed_outputs, name__dynamic_outputs_widget, prefix__dynamic_outputs, 'output');
    }
}

function setupWidget(node, count__fixed, widget_name, prefix, type) {
    const widget = node.widgets?.find(w => w.name === widget_name);
    if (!widget || widget._dynamic_io_hooked) return;

    widget._dynamic_io_hooked = true;
    console.log(`<dynamic_io> Setup ${type} widget "${widget_name}"`);

    // 闭包变量: 跟踪当前应有的端口数
    let current_target = -1; // 初始 -1 确保首次赋值触发 setter

    // 劫持 widget.value
    Object.defineProperty(widget, 'value', {
        get() {
            return current_target;
        },
        set(new_value) {
            const num_value = Math.max(0, Math.min(max__dynamic_ports, parseInt(new_value) || 0));

            console.log(`<dynamic_io> ${type} setter: ${current_target} -> ${num_value}`);

            // 值变化时更新端口
            if (num_value !== current_target) {
                current_target = num_value;

                const update_fn = type === 'input' ? update_input_ports : update_output_ports;
                const actual = update_fn(node, count__fixed, num_value, prefix, widget_name);

                // 如果因连接锁定,同步实际值
                if (actual !== num_value) {
                    console.log(`<dynamic_io> ${type} locked at ${actual}`);
                    current_target = actual;
                }
            }
        },
        configurable: true,
        enumerable: true
    });

    // 绑定 callback (用户手动调整时)
    const widget_callback__origin = widget.callback;
    widget.callback = function (value) {
        console.log(`<dynamic_io> ${type} callback: ${value}`);
        widget_callback__origin?.call(this, value);
        const num = parseInt(value) || 0;
        if (widget.value !== num) {
            widget.value = num;
        }
    };
}

// 同步端口: configure 完成后调用,确保工作流值与实际端口一致
function syncDynamicPorts(node, meta) {
    console.log(`<dynamic_io> Syncing ports for node ${node.id}`);

    const flag__dynamic_inputs = meta.dynamic_io.flag__dynamic_inputs;
    const flag__dynamic_outputs = meta.dynamic_io.flag__dynamic_outputs;
    const count__fixed_inputs = meta.dynamic_io.count__fixed_inputs || 0;
    const count__fixed_outputs = meta.dynamic_io.count__fixed_outputs || 0;
    const name__dynamic_inputs_widget = meta.dynamic_io.name__dynamic_inputs_widget;
    const name__dynamic_outputs_widget = meta.dynamic_io.name__dynamic_outputs_widget;

    // 同步输入端口
    if (flag__dynamic_inputs) {
        const widget = node.widgets?.find(w => w.name === name__dynamic_inputs_widget);
        if (widget) {
            const workflow_value = parseInt(widget.value) || 0;
            const current_total = node.inputs?.length || count__fixed_inputs;
            const actual_dynamic = Math.max(0, current_total - count__fixed_inputs);

            console.log(`<dynamic_io> Input check: workflow=${workflow_value}, actual=${actual_dynamic}`);

            // 关键: 只有当实际端口数与工作流值不符时,才触发 setter 重建
            if (actual_dynamic !== workflow_value) {
                console.log(`<dynamic_io> Mismatch! Rebuilding inputs to ${workflow_value}`);
                widget.value = workflow_value;
            } else {
                console.log(`<dynamic_io> Input count matches, no rebuild needed`);
                // 静默更新内部值,避免后续误触发
                const descriptor = Object.getOwnPropertyDescriptor(widget, 'value');
                if (descriptor) {
                    // 直接修改 current_target (通过重新调用 setter 会递归,所以直接赋值)
                    // 实际上不需要操作,因为值已经正确
                }
            }
        }
    }

    // 同步输出端口 (类似逻辑)
    if (flag__dynamic_outputs) {
        const widget = node.widgets?.find(w => w.name === name__dynamic_outputs_widget);
        if (widget) {
            const workflow_value = parseInt(widget.value) || 0;
            const current_total = node.outputs?.length || count__fixed_outputs;
            const actual_dynamic = Math.max(0, current_total - count__fixed_outputs);

            console.log(`<dynamic_io> Output check: workflow=${workflow_value}, actual=${actual_dynamic}`);

            if (actual_dynamic !== workflow_value) {
                console.log(`<dynamic_io> Mismatch! Rebuilding outputs to ${workflow_value}`);
                widget.value = workflow_value;
            } else {
                console.log(`<dynamic_io> Output count matches, no rebuild needed`);
            }
        }
    }
}

// 更新输入端口 (带连接保护)
function update_input_ports(node, count__fixed, count__target, prefix, widget_name) {
    try {
        count__target = Math.max(0, Math.min(max__dynamic_ports, Math.floor(count__target)));
        const target = count__target;

        const current_total = node.inputs?.length || count__fixed;
        const current_dynamic = Math.max(0, current_total - count__fixed);

        console.log(`<dynamic_io> Update inputs: fixed=${count__fixed}, current=${current_dynamic}, target=${target}`);

        if (target === current_dynamic) {
            console.log(`<dynamic_io> No change needed`);
            return target;
        }

        // 添加端口 (增量)
        if (target > current_dynamic) {
            console.log(`<dynamic_io> Adding ${target - current_dynamic} inputs`);
            for (let i = current_dynamic; i < target; i++) {
                const name = `${prefix}${i}`;
                const exists = node.inputs?.some(inp => inp.name === name);
                if (!exists) {
                    const idx = count__fixed + i;
                    console.log(`<dynamic_io> Add input[${idx}]: ${name}`);
                    node.addInput(name, "*");
                }
            }
            node.setDirtyCanvas(true, true);
            return target;
        }

        // 移除端口 (从后往前,遇连接即停)
        if (target < current_dynamic) {
            console.log(`<dynamic_io> Removing inputs from ${current_dynamic} to ${target}`);

            for (let i = current_total - 1; i >= count__fixed + target; i--) {
                if (i < 0 || !node.inputs[i]) continue;

                const input = node.inputs[i];
                const is_connected = input.link !== null && input.link !== undefined;

                console.log(`<dynamic_io> Check input[${i}] "${input.name}": link=${input.link}`);

                if (is_connected) {
                    const locked_count = i - count__fixed + 1;
                    console.log(`<dynamic_io> STOP at connected input ${input.name}, lock to ${locked_count}`);
                    return locked_count;
                }

                console.log(`<dynamic_io> Remove input[${i}]: ${input.name}`);
                node.removeInput(i);
            }

            node.setDirtyCanvas(true, true);
            return target;
        }
    } catch (e) {
        console.error(`<dynamic_io> Error update_input_ports:`, e);
        return 0;
    }
}

// 更新输出端口 (类似逻辑)
function update_output_ports(node, count__fixed, count__target, prefix, widget_name) {
    try {
        count__target = Math.max(0, Math.min(max__dynamic_ports, Math.floor(count__target)));
        const target = count__target;

        const current_total = node.outputs?.length || count__fixed;
        const current_dynamic = Math.max(0, current_total - count__fixed);

        console.log(`<dynamic_io> Update outputs: fixed=${count__fixed}, current=${current_dynamic}, target=${target}`);

        if (target === current_dynamic) return target;

        if (target > current_dynamic) {
            console.log(`<dynamic_io> Adding ${target - current_dynamic} outputs`);
            for (let i = current_dynamic; i < target; i++) {
                const name = `${prefix}${i}`;
                const exists = node.outputs?.some(out => out.name === name);
                if (!exists) {
                    const idx = count__fixed + i;
                    console.log(`<dynamic_io> Add output[${idx}]: ${name}`);
                    node.addOutput(name, "*");
                }
            }
            node.setDirtyCanvas(true, true);
            return target;
        }

        if (target < current_dynamic) {
            console.log(`<dynamic_io> Removing outputs from ${current_dynamic} to ${target}`);

            for (let i = current_total - 1; i >= count__fixed + target; i--) {
                if (i < 0 || !node.outputs[i]) continue;

                const output = node.outputs[i];
                const has_links = output.links && output.links.length > 0;

                console.log(`<dynamic_io> Check output[${i}] "${output.name}": links=${output.links?.length || 0}`);

                if (has_links) {
                    const locked_count = i - count__fixed + 1;
                    console.log(`<dynamic_io> STOP at connected output ${output.name}, lock to ${locked_count}`);
                    return locked_count;
                }

                console.log(`<dynamic_io> Remove output[${i}]: ${output.name}`);
                node.removeOutput(i);
            }

            node.setDirtyCanvas(true, true);
            return target;
        }
    } catch (e) {
        console.error(`<dynamic_io> Error update_output_ports:`, e);
        return 0;
    }
}
