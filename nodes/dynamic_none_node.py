from ..core.utils import get_node_name, get_category, ByPassTypeTuple


class DynamicNoneNode:
    NAME = get_node_name("none ")

    CATEGORY = get_category("utils")

    FUNCTION = "main"

    RETURN_TYPES = ByPassTypeTuple(("*",))

    RETURN_NAMES = ByPassTypeTuple(("None",))

    OUTPUT_TOOLTIPS = ("Always returns None.",)
    
    DESCRIPTION = "Always returns None."

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "any": (
                    "*",
                    {
                        "default": None,
                        "tooltip": "This input is ignored, but allows any type to be connected. (Not lazy so it will activate upstream nodes.)",
                    },
                ),
                # "test":(
                #     "STRING",
                #     {
                #         "default": "This is a test input. It does nothing.",
                #         "tooltip": "This input is just for testing and does nothing.",
                #     },
                # )
            },
        }

    def main(self, **kwargs):
        # 始终返回 None, 但允许任何输入 (不检查输入, 直接返回 None)
        return (None,)
