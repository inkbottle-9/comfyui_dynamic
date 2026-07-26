import sys
import traceback
import types  # 新增: 用于创建用户自定义模块

# import ast
# import importlib
import builtins

from ..core.utils import get_category

# from ..utils import get_node_name
from ..core.utils import append_tags

from ..core.utils import any_type
from ..core.utils import FlexibleOptionalInputTypeLazy
from ..core.utils import ByPassTypeTuple
from ..core.utils import get_node_name
from ..core.utils import check_is_equivalent_empty


# 允许导入的模块列表
list__allowed_modules = {
    # ComfyUI 内置模块
    "comfy",
    "nodes",
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
    "regex",  # 正则表达式
    "string",  # 字符串常量与工具
    "json",  # JSON解析 (处理API响应, 配置)
    "csv",
    "html",
    "xml",
    "yaml",
    "tomllib",  # TOML 解析
    "toml",  # TOML 解析
    "tomli",  # TOML 解析
    "jproperties",
    "configparser",  # INI 解析
    "base64",  # 编解码
    "difflib",
    "textwrap",
    "rich",  # 格式化输出
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
    "types",
    "typing",  # 类型提示
    "typing_extensions",  # 旧版本兼容
    "inspect",  # 查看对象信息
    "aenum",  # 枚举扩展
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
    "timm",
    "scipy",
    # 哈希与加密
    "hashlib",
    "secrets",
    "hmac",
    # 图像与视觉
    "cv2",
    "PIL",
    # "Pillow", # 注意 Pillow 包仍然用的是 PIL
    "imageio",
    "skimage",
    "colorsys",
    # 其它工具
    "uuid",
    "ipaddress",
    "copy",
    "__future__",  # 实验性功能
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
    "dir",
    # 交互式命令
    "exit",
    "quit",
    "help",
    # 反射与属性访问
    "vars",
    "globals",
    "locals",
    # "getattr",
    # "setattr",
    "delattr",
    # 内存操作
    "id",
    # __import__ 会被覆盖, 所以先去掉
    "__import__",
}

# 安全的内部函数
builtins__safe_internal = {
    "__build_class__",  # 类定义必需
    "__debug__",  # 调试标志
    "__doc__",  # 文档
    "__name__",  # 模块名
    "__package__",  # 包名
    "__spec__",  # 模块规格
    "__annotations__",  # 类型注解
}


