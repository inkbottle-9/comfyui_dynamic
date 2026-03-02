import encodings
import hashlib
import time

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

    # @classmethod 注解会使函数成为类方法, 第一个参数为类本身 (注意不是实例)
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

    @classmethod
    def IS_CHANGED(cls, file_path, encoding, **kwargs):
        try:
            content, _ = read_file_safe(
                file_path, "all", encoding, list__text_encodings
            )
            if content is None:  # read_file_safe 可能返回 None
                return f"ERROR_{time.time()}"
            # 使用 MD5 算法, 速度快, 此处对安全性不敏感
            return hashlib.md5(content.encode()).hexdigest()
        except Exception:
            return f"ERROR_{time.time()}"

    def main(self, file_path, encoding, **kwargs):
        # 调用函数读取内容
        return read_file_safe(file_path, "all", encoding, list__text_encodings)
