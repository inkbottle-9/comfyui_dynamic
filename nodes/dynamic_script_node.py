import sys
import traceback

# import ast
import importlib
import builtins

from ..core.utils import get_category

# from ..utils import get_node_name
from ..core.utils import append_tags

from ..core.utils import any_type
from ..core.utils import FlexibleOptionalInputType
from ..core.utils import ByPassTypeTuple

# 允许导入的模块列表
list__allowed_modules = {
    # 数值与数学
    "math",  # 数学运算
    "random",  # 随机数
    "cmath",
    "decimal",  # 高精度浮点
    "fractions",  # 有理数运算
    "numbers",
    "statistics",  # 均值, 中位数等统计
    "bisect",  # 二分查找
    "heapq",  # 堆队列
    # 文本处理
    "re",  # 正则表达式
    "string",  # 字符串常量与工具
    "json",  # JSON解析 (处理API响应, 配置)
    "csv",
    "html",
    "tomllib",  # TOML 解析
    "base64",  # 编解码
    "difflib",
    "textwrap",
    # 路径操作
    "pathlib",  # 现代路径处理
    "os.path",  # 路径拼接, 判断
    # 语言拓展
    "ast",  # 抽象语法树
    "collections",  # defaultdict, Counter等
    "itertools",  # 迭代器工具
    "functools",  # 函数工具
    "enum",
    "dataclasses",
    "typing",  # 类型提示
    "inspect",  # 查看对象信息
    # 时间日期
    "time",
    "datetime",  # 时间戳, 格式化
    "zoneinfo",
    # 科学计算与机器学习等
    "sklearn",
    "pandas",
    "numpy",
    "torch",
    "torchvision",
    "torchaudio",
    "torchtext",
    "scipy",
    # 哈希与加密
    "hashlib",
    "secrets",
    "hmac",
    # 图像与视觉
    "PIL",
    # "Pillow", # 注意 Pillow 包仍然用的是 PIL
    "imageio",
    "skimage",
    "colorsys",
    # 其它工具
    "uuid",
    "ipaddress",
}

# 定义需要禁用的危险内置函数
builtins__unsafe = {
    # 代码执行类
    "eval",
    "exec",
    "compile",
    # 文件 / 系统操作类
    "open",
    "input",
    # 交互式命令
    "exit",
    "quit",
    "help",
    # __import__ 会被自己覆盖, 所以先去掉
    "__import__",
}


# 检查包是否允许. 包的所有子包都视为允许
def check_is_allowed(_name: str) -> bool:
    parts__target = _name.split(".")
    # 遍历所有项比较
    for allowed in list__allowed_modules:
        parts__allowed = allowed.split(".")
        # 必须长度>=父级, 且对应层级完全一致
        if (
            # 先判断层级数
            len(parts__target) >= len(parts__allowed)
            # 裁剪后比较是否相等
            and parts__target[: len(parts__allowed)] == parts__allowed
        ):
            return True
    return False


# 安全包装导入函数
def strict_allowed_import(name, globals=None, locals=None, fromlist=(), level=0):
    """import module only if it's in the allowed list"""
    # 只允许精确匹配 (不支持模糊匹配)
    # if name not in list__allowed_modules:
    #     raise ImportError(f"<dynamic> prohibited module: {name}")
    # 允许放行子模块
    if not check_is_allowed(name):
        raise ImportError(f"<dynamic> prohibited module: {name}")

    import_func__original = builtins.__import__
    # 执行导入
    # module = importlib.import_module(name)
    module = import_func__original(name, globals, locals, fromlist, level)

    # 删除父模块缓存 (防止通过 sys.modules 泄露)
    # parts = name.split(".")
    # for i in range(len(parts) - 1, 0, -1):  # 从父模块开始删
    #     parent = ".".join(parts[:i])
    #     if parent not in list__allowed_modules:
    #         sys.modules.pop(parent, None)

    return module


