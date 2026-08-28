from comfy_api.latest import io

from ..core.utils import get_category


# 空值节点 (V3)
class DynamicNoneNode(io.ComfyNode):

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="DynamicNoneNode",
            display_name="dynamic_none",
            category=get_category("utils"),
            description="Always returns None.",
            inputs=[
                io.AnyType.Input(
                    "any",
                    optional=True,
                    tooltip="This input is ignored, but allows any type to be connected. (Not lazy so it will activate upstream nodes.)",
                ),
            ],
            outputs=[
                io.AnyType.Output(
                    display_name="None",
                    tooltip="Always returns None.",
                ),
            ],
        )

    @classmethod
    def execute(cls, **kwargs) -> io.NodeOutput:
        # 始终返回 None, 但允许任何输入 (不检查输入, 直接返回 None)
        return io.NodeOutput(None)
