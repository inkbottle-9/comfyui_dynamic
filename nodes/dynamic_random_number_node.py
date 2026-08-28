from comfy_api.latest import io

from ..core.utils import get_category
from ..core.utils import generate_random


# 随机整数节点 (V3)
class DynamicRandomNumberNode(io.ComfyNode):

    # 总是刷新 (float("NaN") 不等于任何值, 也不等于自身)
    @classmethod
    def fingerprint_inputs(cls, min: int = 0, max: int = 10, **kwargs):
        return float("NaN")

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="DynamicRandomNumberNode",
            display_name="dynamic_random_number",
            category=get_category("math"),
            description="Generates a random integer within a specified range. The value changes every execution.",
            search_aliases=["int"],
            inputs=[
                io.Int.Input(
                    "min",
                    default=0,
                    min=0,
                    step=1,
                    tooltip="The minimum value (inclusive) of the random number",
                ),
                io.Int.Input(
                    "max",
                    default=10,
                    min=0,
                    step=1,
                    tooltip="The maximum value (exclusive) of the random number",
                ),
            ],
            outputs=[
                io.Int.Output(
                    display_name="random_int",
                    tooltip="A random integer between min and max.",
                ),
            ],
        )

    @classmethod
    def execute(cls, min: int, max: int) -> io.NodeOutput:
        return io.NodeOutput(generate_random(min, max))
