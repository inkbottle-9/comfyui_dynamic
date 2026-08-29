# comfyui_dynamic 插件入口 (ComfyUI V3 API)
#
# V3 规范不再使用 NODE_CLASS_MAPPINGS / NODE_DISPLAY_NAME_MAPPINGS,
# 而是通过 comfy_entrypoint() 返回一个 ComfyExtension 实例来注册节点.
from comfy_api.latest import ComfyExtension, io

from .nodes.dynamic_script_node import DynamicScriptNode
from .nodes.dynamic_load_text_node import DynamicLoadTextFileNode
from .nodes.dynamic_pipe_any_node import DynamicPipeAnyNode
from .nodes.dynamic_switch_any_node import DynamicSwitchAnyNode
from .nodes.dynamic_random_number_node import DynamicRandomNumberNode
from .nodes.dynamic_none_node import DynamicNoneNode


class DynamicExtension(ComfyExtension):
    # 注意: get_node_list 必须声明为 async
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [
            DynamicScriptNode,
            DynamicLoadTextFileNode,
            DynamicPipeAnyNode,
            DynamicSwitchAnyNode,
            DynamicRandomNumberNode,
            DynamicNoneNode,
        ]


# comfy_entrypoint 可以是 async 也可以是普通函数, 两者均可
async def comfy_entrypoint() -> DynamicExtension:
    return DynamicExtension()


# JS 脚本目录 (V3 中仍然通过 WEB_DIRECTORY 提供前端扩展)
WEB_DIRECTORY = "./js"

__all__ = ["comfy_entrypoint", "WEB_DIRECTORY"]
