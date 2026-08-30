from __future__ import annotations

import random
import warnings
import codecs
import os
import json
import folder_paths

from functools import wraps
from pathlib import Path
from typing import Optional, List, Union, NamedTuple

from comfy_api.latest import io

# 插件空间
namespace = "dynamic"

node_prefix = "dynamic_"

# 把当前进程里所有后续出现的警告 (Warning) 的过滤级别强制设为始终显示
warnings.simplefilter("always")


def deprecated(func):
    """标记函数为已废弃"""

    @wraps(func)
    def wrapper(*args, **kwargs):
        warnings.warn(
            f"{func.__name__} deprecated and will be removed in future versions.",
            DeprecationWarning,
            stacklevel=2,  # 关键: 指向调用者而非这里
        )
        return func(*args, **kwargs)

    return wrapper


# 获取分类路径
def get_category(string__category: str) -> str:
    """获取分类路径"""
    if not string__category:
        return namespace
    return f"{namespace}/{string__category}"


# 获取节点全名
def get_node_name(string__name: str) -> str:
    return f"{node_prefix}{string__name}"


def check_is_equivalent_empty(_str: str):
    """检查字符串是否等效为空 (None, 空字符串, 或仅包含空字符的字符串)"""
    return _str is None or (isinstance(_str, str) and not _str.strip())


# 为字符串追加标签
def append_tags(
    string: str,
    list__tags: list,
    separator: str = ", ",
    delimiter__start: str = "(",
    delimiter__end: str = ")",
) -> str:
    if not list__tags:
        return string
    return f"{string}{delimiter__start}{separator.join(list__tags)}{delimiter__end}"


class AnyType(str):
    """A special class that is always equal in not equal comparisons. Credit to pythongosssss"""

    def __ne__(self, __value: object) -> bool:
        return False


# credit to rgthree
# https://github.com/rgthree/rgthree-comfy
class FlexibleOptionalInputType(dict):
    """A special class to make flexible nodes that pass data to our python handlers.

    Enables both flexible/dynamic input types (like for Any Switch) or a dynamic number of inputs
    (like for Any Switch, Context Switch, Context Merge, Power Lora Loader, etc).

    Initially, ComfyUI only needed to return True for `__contains__` below, which told ComfyUI that
    our node will handle the input, regardless of what it is.

    However, after https://github.com/comfyanonymous/ComfyUI/pull/2666 ComdyUI's execution changed
    also checking the data for the key; specifcially, the type which is the first tuple entry. This
    type is supplied to our FlexibleOptionalInputType and returned for any non-data key. This can be a
    real type, or use the AnyType for additional flexibility.
    """

    def __init__(self, type, data: Union[dict, None] = None):
        """Initializes the FlexibleOptionalInputType.

        Args:
            type: The flexible type to use when ComfyUI retrieves an unknown key (via `__getitem__`).
            data: An optional dict to use as the basis. This is stored both in a `data` attribute, so we
                can look it up without hitting our overrides, as well as iterated over and adding its key
                and values to our `self` keys. This way, when looked at, we will appear to represent this
                data. When used in an "optional" INPUT_TYPES, these are the starting optional node types.
        """
        self.type = type
        self.data = data
        if self.data is not None:
            for k, v in self.data.items():
                self[k] = v

    def __getitem__(self, key):
        # If we have this key in the initial data, then return it. Otherwise return the tuple with our
        # flexible type.
        if self.data is not None and key in self.data:
            val = self.data[key]
            return val
        return (self.type,)

    def __contains__(self, key):
        """Always contain a key, and we'll always return the tuple above when asked for it."""
        return True


class FlexibleOptionalInputTypeLazy(dict):
    """支持 lazy 执行的 FlexibleOptionalInputType.

    在 V3 节点中仍然需要它: 动态输入 (case_0, case_1, ...) 无法在 schema 中静态声明,
    而 ComfyUI 的图编排阶段 (comfy_execution/graph.py) 会通过原始的 INPUT_TYPES() 查询
    输入是否带有 lazy 标记. 在 V3 节点子类上覆盖 INPUT_TYPES 并返回本类的实例,
    可以让动态输入继续参与懒执行 (懒执行的官方说明见 docs.comfy.org/custom-nodes/backend/lazy_evaluation).

    Enables both flexible/dynamic input types (like for Any Switch) or a dynamic number of inputs
    (like for Any Switch, Context Switch, Context Merge, Power Lora Loader, etc).

    Initially, ComfyUI only needed to return True for `__contains__` below, which told ComfyUI that
    our node will handle the input, regardless of what it is.

    However, after https://github.com/comfyanonymous/ComfyUI/pull/2666 ComdyUI's execution changed
    also checking the data for the key; specifcially, the type which is the first tuple entry. This
    type is supplied to our FlexibleOptionalInputType and returned for any non-data key. This can be a
    real type, or use the AnyType for additional flexibility.
    """

    # tooltip 参数实际上不生效
    def __init__(
        self,
        type,
        data: Optional[dict] = None,
        lazy: bool = True,
        tooltip: Optional[str] = None,
    ):
        self.type = type
        self.data = data
        self.lazy = lazy
        self.tooltip = tooltip
        self._keys__accessed = set()  # 追踪访问
        if self.data is not None:
            for k, v in self.data.items():
                self[k] = v

    def __getitem__(self, key):
        self._keys__accessed.add(key)  # 记录访问

        if self.data is not None and key in self.data:
            return self.data[key]
        dict_item = {}
        # 添加 lazy 标记
        if self.lazy:
            dict_item["lazy"] = True
        # 添加工具提示
        if self.tooltip is not None:
            dict_item["tooltip"] = self.tooltip
        # 如果没有特殊设置, 直接返回类型; 否则返回一个包含类型和设置的字典
        if dict_item:
            return (self.type, dict_item)
        else:
            return (self.type,)

    def __contains__(self, key):
        return True

    def __iter__(self):
        return super().__iter__()

    def items(self):
        return super().items()


