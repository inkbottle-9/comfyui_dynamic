import encodings
import hashlib
import time
from pathlib import Path


from ..core.utils import get_category
from ..core.utils import read_file_safe
from ..core.utils import check_is_text_encoding
from ..core.utils import get_node_name


list__all_encodings = sorted(set(encodings.aliases.aliases.values()))
list__text_encodings = [
    enc for enc in list__all_encodings if check_is_text_encoding(enc)
]


# 动态读取文本文件节点
class DynamicLoadTextFileNode:
    NAME = get_node_name("load_text_file ")
    CATEGORY = get_category("utils")
    FUNCTION = "main"
    RETURN_TYPES = ("STRING", "*")
    RETURN_NAMES = ("content", "exception")
    OUTPUT_TOOLTIPS = (
        "The content of the file.",
        "Exception information or None.",
    )
    DESCRIPTION = "Loads the content of a text file. The content is returned as a string."

    # 类级缓存, 按 unique_id 隔离多实例
    # 结构: {unique_id: {"path": str, "encoding": str, "result": str}}
    _cache = {}

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
                        "tooltip": "The full path to the text file to load. (e.g. E:/dir/script.py)",
                    },
                ),
                "encoding": (
                    # 获取所有编码类型
                    list__text_encodings,
                    {
                        "default": "utf_8",
                        "tooltip": "The encoding to use for reading the file.",
                    },
                ),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    @classmethod
    def _get_file_state(cls, file_path, encoding):
        """计算文件状态标识, 用于缓存比较"""
        if not file_path:
            return f"NONE_PATH:{file_path}:{encoding}:{time.time()}"

        path = Path(file_path)
        if not path.exists() or not path.is_file():
            return f"NOT_FOUND:{file_path}:{encoding}:{time.time()}"

        try:
            content, _ = read_file_safe(
                file_path, "all", encoding, list__text_encodings
            )
            if content is None:
                return f"EMPTY_CONTENT:{file_path}:{encoding}:{time.time()}"
            # 使用 MD5 算法, 速度快, 此处对安全性不敏感
            md5 = hashlib.md5(content.encode()).hexdigest()
            return f"SUCCESS:{file_path}:{encoding}:{md5}"
        except Exception as e:
            return f"EXCEPTION:{file_path}:{encoding}:{str(e)}:{time.time()}"

    @classmethod
    def IS_CHANGED(cls, file_path, encoding, **kwargs):
        unique_id = kwargs.get("unique_id")
        # print(
        #     f"<FUNC IS_CHANGED> file_path: {file_path}, encoding: {encoding}, unique_id: {unique_id}"
        # )
        state__return = None

        if file_path and encoding:
            # 存在传入的路径
            result = cls._get_file_state(file_path, encoding)
            if unique_id:
                cls._cache[unique_id] = {
                    "path": file_path,
                    "encoding": encoding,
                    "result": result,
                }
            state__return = result

        # 不存在传入的路径
        elif unique_id and unique_id in cls._cache:
            state__cached = cls._cache[unique_id]
            path__cached = state__cached["path"]
            encoding__cached = state__cached.get("encoding", encoding)
            # 用缓存的路径重新计算当前文件状态
            result = cls._get_file_state(path__cached, encoding__cached)
            # 更新缓存结果
            cls._cache[unique_id]["result"] = result
            state__return = result
        else:
            # 无路径传入, 且缓存也不存在
            state__return = f"NONE_PATH_AND_NONE_CACHE:{file_path}:{encoding}:{time.time()}"
        # print(f"STATE: {state__return}")
        return state__return

    def main(self, file_path, encoding, **kwargs):
        # 获取当前节点的唯一标识符
        unique_id = kwargs.get("unique_id")

        # print(
        #     f"<FUNC main> file_path: {file_path}, encoding: {encoding}, unique_id: {unique_id}"
        # )

        if unique_id and file_path:
            result = self._get_file_state(file_path, encoding)
            # 缓存结果
            self.__class__._cache[unique_id] = {
                "path": file_path,
                "encoding": encoding,
                "result": result,
            }
        # print(f"CACHE: {self.__class__._cache}")
        # 调用函数读取内容
        return read_file_safe(file_path, "all", encoding, list__text_encodings)
