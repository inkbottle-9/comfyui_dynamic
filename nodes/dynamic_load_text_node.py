import encodings
import hashlib
import time
from pathlib import Path

from comfy_api.latest import io

from ..core.utils import get_category
from ..core.utils import read_file_safe
from ..core.utils import check_is_text_encoding


list__all_encodings = sorted(set(encodings.aliases.aliases.values()))
list__text_encodings = [
    enc for enc in list__all_encodings if check_is_text_encoding(enc)
]


# 动态读取文本文件节点 (V3)
class DynamicLoadTextFileNode(io.ComfyNode):
    # 类级缓存, 按 unique_id 隔离多实例
    # 结构: {unique_id: {"path": str, "encoding": str, "result": str}}
    _cache = {}

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="DynamicLoadTextFileNode",
            display_name="dynamic_load_text_file",
            category=get_category("utils"),
            description="Loads the content of a text file. The content is returned as a string.",
            hidden=[io.Hidden.unique_id],
            inputs=[
                io.String.Input(
                    "file_path",
                    placeholder="file full path (e.g. E:/dir/script.py)",
                    multiline=False,
                    tooltip="The full path to the text file to load. (e.g. E:/dir/script.py)",
                ),
                io.Combo.Input(
                    "encoding",
                    # 获取所有编码类型
                    options=list__text_encodings,
                    default="utf_8",
                    tooltip="The encoding to use for reading the file.",
                ),
            ],
            outputs=[
                io.String.Output(
                    display_name="content",
                    tooltip="The content of the file.",
                ),
                io.AnyType.Output(
                    display_name="exception",
                    tooltip="Exception information or None.",
                ),
            ],
        )

    @classmethod
    def _get_unique_id(cls):
        """从 V3 hidden 输入中安全地获取 unique_id"""
        return getattr(getattr(cls, "hidden", None), "unique_id", None)

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

    # 文件内容变化时强制节点重新执行 (V3 中 IS_CHANGED 更名为 fingerprint_inputs)
    @classmethod
    def fingerprint_inputs(cls, file_path=None, encoding=None, **kwargs):
        unique_id = cls._get_unique_id()

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
        return state__return

    @classmethod
    def execute(cls, file_path, encoding, **kwargs) -> io.NodeOutput:
        # 获取当前节点的唯一标识符
        unique_id = cls._get_unique_id()

        if unique_id and file_path:
            result = cls._get_file_state(file_path, encoding)
            # 缓存结果
            cls._cache[unique_id] = {
                "path": file_path,
                "encoding": encoding,
                "result": result,
            }
        # 调用函数读取内容
        content, error = read_file_safe(file_path, "all", encoding, list__text_encodings)
        return io.NodeOutput(content, error)
