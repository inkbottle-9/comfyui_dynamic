from .core.utils import get_category

from .nodes.dynamic_script_node import DynamicScriptNode
from .nodes.dynamic_load_text_node import DynamicLoadTextFileNode


# class DynamicTestNode:
#     # 节点名称
#     NAME = "DynamicTestNode"
#     # 节点分类
#     CATEGORY = get_category("test")
#     # 函数名
#     FUNCTION = "run"
#     # 返回类型
#     RETURN_TYPES = ("STRING",)
#     # 返回值默认名称
#     RETURN_NAMES = ("text",)

#     @classmethod
#     def INPUT_TYPES(cls):
#         return {
#             "required": {
#                 "name": ("STRING", {"default": "dynamic"}),
#             }
#         }

#     def run(self, name):
#         return (f"Hello, {name}! this node is for test only",)


# 需要加载的节点类映射表
NODE_CLASS_MAPPINGS = {
    # DynamicTestNode.__name__: DynamicTestNode,
    DynamicLoadTextFileNode.__name__: DynamicLoadTextFileNode,
    DynamicScriptNode.__name__: DynamicScriptNode,
}

# 显示名称
NODE_DISPLAY_NAME_MAPPINGS = {
    # DynamicTestNode.__name__: DynamicTestNode.NAME,
    DynamicLoadTextFileNode.__name__: DynamicLoadTextFileNode.NAME,
    DynamicScriptNode.__name__: DynamicScriptNode.NAME,
}

# JS 脚本目录
WEB_DIRECTORY = "./js"

# __all__ = ['NODE_CLASS_MAPPINGS', 'WEB_DIRECTORY']

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