# 检查包是否允许. 包的所有子包都视为允许
def check_is_allowed(_name: str) -> bool:
    parts__target = _name.split(".")
    # print(parts__target)
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
    NAME = append_tags(
        get_node_name("script "),
        [
            "python",
            "executor",
            "code",
        ],
    )
    # 节点分类
    CATEGORY = get_category("script")
    # 函数名
    FUNCTION = "main"

    # 返回类型
    RETURN_TYPES = ByPassTypeTuple(("*",))
    # 返回端口名称
    RETURN_NAMES = ByPassTypeTuple(("exception",))
    # 返回端口工具提示
    OUTPUT_TOOLTIPS = ("Exception information or None.",)

    DESCRIPTION = (
        "This node is used to execute Python scripts within a workflow, "
        "enabling functionality that is difficult or impossible to achieve using nodes alone. "
        "It accepts multiple inputs and produces multiple outputs. "
        "When an exception occurs, relevant information is output to the fixed 'exception' port. "
        "The first N dynamic inputs (determined by module_count) are treated as user-defined module code."
    )

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
                        "tooltip": "The number of input ports for this node.",
                    },
                ),
                "output_ports_count": (
                    "INT",
                    {
                        "default": 1,
                        "min": 0,
                        "max": 100,
                        "step": 1,
                        "tooltip": "The number of output ports for this node.",
                    },
                ),
                "module_count": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 100,
                        "step": 1,
                        "tooltip": (
                            "Number of leading dynamic inputs to treat as user module code. "
                            "These inputs will be compiled into importable modules before the main script runs. "
                            "The actual script inputs start from input_{module_count}, "
                            "but you can still access the input module code by inputs list in code"
                        ),
                    },
                ),
                "module_name_prefix": (
                    "STRING",
                    {
                        "default": "dynamic_module",
                        "tooltip": (
                            "Prefix for auto-generated module names. The i-th module will be named {prefix}__{i}, "
                            "then you can import them in your code."
                        ),
                    },
                ),
                "remove_import_restrictions": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": "Allow importing any module. (use with caution, check the code first !!!)",
                    },
                ),
                "lazy_execution": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": (
                            "Execute the code lazily. Note: Enable this option only when the script executed by this node is a pure function "
                            "(output depends solely on the input; in other words, the same input always produces the same output). "
                            "When this option is enabled, the node will re-execute only when the value at its input changes."
                        ),
                    },
                ),
                "code": (
                    "STRING",
                    {
                        "placeholder": (
                            "code here... (with python. inputs/outputs are built-in list variables to access dynamic ports. "
                            "it is highly recommended to input script code via multi-line string nodes or text file read nodes to prevent script loss). "
                            "you can import your custom modules here with name {module_name_prefix}__{i} (i starts form zero and i < module_count)"
                        ),
                        "multiline": True,
                    },
                ),
            },
            # 动态生成的输入会放在这里
            "optional": FlexibleOptionalInputTypeLazy(
                any_type,
                None,
                False,
                "Dynamic inputs (input_0, input_1, ...). First N inputs are module code if module_count > 0.",
            ),
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
                    "count__fixed_inputs": 7,
                    "count__fixed_outputs": 1,
                    "name__dynamic_inputs_widget": "input_ports_count",
                    "name__dynamic_outputs_widget": "output_ports_count",
                    "prefix__dynamic_inputs": "input_",
                    "prefix__dynamic_outputs": "output_",
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
    # 该函数应该接收和主函数相同的参数, 这里用 **kwargs 接收所有参数
    @classmethod
    def IS_CHANGED(cls, lazy_execution, **kwargs):
        if lazy_execution:
            return "lazy_execution"
        return float("NaN")

    def main(
        self,
        input_ports_count,
        output_ports_count,
        module_name_prefix,
        module_count,
        remove_import_restrictions,
        code,
        **kwargs,
    ):
        """execute python script with user-defined modules"""

        # 获取节点实例标题
        unique_id = kwargs.get("unique_id", "")
        prompt = kwargs.get("prompt", {})
        node_data = prompt.get(unique_id, {})
        title__node = node_data.get("_meta", {}).get("title", "dynamic_script")
        title__node = f"[{title__node}]"

        # 计算实际有效的模块数
        effective_module_count = min(module_count, input_ports_count)
        if module_count > input_ports_count:
            print(
                f"\n<dynamic> {title__node} warning: module_count ({module_count}) "
                f"exceeds input_ports_count ({input_ports_count}), "
                f"only the first {effective_module_count} inputs will be treated as modules.\n"
            )

        # 构建脚本输入数组 (所有输入端包括模块代码也注入)
        inputs = [None] * input_ports_count
        # 可选的动态的输入端口数据在 kwargs 中
        for i in range(input_ports_count):
            inputs[i] = kwargs.get(f"input_{i}", None)

        # 预分配输出数组 (None 本身是 python 中一个特殊的地址)
        outputs = [None] * output_ports_count

        # 构建安全环境: 所有内置函数 - 危险函数 + 自定义import
        if remove_import_restrictions:
            # 完全开放模式
            builtins__final = __builtins__
        else:
            # 自动获取所有非下划线开头的内置函数
            # builtins__final = {
            #     name: obj
            #     for name, obj in builtins.__dict__.items()
            #     if not name.startswith("_") and name not in builtins__unsafe
            # }
            builtins__final = {}
            for name, obj in builtins.__dict__.items():
                # 跳过黑名单中的函数
                if name in builtins__unsafe:
                    continue
                else:
                    builtins__final[name] = obj
                # # 允许非下划线开头的
                # if not name.startswith("_"):
                #     builtins__final[name] = obj
                # 明确允许的内部函数
                # elif name in builtins__safe_internal:
                #     builtins__final[name] = obj

            # 注入自定义的 import 钩子 (用于限制可导入的包)
            builtins__final["__import__"] = strict_allowed_import

        # 预收集所有将要注册的模块名, 用于构建支持用户模块的导入函数
        list__registered_modules = []
        for i in range(effective_module_count):
            list__registered_modules.append(f"{module_name_prefix}__{i}")

        # 如果有用户自定义模块且处于安全模式, 更新导入函数以放行这些模块
        if list__registered_modules and not remove_import_restrictions:
            allowed__user_modules = set(list__registered_modules)

            def strict_allowed_import_with_user_modules(
                name, globals=None, locals=None, fromlist=(), level=0
            ):
                if not (check_is_allowed(name) or name in allowed__user_modules):
                    raise ImportError(f"<dynamic> prohibited module: {name}")
                return builtins.__import__(name, globals, locals, fromlist, level)

            builtins__final["__import__"] = strict_allowed_import_with_user_modules

        # 用户代码的执行环境
        environment__global = {
            "__builtins__": builtins__final,
            "inputs": inputs,
            "outputs": outputs,
        }

        # 执行代码并捕获异常
        try:
            # 注册用户自定义模块
            for i in range(effective_module_count):
                module_code = inputs[i]
                module_name = f"{module_name_prefix}__{i}"

                # 清理旧缓存
                sys.modules.pop(module_name, None)

                # 创建模块
                module = types.ModuleType(module_name)
                module.__file__ = f"{title__node}.{module_name}"
                module.__dict__["__builtins__"] = builtins__final

                # 检查模块代码是否为空
                if check_is_equivalent_empty(module_code):
                    print(
                        f"\n<dynamic> {title__node} warning: module "
                        f"{module_name} code is empty, registering as empty module.\n"
                    )
                else:
                    # 编译并执行模块代码
                    code_object__module = compile(module_code, module.__file__, "exec")
                    exec(code_object__module, module.__dict__)

                # 注册到 sys.modules, 使主脚本可以 import
                sys.modules[module_name] = module

            # 检查代码是否为空
            if not check_is_equivalent_empty(code):
                # 编译代码
                code_object__compiled = compile(code, f"{title__node}", "exec")
                # 执行用户代码 (第二个参数是全局空间, 第三个参数是本地空间)
                exec(code_object__compiled, environment__global)
            else:
                print("\n" + "=" * 80)
                print(f"<dynamic> {title__node} empty script\n")  # 打印到控制台 (日志)
                print("=" * 80 + "\n")

            # 成功时返回结果 (第一个输出固定是 None, 可用于判断是否无异常)
            return (None, *outputs)

        except Exception as e:
            type__exception, value__exception, traceback__exception = sys.exc_info()

            # 堆栈行列表
            lines__traceback = traceback.format_exception(
                type__exception, value__exception, traceback__exception
            )

            message__to_log = f"<dynamic> {title__node} script execution error\n"
            print("\n" + "=" * 80)
            print(message__to_log)  # 打印到控制台 (日志)
            for line in lines__traceback:
                print(line, end="")
            print("=" * 80 + "\n")

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

        finally:
            # 清理本次注册的模块缓存
            for name in list__registered_modules:
                sys.modules.pop(name, None)