class ByPassTypeTuple(tuple):
    """A special class that will return additional "AnyType" strings beyond defined values.
    Credit to Trung0246

    在 V3 节点中仍然需要它: prompt 校验阶段 (execution.py) 会通过
    `RETURN_TYPES[输出端口序号]` 取上游节点的输出类型, 而 JS 侧动态添加的输出端口
    (output_0, output_1, ...) 并不存在于 V3 schema 静态声明的 outputs 中,
    使用普通定长元组会在该校验处直接触发 IndexError 导致整个 prompt 校验失败.
    在 V3 节点子类上用本类实例覆盖 RETURN_TYPES, 越界时返回 AnyType("*") 即可绕过该校验.
    """

    def __getitem__(self, index):
        if index > len(self) - 1:
            return AnyType("*")
        return super().__getitem__(index)


# FIX: V3 基类会根据 schema 中静态声明的 outputs 数量自动推断 OUTPUT_IS_LIST,
# 导致 merge_result_data 在合并结果时只保留与 schema 等长的输出, 截断所有动态输出.
# 使用一个无限产出 False 的可迭代对象覆盖, 确保动态输出槽位不会被截断.
class InfiniteFalseList:
    def __iter__(self):
        while True:
            yield False

    def __getitem__(self, index):
        return False

    def __len__(self):
        return 0x7FFFFFFF


any_type = AnyType("*")


class TextFileResult(NamedTuple):
    tokens: str | list[str] | None
    error: Exception | None


# 检查是否是文本编码
def check_is_text_encoding(_name: str) -> bool:
    try:
        info = codecs.lookup(_name)
        # 文本编码的 _is_text_encoding 属性为 True
        # 二进制编解码器没有这个属性或为 False
        return getattr(info, "_is_text_encoding", False)
    except LookupError:
        return False


# 安全读取文件
def read_file_safe(
    _path__file: str,
    _mode: str = "all",  # 'all', 'lines', 'stream'
    _encoding: str = "utf-8",
    _encoding_list__fallback: Optional[List[str]] = None,
) -> TextFileResult:
    """
    文件安全读取函数

    Args:
        file_path: 文件路径
        mode: 读取模式
        encoding: 首选编码
        fallback_encodings: 备用编码列表

    Returns:
        TextFileResult

    注意: 'stream' 模式返回的是仍然处于打开状态的文件对象,
    调用方必须在使用完毕后自行调用 close() 关闭它 (推荐使用 with 语句包裹).
    """
    path: Path = Path(_path__file)

    # 检查文件是否存在
    if not path.exists():
        return (None, Exception(f"File not found: {path}"))

    # 检查是否是文件
    if not path.is_file():
        return (None, Exception(f"Not a file: {path}"))

    # 编码列表
    list__encodings = dict.fromkeys([_encoding] + (_encoding_list__fallback or []))

    # 尝试多种编码
    for enc in list__encodings:
        try:
            if _mode == "stream":
                # BUG 修复: 旧实现把 open 放在 with 块内, return 时文件已被关闭,
                # 调用方拿到的永远是一个已关闭的文件对象.
                # 这里改为直接返回打开的文件对象, 由调用方负责关闭.
                return (open(path, "r", encoding=enc, errors="strict"), None)
            # 打开文件, 使用 with 自动关闭
            with open(path, "r", encoding=enc, errors="strict") as file:
                if _mode == "all":
                    return (file.read(), None)
                elif _mode == "lines":
                    return (file.readlines(), None)
                else:
                    raise ValueError(f"Unsupported reading mode: {_mode}")
        except UnicodeDecodeError:
            continue
        except LookupError:
            # 非有效编码, 跳过
            continue
        except PermissionError as exception:
            return (None, exception)
        except Exception as exception:
            return (None, exception)
    return (None, Exception(f"All encoding attempts failed: {list__encodings}"))


def generate_random(_min: int, _max: int):
    """生成随机整数"""
    if _min > _max:
        _min, _max = _max, _min  # 交换, 确保 a <= b
    return random.randint(_min, _max)


class LogUtils:
    """日志工具"""

    _flag__enable_logging: bool | None = None

    @staticmethod
    def get_comfy_setting(key: str, default=None):
        """
        读取 ComfyUI 前端设置 (comfy.settings.json)
        通过官方 folder_paths API 获取用户目录路径
        """
        # 获取用户目录 (自动处理 --user-directory 参数和不同安装方式)
        user_dir = folder_paths.get_user_directory()

        # 设置文件路径: <user_dir>/default/comfy.settings.json
        settings_path = os.path.join(user_dir, "default", "comfy.settings.json")

        try:
            with open(settings_path, "r", encoding="utf-8") as f:
                settings = json.load(f)
                return settings.get(key, default)
        except (FileNotFoundError, json.JSONDecodeError):
            return default

    @staticmethod
    def check_enable_logging():
        if LogUtils._flag__enable_logging is None:
            LogUtils._flag__enable_logging = LogUtils.get_comfy_setting(
                "ComfyDynamic.General.flag__enable_logging", True
            )
        return LogUtils._flag__enable_logging

    @staticmethod
    def print_log(*args, **kwargs):
        """打印日志, 检查是否启用日志, 启用时将参数原样转发给 print"""
        if LogUtils.check_enable_logging():
            print(*args, **kwargs)
