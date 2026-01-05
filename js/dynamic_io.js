import { app } from "../../scripts/app.js";

// 控件名称常量
// const name__input_ports_count = "input_ports_count";
// const name__output_ports_count = "output_ports_count";

const max__dynamic_ports = 100;

// 注册扩展以修改节点行为
app.registerExtension({
    name: "dynamic.dynamic_io",

    // async nodeCreated(node) {

    //     if (!node.comfyClass.toLowerCase().startsWith("dynamic")) {
    //         return;
    //     }

    //     // 获取自定义数据
    //     const meta = data__node.input.meta__dynamic;

    //     // 检查是否具有目标元信息
    //     if (!check_meta(meta)) {
    //         return;
    //     }
    //     process(node, meta);
    // },

    async beforeRegisterNodeDef(type__node, data__node, app) {
        // console.log("<dynamic> checking node:", data__node.name);

        // 用于测试, 仅对特定节点启用
        // if (!data__node.name.toLowerCase().startsWith("dynamic")) {
        //     return;
        // }

        // 获取自定义数据
        const meta = data__node.input.meta__dynamic;

        // 检查是否具有目标元信息
        if (!check_meta(meta)) {
            return;
        }

        if (true) {
            // 保存原始的方法
            const on_node_created__origin = type__node.prototype.onNodeCreated;

            // 重写方法, 将原始函数放入闭包以供调用
            type__node.prototype.onNodeCreated = function () {
                // 调用原始的方法
                const result = on_node_created__origin?.apply(this, arguments);

                // if (!this.flag__processed) {
                //     process(this, meta);
                //     this.flag__processed = true;
                // }

                // 传入节点和元数据 (注意该函数只会在节点创建时执行一次)
                process(this, meta);

                return result;
            };
        }
    }
});

// 检查节点元数据
function check_meta(meta) {
    return meta && meta.dynamic_io &&
        (
            meta.dynamic_io.flag__dynamic_inputs
            || meta.dynamic_io.flag__dynamic_outputs
        )
        && meta.dynamic_io.name__dynamic_inputs_widget
        && meta.dynamic_io.name__dynamic_outputs_widget;
}

// 实现功能的主函数
// type__node.prototype.process =
function process(node, meta) {
    // 配置信息存在本地常量
    const flag__dynamic_inputs = meta.dynamic_io.flag__dynamic_inputs;
    const flag__dynamic_outputs = meta.dynamic_io.flag__dynamic_outputs;
    const count__fixed_inputs = meta.dynamic_io.count__fixed_inputs || 0;
    const count__fixed_outputs = meta.dynamic_io.count__fixed_outputs || 0;
    const name__dynamic_inputs_widget = meta.dynamic_io.name__dynamic_inputs_widget;
    const name__dynamic_outputs_widget = meta.dynamic_io.name__dynamic_outputs_widget;

    if (flag__dynamic_inputs) {
        // 处理动态输入端口

        // 查找 input_ports_count 控件
        const widget__input_ports_count
            = node.widgets?.find(w => w.name === name__dynamic_inputs_widget);

        if (widget__input_ports_count) {
            // 保存原始值 (这个值会传入闭包)
            let value__input_ports_count = widget__input_ports_count.value;
            // 标记是否已经重建过端口 (这个值会传入闭包)
            let flag__has_rebuilt = false;

            // 劫持 value 属性的 setter
            Object.defineProperty(widget__input_ports_count, 'value', {
                // 读取 value 时返回我们保存的值
                get() {
                    return value__input_ports_count;
                },

                // 写入 value 时执行自定义逻辑
                set(value__new) {
                    // 第一次赋值或值真正改变时重建端口
                    if (!flag__has_rebuilt) {
                        flag__has_rebuilt = true;
                        update_input_ports(node, count__fixed_inputs, value__new);
                    }
                    // 保存新值
                    value__input_ports_count = value__new;
                },

                // 允许后续重新定义该属性
                configurable: true,

                // 该属性可枚举 (在 for...in 中可见)
                enumerable: true
            });

            // 绑定控件的回调函数 (用于用户手动调整)
            const widget_callback__origin = widget__input_ports_count.callback;
            // 重写回调函数
            widget__input_ports_count.callback = function (value) {
                // 调用原始回调, 保持控件原有行为
                widget_callback__origin?.call(this, value);

                // 确保端口重建
                if (this.node) {
                    // 调用节点的方法更新端口, 并更新控件的值
                    this.value = update_input_ports(this.node, count__fixed_inputs, value);
                }
            };

            // 初始化时调用一次以设置正确的端口数量
            update_input_ports(node, count__fixed_inputs, widget__input_ports_count.value);
        }
    }

    if (flag__dynamic_outputs) {
        // 处理动态输出端口

        // 查找 output_ports_count 控件
        const widget__output_ports_count
            = node.widgets?.find(w => w.name === name__dynamic_outputs_widget);

        if (widget__output_ports_count) {
            // 保存原始值和重建状态
            let value__output_ports_count = widget__output_ports_count.value;
            // 标记是否已经重建过端口
            let flag__has_rebuilt = false;

            // 劫持 value 属性的 setter
            Object.defineProperty(widget__output_ports_count, 'value', {
                // 读取 value 时返回我们保存的值
                get() {
                    return value__output_ports_count;
                },
                // 写入 value 时执行我们的逻辑
                set(value__new) {
                    // 第一次赋值或值真正改变时重建端口
                    if (!flag__has_rebuilt) {
                        flag__has_rebuilt = true;
                        update_output_ports(node, count__fixed_outputs, value__new);
                    }
                    // 保存新值
                    value__output_ports_count = value__new;
                },
                // 允许后续重新定义该属性
                configurable: true,
                // 该属性可枚举 (在 for...in 中可见)
                enumerable: true
            });

            // 绑定控件的回调函数 (用于用户手动调整)
            const widget_callback__origin = widget__output_ports_count.callback;
            // 重写回调函数
            widget__output_ports_count.callback = function (value) {
                // 调用原始回调, 保持控件原有行为
                widget_callback__origin?.call(this, value);

                // 确保端口重建 (理论上 setter 已处理, 这里做双重保险)
                if (this.node) {
                    // 调用节点的方法更新端口, 并更新控件的值
                    this.value = update_output_ports(this.node, count__fixed_outputs, value);
                }
            };

            // 初始化时调用一次以设置正确的端口数量
            update_output_ports(node, count__fixed_outputs, widget__output_ports_count.value);
        }
    }
};

