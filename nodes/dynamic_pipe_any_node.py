from ..core.utils import get_category
from ..core.utils import append_tags
from ..core.utils import get_node_name

from ..core.utils import any_type
from ..core.utils import FlexibleOptionalInputTypeLazy
from ..core.utils import ByPassTypeTuple


class DynamicPipeAnyNode:

    # 节点名称
    NAME = append_tags(
        get_node_name("pipe_any "),
        [
            "pipe",
        ],
    )
    # 节点分类
    CATEGORY = get_category("utils")
    # 函数名
    FUNCTION = "main"

    # 返回类型
    RETURN_TYPES = ByPassTypeTuple(("python_list",))
    # 返回端口名称
    RETURN_NAMES = ByPassTypeTuple(("pipe",))
    # 返回端口工具提示
    OUTPUT_TOOLTIPS = ("A pipe is essentially a Python list.",)

    DESCRIPTION = (
        "This node works just like you'd expect. Still unsure? Here are the details: "
        "it builds a new list sized to your ports_count. "
        "Takes your pipe if you got one, pads with None or trims to fit, "
        "then replaces positions with any connected dynamic inputs (input_*) that aren't None. "
        "Outputs the full list as 'pipe', plus each item on its own through dynamic outputs (output_*)."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "ports_count": (
                    "INT",
                    {
                        "default": 2,
                        "min": 0,
                        "max": 100,
                        "step": 1,
                        "tooltip": "The number of port-pair for this node.",
                    },
                ),
            },
            "optional": {
                "pipe": (
                    "python_list",
                    {"default": [], "tooltip": "The pipe in. Accept any Python list."},
                ),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "prompt": "PROMPT",
                "dynprompt": "DYNPROMPT",
            },
            "meta__dynamic": {
                "dynamic_io": {
                    # 启用动态输入
                    "flag__dynamic_inputs": True,
                    # 启用动态输出
                    "flag__dynamic_outputs": True,
                    "count__fixed_inputs": 2,
                    "count__fixed_outputs": 1,
                    "name__dynamic_inputs_widget": "ports_count",
                    "name__dynamic_outputs_widget": "ports_count",
                    "prefix__dynamic_inputs": "input_",
                    "prefix__dynamic_outputs": "output_",
                },
                # 禁止连接
                "connection_blocking": {
                    # 键是固定端的索引 (对动态端也适用但无意义)
                    # 值中的 1 表示禁止输入, 2 表示禁止输出
                    # 为了代码实现的简便, 3 表示 x 位同时禁止输入输出
                    1: 1,
                },
            },
        }

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("NaN")

    def main(
        self,
        # pipe: list,
        ports_count: int,
        **kwargs,
    ):
        # 获取 pipe 输入, 如果没有指定, 则使用 None
        list__input = kwargs.get("pipe", None)
        if isinstance(list__input, list):
            length = len(list__input)
            print(length)
            if length < ports_count:
                # 填充 None 到 ports_count 个元素 (新建列表)
                list__input = list__input + [None] * (ports_count - length)
            elif length == ports_count:
                # 新建一个列表, 避免修改原列表
                list__input = list(list__input)
            else:
                # 取前 ports_count 个元素 (新建列表)
                list__input = list__input[:ports_count]
        else:
            # pipe 无效, 使用 None 初始化输入数组 (新建列表)
            list__input = [None] * ports_count
        # 用动态端口的输入覆盖输入数组
        for i in range(ports_count):
            input = kwargs.get(f"input_{i}", None)
            if input is not None:
                list__input[i] = input
        return (list__input, *list__input)
