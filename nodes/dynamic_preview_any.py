from ..core.utils import get_category
from ..core.utils import append_tags
from ..core.utils import get_node_name
from ..core.utils import ByPassTypeTuple

from comfy.comfy_types.node_typing import IO


class DynamicPreviewAnyNode:
    # 节点名称
    NAME = append_tags(get_node_name("preview_any "), [])
    # 节点分类
    CATEGORY = get_category("utils")
    # 函数名
    FUNCTION = "main"
    # 返回类型
    RETURN_TYPES = (IO.STRING,)
    # 该节点是输出节点
    OUTPUT_NODE = True
    # 搜索别名
    SEARCH_ALIASES = [
        "output",
        "inspect",
        "debug",
        "print",
        "show",
        "display",
        "preview",
        "view",
        "text",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"source": (IO.ANY, {})},
        }