// 动态更新输入端口的方法, 返回操作结束后的动态端口的最终数量
// type__node.prototype.update_input_ports =
function update_input_ports(node, count__fixed, count__target) {
    try {
        // console.log("更新端口数量:", count__target);

        count__target = Math.max(0, Math.min(max__dynamic_ports, Math.floor(count__target)));
        const target = count__target;
        // 计算当前动态端口数量
        let count__current = (node.inputs?.length || count__fixed) - count__fixed;

        // console.log(`当前端口: ${count__current}, 目标: ${target}`);

        // 添加端口
        for (let i = count__current; i < target; i++) {
            const name = `input_${i}`;
            // console.log("添加:", name);
            node.addInput(name, "*");
            count__current++;
        }

        // 移除端口
        for (let i = count__current + count__fixed; i > target + count__fixed; i--) {
            const index__last = i - 1;
            if (index__last >= 0 && node.inputs[index__last] && !node.inputs[index__last].link) {
                // console.log("移除:", node.inputs[index__last].name);
                node.removeInput(index__last);
                count__current--;
            }
            else
                // 如果发现已连接的端口, 则停止移除以防止断开连接
                break;
        }

        // node.setSize(node.computeSize());
        node.setDirtyCanvas(true, true);
        // console.log("端口更新完成");
        return count__current;
    } catch (e) {
        console.error("updateInputPorts 错误:", e);
    }
    return 0;
};

// type__node.prototype.update_output_ports =
function update_output_ports(node, count__fixed, count__target) {
    try {
        // console.log("更新输出端口数量:", count__target);
        count__target = Math.max(0, Math.min(max__dynamic_ports, Math.floor(count__target)));
        const target = count__target;
        // 计算当前动态端口数量
        let count__current = (node.outputs?.length || count__fixed) - count__fixed;
        // console.log(`当前输出端口: ${count__current}, 目标: ${target}`);

        // 添加端口
        for (let i = count__current; i < target; i++) {
            const name = `output_${i}`;
            // console.log("添加输出:", name);
            node.addOutput(name, "*");
            count__current++;
        }
        // 移除端口
        for (let i = count__current + count__fixed; i > target + count__fixed; i--) {
            const index__last = i - 1;
            if (index__last >= 0
                && node.outputs[index__last]
                && (!node.outputs[index__last].links || node.outputs[index__last].links.length === 0)
            ) {
                // console.log("移除输出:", node.outputs[index__last].name);
                node.removeOutput(index__last);
                count__current--;
            }
            else
                // 如果发现已连接的端口, 则停止移除以防止断开连接
                break;
        }
        // node.setSize(node.computeSize());
        node.setDirtyCanvas(true, true);
        // console.log("输出端口更新完成");
        return count__current;
    } catch (e) {
        console.error("updateOutputPorts 错误:", e);
    }
    return 0;
}

