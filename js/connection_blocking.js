import { app } from "../../scripts/app.js";


// 检查节点元数据
function check_meta(meta) {
    return meta && meta.connection_blocking
}

function object_to_map_safe(obj) {
    const map = new Map();

    for (const [key, value] of Object.entries(obj)) {
        // 检查是否是对象自有属性
        if (!Object.prototype.hasOwnProperty.call(obj, key))
            continue;

        const key__int = Number(key); // 或 parseInt(key, 10)
        const value__int = Number(value);

        // 严格验证（拒绝 NaN、Infinity 等）
        if (Number.isInteger(key__int) && Number.isInteger(value__int)) {
            map.set(key__int, value__int);
        } else {
            console.warn(`<dynamic> skip invalid key value pair: ${key__int} => ${value__int}`);
        }
    }

    return map;
}

app.registerExtension({
    name: "dynamic.connection_blocking",

    async beforeRegisterNodeDef(type__node, data__node, app) {

        // 获取自定义数据
        const meta = data__node.input.meta__dynamic;

        if (!check_meta(meta)) {
            return;
        }

        // 转换为字典 (map, 映射表)
        const dict__indexes = object_to_map_safe(meta.connection_blocking);

        const on_connect_input__origin = type__node.prototype.onConnectInput;

        type__node.prototype.onConnectInput = function (_index, _type, _node, _slot) {
            on_connect_input__origin?.call(this, _index, _type, _node, _slot);

            const side__target = dict__indexes.get(_index);
            if (side__target === LiteGraph.INPUT || side__target === 3)
                return false;
            return true;
        };

        const on_connect_output__origin = type__node.prototype.onConnectOutput;

        type__node.prototype.onConnectOutput = function (_index, _type, _node, _slot) {
            on_connect_output__origin?.call(this, _index, _type, _node, _slot);

            const side__target = dict__indexes.get(_index);
            if (side__target === LiteGraph.OUTPUT || side__target === 3)
                return false;
            return true;
        };

        const on_connections_change = type__node.prototype.onConnectionsChange;

        // LiteGraph.INPUT = 1, LiteGraph.OUTPUT = 2
        type__node.prototype.onConnectionsChange = function (_side, _index, _flag__connected, _link_info, _slot) {
            // 注意 arguments 在参数变量被修改后不会同步
            on_connections_change?.apply(this, arguments);

            // 断开信号直接忽略
            if (!_flag__connected || !_link_info)
                return;

            // 获取当前 graph 实例
            const graph = this.graph;
            const side__target = dict__indexes.get(_index);

            if (_side === side__target || side__target === 3) {
                graph?.removeLink(_link_info.id);
            }
        };


    }
});