# 动态脚本节点
class DynamicScriptNode:
    # 节点名称
    NAME = append_tags("DynamicScriptNode ", ["python", "script"])
    # 节点分类
    CATEGORY = get_category("script")
    # 函数名
    FUNCTION = "main"

    # 返回类型
    RETURN_TYPES = ByPassTypeTuple(("*",))
    # 返回端口名称
    RETURN_NAMES = ByPassTypeTuple(("exception",))

    # 输入类型 (默认状态下)
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "input_ports_count": (
                    "INT",
                    {
                        "default": 2,
                        "min": 0,
                        "max": 100,
                        "step": 1,
                        "tooltip": "The number of input ports for this node",
                    },
                ),
                "output_ports_count": (
                    "INT",
                    {
                        "default": 1,
                        "min": 0,
                        "max": 100,
                        "step": 1,
                        "tooltip": "The number of output ports for this node",
                    },
                ),
                "remove_import_restrictions": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": "allow importing any module (use with caution, check the code first !!!!!)",
                    },
                ),
                "code": (
                    "STRING",
                    {"placeholder": "code here... (with python)", "multiline": True},
                ),
            },
            # 动态生成的输入会放在这里
            "optional": FlexibleOptionalInputType(any_type),
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "prompt": "PROMPT",
                "dynprompt": "DYNPROMPT",
            },
            # 自定义数据, 提供给 JS 脚本, 可以让脚本端判断哪些节点需要处理,
            # 这避免了通过节点名称判断, 同时也传递一些配置信息:
            "meta__dynamic": {
                "dynamic_io": {
                    # 启用动态输入
                    "flag__dynamic_inputs": True,
                    # 启用动态输出
                    "flag__dynamic_outputs": True,
                    "count__fixed_inputs": 4,
                    "count__fixed_outputs": 1,
                    "name__dynamic_inputs_widget": "input_ports_count",
                    "name__dynamic_outputs_widget": "output_ports_count",
                },
                "warning": {
                    # 需要判断状态的控件名称
                    "widget_name__warning": "remove_import_restrictions",
                    # 当控件值为该值时, 视为需要警告用户
                    "status__warning": True,
                    "status__rollback": False,
                    # 警告信息
                    "info__warning": "warning",
                },
                # 禁止连接
                "connection_blocking": {
                    # 键是固定端的索引 (对动态端也适用但无意义)
                    # 值中的 1 表示禁止输入, 2 表示禁止输出
                    # 为了代码实现的简便, 3 表示 x 位同时禁止输入输出
                    0: 1,
                    1: 1,
                    2: 1,
                },
            },
        }

    # 总是刷新 (float("NaN") 不等于任何值, 也不等于自身)
    @classmethod
    def IS_CHANGED(cls):
        return float("NaN")

    def main(
        self,
        input_ports_count,
        output_ports_count,
        remove_import_restrictions,
        code,
        **kwargs,
    ):
        """execute python script"""

        # 构建输入数组
        inputs = []
        # 可选的动态的输入端口数据在 kwargs 中
        for i in range(input_ports_count):
            inputs.append(kwargs.get(f"input_{i}", None))

        # 预分配输出数组 (None 本身是 python 中一个特殊的地址)
        outputs = [None] * output_ports_count

        # 构建安全环境: 所有内置函数 - 危险函数 + 自定义import
        if remove_import_restrictions:
            # 完全开放模式
            builtins__final = __builtins__
        else:
            # 自动获取所有非下划线开头的内置函数
            builtins__final = {
                name: obj
                for name, obj in builtins.__dict__.items()
                if not name.startswith("_") and name not in builtins__unsafe
            }
            # 注入自定义的 import 钩子 (用于限制可导入的包)
            builtins__final["__import__"] = strict_allowed_import

        # 用户代码的执行环境
        environment__global = {
            "__builtins__": builtins__final,
            "inputs": inputs,
            "outputs": outputs,
        }

        # 执行代码并捕获异常
        try:
            # 编译代码
            code_object__compiled = compile(code, "<dynamic_script>", "exec")
            # 执行用户代码 (第二个参数是全局空间, 第三个参数是本地空间)
            exec(code_object__compiled, environment__global)

            # 成功时返回结果 (第一个输出固定是 None, 可用于判断是否无异常)
            return (None, *outputs)

        except Exception as e:
            type__exception, value__exception, traceback__exception = sys.exc_info()

            # 堆栈行列表
            lines__traceback = traceback.format_exception(
                type__exception, value__exception, traceback__exception
            )

            message__to_log = f"<dynamic> script execution error\n"
            print(message__to_log)  # 打印到控制台 (日志)
            for line in lines__traceback:
                print(line, end="")

            context__exception = (
                type__exception,
                value__exception,
                traceback__exception,
                lines__traceback,
                "".join(lines__traceback),
            )

            return (
                context__exception,
                *outputs,
            )
