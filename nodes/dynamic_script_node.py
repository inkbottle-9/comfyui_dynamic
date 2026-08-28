import sys
import traceback
import types  # 用于创建用户自定义模块
import builtins

from comfy_api.latest import io

from ..core.utils import get_category
from ..core.utils import ByPassTypeTuple
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
    # 允许放行子模块
    if not check_is_allowed(name):
        raise ImportError(f"<dynamic> prohibited module: {name}")

    import_func__original = builtins.__import__
    # 执行导入
    module = import_func__original(name, globals, locals, fromlist, level)

    return module


# 动态脚本节点 (V3)
class DynamicScriptNode(io.ComfyNode):
    # 全局单例缓存字典, 供用户脚本跨工作流执行共享数据.
    # 所有 DynamicScriptNode 实例共享同一个字典, 键的增删改查完全由用户代码负责.
    # 生命周期与 ComfyUI 服务进程一致, 服务重启后内容清空.
    # 注意: 使用缓存会让脚本不再是纯函数, 与 lazy_execution 的语义存在冲突 (见该参数的提示).
    dict__cache: dict = {}

    # 注意: 这里有意覆盖 V3 基类标记为 final 的 RETURN_TYPES / RETURN_NAMES.
    # 原因: prompt 校验阶段 (execution.py) 会通过 RETURN_TYPES[输出端口序号] 取上游节点的输出类型,
    # 而前端 JS 动态添加的输出端口 (output_0, output_1, ...) 不存在于 V3 schema 静态声明的 outputs 中,
    # 定长列表会在该校验处直接 IndexError. ByPassTypeTuple 越界时返回 AnyType("*") 以绕过该校验.
    # @final 只是类型标注, 运行时类属性查找会优先命中本子类的定义.
    RETURN_TYPES = ByPassTypeTuple(("*",))
    RETURN_NAMES = ByPassTypeTuple(("exception",))

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="DynamicScriptNode",
            display_name="dynamic_script",
            category=get_category("script"),
            description=(
                "This node is used to execute Python scripts within a workflow, "
                "enabling functionality that is difficult or impossible to achieve using nodes alone. "
                "It accepts multiple inputs and produces multiple outputs. "
                "When an exception occurs, relevant information is output to the fixed 'exception' port. "
                "The first N dynamic inputs (determined by module_count) are treated as user-defined module code. "
                "A global singleton dict named 'cache' is injected into the script environment, "
                "allowing expensive values to be shared across workflow executions."
            ),
            search_aliases=["python", "executor", "code"],
            # 动态输入端口 (input_0, input_1, ...) 由前端 JS 管理, 不在 schema 中声明;
            # 打开此开关后, prompt 中未声明的输入会按原名作为 kwargs 传入 execute
            accept_all_inputs=True,
            hidden=[io.Hidden.unique_id, io.Hidden.prompt],
            inputs=[
                io.Int.Input(
                    "input_ports_count",
                    default=2,
                    min=0,
                    max=100,
                    step=1,
                    tooltip="The number of input ports for this node.",
                    # socketless: 计数控件只允许作为纯控件存在, 禁止接线
                    # (旧版用 connection_blocking.js 拦截连接, V3 原生支持该特性)
                    socketless=True,
                ),
                io.Int.Input(
                    "output_ports_count",
                    default=1,
                    min=0,
                    max=100,
                    step=1,
                    tooltip="The number of output ports for this node.",
                    socketless=True,
                ),
                io.Int.Input(
                    "module_count",
                    default=0,
                    min=0,
                    max=100,
                    step=1,
                    tooltip=(
                        "Number of leading dynamic inputs to treat as user module code. "
                        "These inputs will be compiled into importable modules before the main script runs. "
                        "The actual script inputs start from input_{module_count}, "
                        "but you can still access the input module code by inputs list in code"
                    ),
                    socketless=True,
                ),
                io.String.Input(
                    "module_name_prefix",
                    default="dynamic_module",
                    tooltip=(
                        "Prefix for auto-generated module names. The i-th module will be named {prefix}__{i}, "
                        "then you can import them in your code."
                    ),
                ),
                io.Boolean.Input(
                    "remove_import_restrictions",
                    default=False,
                    tooltip="Allow importing any module. (use with caution, check the code first !!!)",
                ),
                io.Boolean.Input(
                    "lazy_execution",
                    default=False,
                    tooltip=(
                        "Execute the code lazily. Note: Enable this option only when the script executed by this node is a pure function "
                        "(output depends solely on the input; in other words, the same input always produces the same output). "
                        "When this option is enabled, the node will re-execute only when the value at its input changes. "
                        "Warning: reading from or writing to 'cache' breaks the pure-function assumption, "
                        "do not enable this option if your script uses 'cache'."
                    ),
                ),
                io.String.Input(
                    "code",
                    placeholder=(
                        "code here... (with python. inputs/outputs are built-in list variables to access dynamic ports. "
                        "cache is a built-in global singleton dict shared across workflow executions. "
                        "it is highly recommended to input script code via multi-line string nodes or text file read nodes to prevent script loss). "
                        "you can import your custom modules here with name {module_name_prefix}__{i} (i starts form zero and i < module_count)"
                    ),
                    multiline=True,
                ),
            ],
            outputs=[
                io.AnyType.Output(
                    display_name="exception",
                    tooltip="Exception information or None.",
                ),
            ],
        )

    # 总是刷新 (float("NaN") 不等于任何值, 也不等于自身)
    # 该函数应该接收和主函数相同的参数, 这里用 **kwargs 接收所有参数
    @classmethod
    def fingerprint_inputs(cls, lazy_execution=False, **kwargs):
        if lazy_execution:
            return "lazy_execution"
        return float("NaN")

    @classmethod
    def execute(
        cls,
        input_ports_count,
        output_ports_count,
        module_count,
        module_name_prefix,
        remove_import_restrictions,
        lazy_execution,
        code,
        **kwargs,
    ) -> io.NodeOutput:
        """execute python script with user-defined modules"""

        # 获取节点实例标题 (V3 中 hidden 输入统一通过 cls.hidden 访问)
        unique_id = getattr(cls.hidden, "unique_id", "")
        prompt = getattr(cls.hidden, "prompt", {}) or {}
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
            # 黑名单过滤: 除了明确禁用的危险内置函数外全部放行
            # (注意: 这只是防君子不防小人的提示性限制, 不是真正的安全沙盒)
            builtins__final = {}
            for name, obj in builtins.__dict__.items():
                # 跳过黑名单中的函数
                if name in builtins__unsafe:
                    continue
                else:
                    builtins__final[name] = obj

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
            # 注入全局单例缓存字典, 用户代码可以自行对其增删改查,
            # 使计算开销巨大的值可以跨工作流执行共享 (服务重启后清空)
            "cache": cls.dict__cache,
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
            return io.NodeOutput(None, *outputs)

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

            return io.NodeOutput(
                context__exception,
                *outputs,
            )

        finally:
            # 清理本次注册的模块缓存
            for name in list__registered_modules:
                sys.modules.pop(name, None)
