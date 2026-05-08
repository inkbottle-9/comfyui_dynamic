from ..core.utils import get_category

from ..core.utils import append_tags

from ..core.utils import any_type
from ..core.utils import FlexibleOptionalInputTypeLazy
from ..core.utils import ByPassTypeTuple
from ..core.utils import get_node_name


# 动态任意切换节点
class DynamicSwitchAnyNode:
    # 节点名称
    NAME = append_tags(get_node_name("switch_any "), ["branch", "case", "select"])
    # 节点分类
    CATEGORY = get_category("utils")
    # 函数名
    FUNCTION = "main"

    # 返回类型
    RETURN_TYPES = ByPassTypeTuple(("*",))
    # 返回端口名称
    RETURN_NAMES = ByPassTypeTuple(("result",))
    # 返回端口工具提示
    OUTPUT_TOOLTIPS = ("The value of the case at the specified index.",)

    DESCRIPTION = (
        "This node is used to switch between multiple cases by index. "
        "It accepts an index as input and returns the value of the case at that index, "
        "or returns the default value (specified or None) if out of range."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "index": (
                    "INT",
                    {
                        "default": 0,
                        "min": -1,
                        "max": 100,
                        "step": 1,
                        "tooltip": "The index of the case to return. Must be between 0 and cases_count - 1, else the default value will be returned.",
                    },
                ),
                "cases_count": (
                    "INT",
                    {
                        "default": 2,
                        "min": 0,
                        "max": 100,
                        "step": 1,
                        "tooltip": "The number of cases for this node. Must be between 0 and 100.",
                    },
                ),
            },
            # 动态生成的输入会放在这里
            "optional": FlexibleOptionalInputTypeLazy(
                any_type,
                {
                    "default": (
                        "*",
                        {
                            "default": None,
                            "lazy": True,
                            "tooltip": "The default value to return if no cases match. None if not specified.",
                        },
                    )
                },
                True,  # 开启懒求值
                "Dynamic inputs (case_0, case_1, ...).",
            ),
            # "optional": FlexibleOptionalInputType(any_type),
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "prompt": "PROMPT",
                "dynprompt": "DYNPROMPT",
            },
            # 自定义数据, 提供给 JS 脚本, 可以让脚本端判断哪些节点需要处理,
            # 这避免了通过节点名称判断, 同时也传递一些配置信息:
            "meta__dynamic": {
                "dynamic_io": {
                    # 启用动态输入
                    "flag__dynamic_inputs": True,
                    # 启用动态输出
                    "flag__dynamic_outputs": False,
                    "count__fixed_inputs": 3,
                    "count__fixed_outputs": 1,
                    "name__dynamic_inputs_widget": "cases_count",
                    "name__dynamic_outputs_widget": None,
                    "prefix__dynamic_inputs": "case_",
                    "prefix__dynamic_outputs": None,
                },
            },
        }

    def check_lazy_status(self, index, cases_count, **kwargs):
        """
        kwargs 包含所有实际连接的动态输入, 检查是否需要执行指定的输入
        """
        needed = []

        # 计算应该选中的输入名
        target_input = f"case_{index}"

        # 如果这个输入在 kwargs 中, 就加入 needed 列表
        # 不检查时可能会报错, CUI 提示节点缺少目标输入
        if target_input in kwargs:
            needed.append(target_input)
        # if (index < 0 or index >= cases_count) and "default" in kwargs:
        # 若目标值不存在, 且 default 输入存在, 则加入 needed 列表
        elif "default" in kwargs:
            # index 超出范围时, 需要执行 default 输入
            needed.append("default")

        # 其他输入不需要执行,不加入 needed 列表
        return needed

    def main(
        self,
        # default,
        index,
        cases_count,
        **kwargs,
    ):
        # print(kwargs)
        """根据 index 返回对应的 case 输入, 如果 index 超出范围则返回 default"""
        # 从 kwargs 中获取 default 输入
        # 注意必须动态获取, 否则 CUI 认为该参数是必须的 (必须连接)
        default = kwargs.get("default", None)
        # 从 kwargs 中获取对应的 case 输入, 格式为 case_0, case_1, ...
        if index < 0 or index >= cases_count:
            return (default,)
        result = kwargs.get(f"case_{index}", default)
        return (result,)
