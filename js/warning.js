import { app } from "../../scripts/app.js";


const string__warning_load =
    `
您正在打开一个带有解除了包导入限制的脚本节点的工作流,
在确认节点中代码的安全性之前请务必不能执行工作流;
恶意代码可能会窃取您的个人信息, 文件, 或造成其它损失;
如果您不了解上述内容, 或您不知道为何出现此警告, 请点击 "取消",
工作流仍会加载, 但相关节点会保持包导入限制以提升安全性 (并非完全安全).

You are opening a workflow that contains script nodes with package import restrictions removed.
You MUST verify the code in these nodes is safe BEFORE executing the workflow.
Malicious code can steal your personal information, files, or cause other damage.
If you do not understand this warning, or do not know why it appears, click "Cancel".
The workflow will still load, but the affected nodes will remain restricted for increased security
(not completely secure).
`;

const string__warning_open =
    `
您正在尝试解除该节点的包导入限制, 解除包导入限制后节点可以执行任意代码,
在确认节点中代码的安全性之前请务必不能执行工作流;
恶意代码可能会窃取您的个人信息, 文件, 或造成其它损失;
如果您不了解上述内容, 或您不知道为何出现此警告, 请点击 "取消".

You are about to remove package import restrictions for this node.
Once removed, the node can execute arbitrary code.
You MUST confirm the code is safe BEFORE executing the workflow.
Malicious code can steal your personal information, files, or cause other damage.
If you do not understand this warning, or do not know why it appears, click "Cancel".
    `;


// 定义危险状态的颜色
const DANGER_NODE_COLORS = {
    color__background: "#660000",      // 深红色背景
    color__foreground: "#ff0000",        // 亮红色标题
    color__warning: "#ffcc66",  // 警告图标颜色
};

// 原始颜色 (恢复正常时)
const NORMAL_NODE_COLORS = {
    color__background: undefined,
    color__foreground: undefined,
};


// 检查字符串是否为空或仅包含空白字符
function is_blank(str) {
    if (str === null || str === undefined)
        return true;
    if (typeof str !== "string")
        // 非字符串直接算空
        return true;
    // 检查是否全是空白字符
    return str.trim().length === 0;
}

// 检查节点元数据
function check_meta(meta) {
    return meta && meta.warning && !is_blank(meta.warning.info__warning)
}

// 注册扩展以修改节点行为
app.registerExtension({
    name: "dynamic.warning",

    // 图刚开始加载的回调, 先在此创建闭包变量
    async beforeConfigureGraph(_data, _array, _app) {
        // console.log("<dynamic> beforeConfigureGraph");

        // 注入一个对象
        if (_app && _app.graph)
            _app.graph.status__dynamic_warning =
            {
                flag__confirmed: false,
                // 组件
                dict__widgets: new Map(),
            };
    },

    async afterConfigureGraph(_array, _app) {
        // let a = arguments;
        // console.log("<dynamic> afterConfigureGraph");

        const status__dynamic_warning = _app?.graph?.status__dynamic_warning;

        // 检查字典中是否有项
        if (status__dynamic_warning && status__dynamic_warning.dict__widgets.size > 0) {
            // 下一帧时弹出提示
            requestAnimationFrame(async () => {
                try {
                    status__dynamic_warning.flag__confirmed
                        // show_warning 是协程式异步函数
                        // 这里通过 await 阻塞式调用
                        = await show_warning(string__warning_load);

                    if (status__dynamic_warning.flag__confirmed) {
                        // 确认后遍历处理
                        for (const [widget, value] of status__dynamic_warning.dict__widgets) {
                            // 调用组件的回调函数修改数据
                            widget.callback(value.confirmed);
                        }
                    }
                    else {
                        // 确认后遍历回滚
                        for (const [widget, value] of status__dynamic_warning.dict__widgets) {
                            // 调用组件的回调函数修改数据
                            widget.callback(value.rollback);
                        }
                    }
                } finally {
                    // 只提示一次, 之后就清除容器
                    status__dynamic_warning.dict__widgets?.clear();
                }

            });
        }
    },

    // 节点创建时初始化
    async beforeRegisterNodeDef(type__node, data__node, app) {

        // 获取自定义数据
        const meta = data__node.input.meta__dynamic;

        // 检查是否具有目标元信息
        if (!check_meta(meta)) {
            return;
        }

        const widget_name = meta.warning.widget_name__warning;

        // 保存原始的方法
        const on_node_created__origin = type__node.prototype.onNodeCreated;

        // 重写方法, 将原始函数放入闭包以供调用
        type__node.prototype.onNodeCreated = function () {
            // 调用原始的方法
            const result = on_node_created__origin?.apply(this, arguments);

            // 如果指定了属性名称, 则监听该属性变化
            if (!is_blank(widget_name)) {
                // 查找对应的组件
                const widget__target = this.widgets?.find(w => w.name === widget_name);
                // 如果找到了组件
                if (widget__target) {

                    // 绑定控件的回调函数 (用于用户手动调整)
                    const widget_callback__origin = widget__target.callback;

                    // 重写回调函数 (注意点击按钮时组件的值已经强制改变了, 无法保存老的值)
                    widget__target.callback = async function (_value) {
                        // 调用原始回调, 保持控件原有行为 (但是不修改值)
                        if (widget_callback__origin)
                            widget_callback__origin.call(this, _value);

                        if (
                            this.node
                            && this.node.graph
                            && this.node.graph.status__dynamic_warning
                        ) {
                            // 获取结果, 注意 process 是 async 的 (内部最终可能调用非模态对话框)
                            let result = await process(
                                _value,
                                this.node.graph.status__dynamic_warning,
                                this.node, meta
                            );

                            // 赋值
                            if (result)
                                this.value = meta.warning.status__warning;
                            else
                                this.value = meta.warning.status__rollback;
                        }
                    };

                    add_to_dict(widget__target, this.graph, meta);

                    // 初始更新节点颜色 (恢复到常规颜色)
                    update_node_color(this, false);
                }
            }
            return result;
        }

        // 保存原始的方法
        const on_configure__origin = type__node.prototype.onConfigure;

        // 重写方法, 将原始函数放入闭包以供调用
        type__node.prototype.onConfigure = function () {
            // 调用原始的方法
            const result = on_configure__origin?.apply(this, arguments);

            if (!is_blank(widget_name)) {
                // 查找对应的组件
                const widget__target = this.widgets?.find(w => w.name === widget_name);
                // 如果找到了组件
                if (widget__target) {
                    // 如果是开启文件时就存在的节点,
                    // 那么调用节点创建回调时值没有就绪仍是默认值,
                    // 因此无法加入字典, 只有到了 onConfigure 阶段才会将值恢复
                    // 添加到字典
                    add_to_dict(widget__target, this.graph, meta);
                    // 初始更新节点颜色 (恢复到常规颜色)
                    update_node_color(this, false);
                }
            }

            return result;
        }

    },
});

