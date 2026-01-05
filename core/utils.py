# utils.py
import warnings
import codecs

from functools import wraps
from typing import Union
from pathlib import Path
from typing import Optional, List, Union, NamedTuple

# 插件空间
namespace = "dynamic"

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
    return f"{namespace}/{string__category}"


# 获取节点全名
def get_node_name(string__name: str) -> str:
    return f"{namespace}.{string__name}"


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


# 生成动态输入字典
@deprecated
def get_dynamic_inputs(num):
    inputs = {}
    for i in range(num):
        # a,b,c…
        # ch = chr(ord("a") + i)
        ch = f"port__{i}"
        # forceInput 允许再接线
        inputs[ch] = ("*", {"forceInput": True})
    return inputs


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


class ByPassTypeTuple(tuple):
    """A special class that will return additional "AnyType" strings beyond defined values.
    Credit to Trung0246
    """

    def __getitem__(self, index):
        if index > len(self) - 1:
            return AnyType("*")
        return super().__getitem__(index)


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
        文件内容或 None
    """
    path = Path(_path__file)

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
            # 打开文件, 使用 with 自动关闭
            with open(path, "r", encoding=enc, errors="strict") as file:
                if _mode == "all":
                    return (file.read(), None)
                elif _mode == "lines":
                    return (file.readlines(), None)
                elif _mode == "stream":
                    # 返回文件对象
                    return (file, None)
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
