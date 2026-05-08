from ..core.utils import get_category
from ..core.utils import append_tags
from ..core.utils import get_node_name
from ..core.utils import generate_random
from ..core.utils import ByPassTypeTuple


class DynamicRandomNumberNode:
    """随机整数节点"""
    NAME = append_tags(
        get_node_name("random_number "),
        [
            "int",
        ],
    )
    CATEGORY = get_category("math")
    FUNCTION = "main"

    RETURN_TYPES = ByPassTypeTuple(("INT",))
    RETURN_NAMES = ByPassTypeTuple(("random_int",))
    OUTPUT_TOOLTIPS = ("A random integer between min and max.",)
    DESCRIPTION = "Generates a random integer within a specified range. The value changes every execution."

    @classmethod
    def IS_CHANGED(cls, min: int, max: int, **kwargs):
        return float("NaN")

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "min": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "step": 1,
                        "tooltip": "The minimum value (inclusive) of the random number",
                    },
                ),
                "max": (
                    "INT",
                    {
                        "default": 10,
                        "min": 0,
                        "step": 1,
                        "tooltip": "The maximum value (exclusive) of the random number",
                    },
                ),
            },
            "optional": {},
        }

    def main(self, min: int, max: int):
        return (generate_random(min, max),)
