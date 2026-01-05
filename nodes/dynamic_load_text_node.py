import encodings

from ..core.utils import get_category
from ..core.utils import read_file_safe
from ..core.utils import check_is_text_encoding


list__all_encodings = sorted(set(encodings.aliases.aliases.values()))
list__text_encodings = [
    enc for enc in list__all_encodings if check_is_text_encoding(enc)
]


# 动态读取文本文件节点
class DynamicLoadTextFileNode:
    NAME = "DynamicLoadTextFileNode"
    CATEGORY = get_category("script")
    FUNCTION = "main"
    RETURN_TYPES = ("STRING", "*")
    RETURN_NAMES = ("content", "exception")

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "file_path": (
                    "STRING",
                    {
                        "placeholder": "file full path (e.g. E:/dir/script.py)",
                        "multiline": False,
                    },
                ),
                "encoding": (
                    # 获取所有编码类型
                    list__text_encodings,
                    {"default": "utf_8"},
                ),
            },
        }

    def main(self, file_path, encoding, **kwargs):
        # 调用函数读取内容
        return read_file_safe(file_path, "all", encoding, list__text_encodings)