function add_to_dict(_widget, _graph, _meta) {
    // 检查是否在开启时就是警告状态的节点, 是则加入容器
    if (_widget.value == _meta.warning.status__warning) {
        if (_graph && _graph.status__dynamic_warning)
            if (!_graph.status__dynamic_warning.dict__widgets.has(_widget))
                _graph.status__dynamic_warning.dict__widgets.set(
                    _widget,
                    {
                        // 用户确认时应用的值
                        confirmed: _widget.value,
                        // 用于取消时应用的值
                        rollback: _meta.warning.status__rollback,
                    }
                );
        // 初始化为安全状态, 确保组件值不会错误地被置于危险状态
        _widget.value = _meta.warning.status__rollback;
    }
}

// 注意该函数靠 value 确定行为而不是传入的 widget__target 的值
// 返回是否应该切换到新的值上
async function process(_value, _status, _node, _meta) {
    let flag__result = false;
    // 如果启用且未确认过, 弹出警告
    if (_value === _meta.warning.status__warning) {
        if (_status && !_status.flag__confirmed) {
            // show_warning 是协程式异步函数
            // 这里通过 await 阻塞式调用
            _status.flag__confirmed
                = await show_warning(string__warning_open);
        }
        if (_status.flag__confirmed) {
            flag__result = true;
        }
    }
    // 更新颜色
    update_node_color(_node, flag__result);
    return flag__result;
}

// 显示危险警告, 协程式异步函数
async function show_warning(string__warning) {
    // 浏览器提供的底层阻塞式接口
    // return confirm(string__warning);

    // 等待中断
    const flag__confirmed = await window['app'].extensionManager.dialog
        .confirm({
            title: 'Warning !!!',         // 对话框标题
            message: string__warning  // 提示内容
        });
    // 调用传入的回调闭包, 将用户确认结果传入
    // after_warning(flag__confirmed, _flag__warned, _widget__target, _meta);
    return flag__confirmed;
}

// 更新节点颜色
function update_node_color(node, flag__warning) {
    const colors = flag__warning ? DANGER_NODE_COLORS : NORMAL_NODE_COLORS;

    if (node) {
        // 修改 LiteGraph 节点属性
        node.bgcolor = colors.color__background;
        // node.color = colors.color__foreground;

        // 强制重绘
        node.setDirtyCanvas(true, true);
    }
}


