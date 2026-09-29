# 图表渲染支持模块: 负责解析 PlantUML / Mermaid / Graphviz 工具路径 (含智能退化),
# 并通过 subprocess 调用外部工具把图表源码渲染为图像文件.
#
# 职责边界:
# - 本模块只产出文件 (写入 ComfyUI temp 目录) 与文本 (SVG 源码), 不接触 UI 类型,
#   以便节点层自由组合 SavedImages / tensor 等输出形式
# - 所有路径解析都发生在调用时 (执行期), 节点定义期零文件系统 IO;
#   设置项每次执行时实时读取, 修改后无需重启
from __future__ import annotations

import os
import re
import shlex
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import NamedTuple, Optional

import folder_paths

from .utils import LogUtils
from .utils import check_is_equivalent_empty


# ==================== 设置项键名 (与 js/diagram.js 中注册的设置 ID 保持一致) ====================

SETTING_KEY__PLANTUML = "ComfyDynamic.Diagram.path__plantuml"
SETTING_KEY__JAVA = "ComfyDynamic.Diagram.path__java"
SETTING_KEY__MERMAID = "ComfyDynamic.Diagram.path__mermaid"
SETTING_KEY__GRAPHVIZ = "ComfyDynamic.Diagram.path__graphviz"

# ==================== 选项常量 (与节点 schema 保持一致) ====================

# 支持的引擎列表 (顺序即 auto 模式的展示顺序参考)
ENGINES = ["graphviz", "mermaid", "plantuml"]

# 引擎下拉框选项 (auto 为启发式识别)
ENGINE_OPTIONS = ["auto"] + ENGINES

# 支持的输出格式列表 (同时作为格式下拉框选项)
FORMATS = ["png", "svg"]

# Graphviz 布局引擎列表 (Graphviz 官方固定提供的引擎, 与可执行文件同名).
# 注意: 这是引擎层面的静态事实, 不依赖文件系统扫描, 因此下拉框选项可以静态声明;
# "懒" 的正确落点是把目录扫描与可执行文件解析全部推迟到执行期 (见 resolve_graphviz)
GRAPHVIZ_LAYOUT_ENGINES = [
    "dot",
    "neato",
    "fdp",
    "sfdp",
    "circo",
    "twopi",
    "patchwork",
    "osage",
]

# ==================== 文件名与目录惯例 ====================

# 各引擎源文件的惯例扩展名 (写入临时源文件时使用)
SOURCE_SUFFIXES = {
    "plantuml": ".uml",
    "mermaid": ".mmd",
    "graphviz": ".gv",
}

# 可执行文件候选后缀 (按优先级排列).
# Windows 下 npm 安装的命令行工具通常是 .cmd (mmdc), 发行包是 .exe;
# 非 Windows 平台一律无后缀
EXE_SUFFIXES = [".exe", ".cmd", ".bat", ""] if os.name == "nt" else [""]

# 原生二进制工具 (java / graphviz) 的候选后缀: .cmd / .bat 包装器对它们没有意义
NATIVE_EXE_SUFFIXES = [".exe", ""] if os.name == "nt" else [""]

# 各工具的候选文件名主干 (不含后缀)
STEMS__JAVA = ["java"]
STEMS__PLANTUML_JAR = ["plantuml.jar"]
STEMS__PLANTUML_EXE = ["plantuml"]
STEMS__MERMAID = ["mmdc"]
STEMS__GRAPHVIZ_DOT = ["dot"]

# 同目录内查找时使用的子目录列表 (空字符串表示目录本身)
DIR_CANDIDATES__SAME_DIR = [""]

# 工具安装根目录的惯例子目录 (Windows 的 Graphviz 安装器把可执行文件放在 <root>/bin)
DIR_CANDIDATES__TOOL_ROOT = ["", "bin"]

# ==================== 运行参数 ====================

# subprocess 超时 (秒). Mermaid 每次调用都要启动 headless Chromium, 冷启动可能很慢
SUBPROCESS_TIMEOUT_SECONDS = 15

# mermaid png 输出的像素缩放倍数 (scale 越大预览越清晰, 渲染也越慢)
MERMAID_PNG_SCALE = 2

# 报错信息中 stderr 摘要的最大字符数
STDERR_SNIPPET_MAX_CHARS = 800

# ==================== 引擎识别正则 (auto 模式, 按顺序匹配) ====================

# plantuml: 图表块以 @start 开头 (@startuml / @startmindmap / @startgantt ...)
RE_DETECT__PLANTUML = re.compile(r"^\s*@\s*start", re.IGNORECASE | re.MULTILINE)

# mermaid: 常见图表类型关键字.
# graph 需要后跟方向关键字 (TB/TD/BT/RL/LR), 以区分 graphviz 的 graph 语句
RE_DETECT__MERMAID = re.compile(
    r"^\s*(?:flowchart|graph\s+(?:TB|TD|BT|RL|LR)\b|sequenceDiagram|classDiagram"
    r"|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie\b|mindmap|timeline|gitGraph"
    r"|quadrantChart|requirementDiagram|c4Context|sankey-beta|xychart-beta"
    r"|block-beta|architecture-beta)\b",
    re.IGNORECASE | re.MULTILINE,
)

# graphviz: digraph / graph 语句 (strict 可选前缀)
RE_DETECT__GRAPHVIZ = re.compile(
    r"^\s*(?:strict\s+)?(?:digraph|graph)\b", re.IGNORECASE | re.MULTILINE
)


class DiagramToolError(RuntimeError):
    """图表工具解析 / 调用失败. 消息面向最终用户, 提示如何修复配置"""


class PlantUmlTool(NamedTuple):
    """解析后的 PlantUML 调用方式: java + jar 组合, 或独立可执行文件 (二选一)"""

    path__jar: Optional[Path]
    path__java: Optional[Path]
    path__exe: Optional[Path]


class DiagramRenderResult(NamedTuple):
    """一次渲染的产物.

    源码包含多个图表块时 (仅 PlantUML 支持) 会有多个产物文件, 因此所有字段均为列表:
    png 列表始终非空 (IMAGE 输出需要栅格图);
    svg 列表仅 svg 模式且渲染成功时非空, text 与 name 一一对应
    """

    list__path__png: list[Path]
    list__name__png: list[str]
    list__path__svg: list[Path]
    list__name__svg: list[str]
    list__text__svg: list[str]  # svg 源码, 与 list__name__svg 对齐; 渲染降级时为空列表


# ==================== 基础工具函数 ====================


def _print_warn(message: str, flag__verbose: bool = True) -> None:
    """打印退化警告. fingerprint 等高频路径传 flag__verbose=False 以避免刷屏"""
    if flag__verbose:
        LogUtils.print_log(message, _name__node="Diagram")


def _expand_candidates(list__stems: list[str], list__suffixes: list[str]) -> list[str]:
    """展开 文件名主干 x 后缀 为完整候选文件名列表 (保持优先级顺序)"""
    return [f"{stem}{suffix}" for stem in list__stems for suffix in list__suffixes]


def _get_setting_path(string__key: str, flag__verbose: bool = True) -> Optional[Path]:
    """读取设置项并转为 Path.

    空值返回 None (走退化链); 相对路径被禁止 (解析基准是进程 CWD, 不可靠);
    指向不存在的路径时打印警告并返回 None
    """
    raw = LogUtils.get_comfy_setting(string__key)
    if not isinstance(raw, str) or check_is_equivalent_empty(raw):
        return None
    # 去除首尾空白与引号 (Windows 资源管理器 "复制文件地址" 会产生带引号的路径)
    cleaned = raw.strip().strip('"')
    if not cleaned:
        return None
    path = Path(cleaned)
    if not path.is_absolute():
        _print_warn(
            f"setting '{string__key}' must be an absolute path, fallback will be used: {raw}",
            flag__verbose,
        )
        return None
    if not path.exists():
        _print_warn(
            f"setting '{string__key}' points to a non-existent path, fallback will be used: {raw}",
            flag__verbose,
        )
        return None
    return path


def _find_in_dir(
    path__dir: Path,
    list__candidates: list[str],
    list__sub_dirs: list[str],
) -> Optional[Path]:
    """在目录 (及惯例子目录) 中按候选文件名顺序查找, 找不到返回 None"""
    for sub in list__sub_dirs:
        base = path__dir / sub if sub else path__dir
        for name in list__candidates:
            candidate = base / name
            if candidate.is_file():
                return candidate
    return None


def _which(string__name: str) -> Optional[Path]:
    """在 PATH 中查找可执行文件 (shutil.which 在 Windows 上会自动应用 PATHEXT 规则)"""
    found = shutil.which(string__name)
    return Path(found) if found else None


def _split_command_args(string__args: str) -> list[str]:
    """把自定义命令行参数字符串拆分为参数列表 (供 _render_* 追加到命令行末尾).

    拆分规则:
    - Windows: 显式状态机拆分. 仅双引号作为分组定界符 (与 cmd 的约定一致, 单引号是普通字符),
        引号字符本身不进入参数值; 反斜杠恒为字面量, 保留 Windows 路径的原始形态.
        不使用 shlex 的 posix=False 模式: 该模式只在引号包裹整个 token 时才分组,
        形如 key="value with spaces" 的参数会从空格处被拆断并残留引号字符
    - 其它平台: shlex posix=True 模式, 走标准 shell 规则 (单双引号与反斜杠转义均由 shlex 处理)
    - 空串 / 纯空白返回空列表; 引号不配对抛 ValueError, 由执行链直接向用户报错
    """
    string__args = string__args.strip()
    if not string__args:
        return []
    if os.name != "nt":
        try:
            return shlex.split(string__args, posix=True)
        except ValueError as exception:
            raise ValueError(
                f"Invalid extra args ({exception}): {string__args}"
            ) from exception
    # Windows 分支: 引号外的空白分隔参数, 引号内的空白原样保留
    list__args = []
    list__chars = []
    flag__has_token = False
    flag__in_quotes = False
    for char in string__args:
        if char == '"':
            flag__in_quotes = not flag__in_quotes
            flag__has_token = True
        elif char in " \t" and not flag__in_quotes:
            if flag__has_token:
                list__args.append("".join(list__chars))
                list__chars = []
                flag__has_token = False
        else:
            list__chars.append(char)
            flag__has_token = True
    if flag__in_quotes:
        raise ValueError(f"Invalid extra args (no closing quotation): {string__args}")
    if flag__has_token:
        list__args.append("".join(list__chars))
    return list__args


# ==================== 工具路径解析 (含智能退化) ====================


def resolve_java(flag__verbose: bool = True) -> Optional[Path]:
    """解析 java 可执行文件: 设置路径 (文件或目录) -> PATH. 找不到返回 None"""
    path = _get_setting_path(SETTING_KEY__JAVA, flag__verbose)
    if path is not None:
        # 指定的是文件: 直接信任用户配置
        if path.is_file():
            return path
        # 指定的是目录: 依次查找 <dir>/java(.exe) 与 <dir>/bin/java(.exe)
        found = _find_in_dir(
            path,
            _expand_candidates(STEMS__JAVA, NATIVE_EXE_SUFFIXES),
            DIR_CANDIDATES__TOOL_ROOT,
        )
        if found is not None:
            return found
        _print_warn(
            f"'{SETTING_KEY__JAVA}' is a directory without a java executable, fallback to PATH",
            flag__verbose,
        )
    found = _which("java")
    if found is None and path is not None:
        _print_warn("java not found on PATH either", flag__verbose)
    return found


def resolve_plantuml(flag__verbose: bool = True) -> PlantUmlTool:
    """解析 PlantUML 工具. 退化链:

    1. 设置指向 jar 文件: 需要 java (设置 -> PATH);
       java 不可用时尝试 jar 同目录的 exe, 再尝试 PATH 上的 plantuml
    2. 设置指向 exe/cmd/bat 文件: 直接使用
    3. 设置指向目录: 依次尝试 plantuml.jar (需 java) 与 plantuml 可执行文件
    4. 以上全部失败: PATH 上的 plantuml, 仍失败则抛 DiagramToolError
    """
    path = _get_setting_path(SETTING_KEY__PLANTUML, flag__verbose)

    # ---- 情形 1/2: 设置指向具体文件 ----
    if path is not None and path.is_file():
        if path.suffix.lower() == ".jar":
            path__java = resolve_java(flag__verbose)
            if path__java is not None:
                return PlantUmlTool(
                    path__jar=path, path__java=path__java, path__exe=None
                )
            # jar 在但 java 不可用: 先找 jar 同目录的 exe (官方 Windows 发行包常见组合), 再退化 PATH
            _print_warn(
                "plantuml.jar found but java is unavailable, trying a plantuml executable next to the jar",
                flag__verbose,
            )
            path__exe = _find_in_dir(
                path.parent,
                _expand_candidates(STEMS__PLANTUML_EXE, EXE_SUFFIXES),
                DIR_CANDIDATES__SAME_DIR,
            )
            if path__exe is None:
                path__exe = _which("plantuml")
                if path__exe is not None:
                    _print_warn(
                        f"falling back to plantuml on PATH: {path__exe}", flag__verbose
                    )
            if path__exe is None:
                raise DiagramToolError(
                    f"plantuml.jar was configured ('{path}') but no java and no plantuml executable are available. "
                    f"Configure '{SETTING_KEY__JAVA}' or install a plantuml executable."
                )
            return PlantUmlTool(path__jar=None, path__java=None, path__exe=path__exe)
        # 非 jar 后缀一律视为独立可执行文件 (exe/cmd/bat), 信任用户配置
        return PlantUmlTool(path__jar=None, path__java=None, path__exe=path)

    # ---- 情形 3: 设置指向目录 ----
    if path is not None and path.is_dir():
        # jar 优先 (以 jar 为主要使用方式的用户更多)
        path__jar = _find_in_dir(path, STEMS__PLANTUML_JAR, DIR_CANDIDATES__SAME_DIR)
        if path__jar is not None:
            path__java = resolve_java(flag__verbose)
            if path__java is not None:
                return PlantUmlTool(
                    path__jar=path__jar, path__java=path__java, path__exe=None
                )
            _print_warn(
                "plantuml.jar found in the directory but java is unavailable, "
                "trying a plantuml executable in the same directory",
                flag__verbose,
            )
        path__exe = _find_in_dir(
            path,
            _expand_candidates(STEMS__PLANTUML_EXE, EXE_SUFFIXES),
            DIR_CANDIDATES__SAME_DIR,
        )
        if path__exe is not None:
            return PlantUmlTool(path__jar=None, path__java=None, path__exe=path__exe)
        _print_warn(
            f"no plantuml.jar or plantuml executable found in '{SETTING_KEY__PLANTUML}' directory, fallback to PATH",
            flag__verbose,
        )

    # ---- 情形 4: PATH 退化 ----
    path__exe = _which("plantuml")
    if path__exe is None:
        raise DiagramToolError(
            "PlantUML not found. Configure 'ComfyDynamic.Diagram.path__plantuml' "
            "(a plantuml.jar / plantuml executable / directory) "
            "or put 'plantuml' (and java if using the jar) on PATH."
        )
    return PlantUmlTool(path__jar=None, path__java=None, path__exe=path__exe)


def resolve_mermaid(flag__verbose: bool = True) -> Path:
    """解析 mermaid-cli (mmdc): 设置路径 (文件或目录) -> PATH. 失败抛 DiagramToolError"""
    path = _get_setting_path(SETTING_KEY__MERMAID, flag__verbose)
    if path is not None:
        # 指定的是文件: 直接信任用户配置
        if path.is_file():
            return path
        # 指定的是目录: 按 npm 惯例文件名查找 (Windows 通常是 mmdc.cmd)
        found = _find_in_dir(
            path,
            _expand_candidates(STEMS__MERMAID, EXE_SUFFIXES),
            DIR_CANDIDATES__SAME_DIR,
        )
        if found is not None:
            return found
        _print_warn(
            f"no mmdc executable found in '{SETTING_KEY__MERMAID}' directory, fallback to PATH",
            flag__verbose,
        )
    found = _which("mmdc")
    if found is None:
        raise DiagramToolError(
            "mermaid-cli (mmdc) not found. Configure 'ComfyDynamic.Diagram.path__mermaid' "
            "(mmdc executable or its directory) or run 'npm install -g @mermaid-js/mermaid-cli'."
        )
    return found


def resolve_graphviz(string__layout: str, flag__verbose: bool = True) -> Path:
    """解析 graphviz 可执行文件 (针对指定布局引擎). 退化链:

    1. 设置指向文件: 与目标布局同名则直接使用; 否则先在其同目录查找 <layout> 同名文件,
       找不到则使用该文件本身 (graphviz 的 -K 参数可显式切换布局引擎)
    2. 设置指向目录: 先查找 <layout> 同名文件, 再退化到 dot (兼容 <root>/bin 惯例布局)
    3. 设置为空 / 无效 / 目录中无文件: PATH 上的 dot
    4. dot 也没有: 抛 DiagramToolError
    """
    path = _get_setting_path(SETTING_KEY__GRAPHVIZ, flag__verbose)
    list__layout_candidates = _expand_candidates([string__layout], NATIVE_EXE_SUFFIXES)

    # ---- 情形 1: 设置指向具体文件 ----
    if path is not None and path.is_file():
        # 文件与目标布局同名: 直接使用
        if path.stem.lower() == string__layout.lower():
            return path
        # 同目录查找目标布局引擎
        path__sibling = _find_in_dir(
            path.parent, list__layout_candidates, DIR_CANDIDATES__SAME_DIR
        )
        if path__sibling is not None:
            return path__sibling
        # 找不到: 使用指定文件 + -K<layout> (所有 graphviz 可执行文件都接受 -K 参数)
        _print_warn(
            f"graphviz layout '{string__layout}' executable not found next to '{path.name}', "
            f"using it with '-K{string__layout}' instead",
            flag__verbose,
        )
        return path

    # ---- 情形 2: 设置指向目录 ----
    path__base = None
    if path is not None and path.is_dir():
        # 布局引擎同名文件优先
        path__base = _find_in_dir(
            path, list__layout_candidates, DIR_CANDIDATES__TOOL_ROOT
        )
        if path__base is None:
            # 退化到目录内的 dot
            path__base = _find_in_dir(
                path,
                _expand_candidates(STEMS__GRAPHVIZ_DOT, NATIVE_EXE_SUFFIXES),
                DIR_CANDIDATES__TOOL_ROOT,
            )
        if path__base is None:
            _print_warn(
                f"no graphviz executables found in '{SETTING_KEY__GRAPHVIZ}' directory, fallback to PATH",
                flag__verbose,
            )

    # ---- 情形 3: PATH 退化 ----
    if path__base is None:
        path__base = _which("dot")
        if path__base is None:
            raise DiagramToolError(
                "Graphviz 'dot' not found. Configure 'ComfyDynamic.Diagram.path__graphviz' "
                "(dot executable or a Graphviz directory) or add Graphviz's bin directory to PATH."
            )
        return path__base

    # 目录中只找到与请求布局不同名的文件 (如 dot): 需要 -K<layout> 切换引擎
    if path__base.stem.lower() != string__layout.lower():
        _print_warn(
            f"graphviz layout '{string__layout}' executable not found, "
            f"using '{path__base.name}' with '-K{string__layout}' instead",
            flag__verbose,
        )
    return path__base


# ==================== 引擎识别 (auto 模式) ====================


def detect_engine(string__code: str) -> str:
    """auto 模式下按启发式规则识别引擎.

    无法识别时默认 mermaid 并打印警告 (mermaid 语法最宽松, 作为兜底最不容易误导用户)
    """
    if RE_DETECT__PLANTUML.search(string__code):
        return "plantuml"
    if RE_DETECT__MERMAID.search(string__code):
        return "mermaid"
    if RE_DETECT__GRAPHVIZ.search(string__code):
        return "graphviz"
    _print_warn(
        "engine auto-detection could not recognize the code, defaulting to 'mermaid'. "
        "Select the engine explicitly to avoid ambiguity."
    )
    return "mermaid"


# ==================== 渲染执行 ====================


def _run_subprocess(list__command: list[str], string__engine: str) -> None:
    """执行外部工具命令.

    非零退出 / 超时 / 启动失败统一抛 DiagramToolError (含 stderr 摘要).
    注意: 超时时 subprocess.run 只会杀死直接子进程, mmdc 的 Chromium 孙进程可能残留 (罕见)
    """
    # CREATE_NO_WINDOW: 避免在 Windows 上弹出控制台窗口 (特别是 mermaid 的 node 进程)
    creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    # 批处理目标 (.cmd / .bat) 必须显式转发给 cmd.exe:
    # 直接把批处理文件交给 subprocess 时, CreateProcess 会自动改调 cmd.exe /c,
    # 但只是把命令行原样拼接在其后; 当可执行文件路径含空格且后续参数也含空格
    # (两者均被引号包裹) 时, 会命中 cmd 的引号剥离规则 (cmd /? 中规则 2):
    # 首个字符是引号时剥掉第一个字符与最后一个引号, 导致命令行被拆错而执行失败.
    # 修复方式: 显式调用 cmd.exe /d /s /c, 并把完整命令行整体再包一层引号;
    # /s 强制 cmd 走 "剥离最外层引号, 保留其余全部引号" 的老办法, 内层引号原样保留,
    # 含空格路径被稳定解析; /d 跳过注册表 AutoRun 脚本, 避免环境差异干扰.
    # 命令行以字符串形式传入 (Windows 下 shell=False 时直接作为 CreateProcess 的
    # 命令行参数), 绕开 subprocess 对列表参数的二次引号转义 (cmd 不识别反斜杠转义).
    # 仅 Windows 存在批处理文件语义, 其它平台永远走列表分支
    args__command = list__command
    if os.name == "nt" and list__command[0].lower().endswith((".cmd", ".bat")):
        command_line = subprocess.list2cmdline(list__command)
        args__command = f'cmd.exe /d /s /c "{command_line}"'
    try:
        completed = subprocess.run(
            args__command,
            capture_output=True,
            timeout=SUBPROCESS_TIMEOUT_SECONDS,
            creationflags=creation_flags,
        )
    except subprocess.TimeoutExpired as exception:
        raise DiagramToolError(
            f"{string__engine} timed out after {SUBPROCESS_TIMEOUT_SECONDS}s. "
            "(Mermaid's first run may need to warm up Chromium, just wait and retry.)"
        ) from exception
    except OSError as exception:
        raise DiagramToolError(
            f"failed to launch {string__engine}: {exception}"
        ) from exception

    # stderr 可能是任意编码 (Windows 控制台常为 GBK), 解码失败时用替换字符兜底
    stderr_text = (
        completed.stderr.decode("utf-8", errors="replace").strip()
        if completed.stderr
        else ""
    )
    if completed.returncode != 0:
        snippet = stderr_text[:STDERR_SNIPPET_MAX_CHARS]
        raise DiagramToolError(
            f"{string__engine} exited with code {completed.returncode}:\n{snippet if snippet else '(no stderr output)'}"
        )
    # 成功时的 stderr 通常是诊断信息, 仅记录到控制台
    if stderr_text:
        LogUtils.print_log(
            f"{string__engine} stderr: {stderr_text[:STDERR_SNIPPET_MAX_CHARS]}",
            _name__node="Diagram",
        )


def _render_plantuml(
    path__source: Path, path__output: Path, list__extra_args: list[str]
) -> list[Path]:
    """调用 PlantUML 渲染到 path__output (格式由输出文件扩展名决定), 返回全部产物路径.

    源文件包含多个 @start* 块时会渲染出多个文件: <stem>.png, <stem>_001.png, ...
    (单图源码恰好产出一个文件), 全部搬移到输出目录并按渲染顺序返回
    """
    tool = resolve_plantuml()
    # PlantUML 的输出文件名固定为 <源文件主干>.<扩展名>, 因此先渲染到源文件所在目录再搬运
    format_flag = "-t" + path__output.suffix.lstrip(".")
    if tool.path__jar is not None:
        list__command = [
            str(tool.path__java),
            "-jar",
            str(tool.path__jar),
            "-charset",
            "UTF-8",  # 源文件编码
            "-failfast2",  # 语法错误时以非零退出码失败 (默认会渲染错误图像且退出码为 0)
            format_flag,
            "-o",
            str(path__source.parent),  # 输出目录
            str(path__source),
        ]
    else:
        list__command = [
            str(tool.path__exe),
            "-charset",
            "UTF-8",
            "-failfast2",
            format_flag,
            "-o",
            str(path__source.parent),
            str(path__source),
        ]
    # 自定义参数追加在内置参数之后: 靠后的同名 flag 通常优先生效, 用户可覆盖内置行为
    list__command += list__extra_args
    _run_subprocess(list__command, "plantuml")
    # 工作目录是独立的 mkdtemp 目录, glob 不会误拾其它文件;
    # 排序规则: '.' 的字典序在 '_' 之前, 恰好使首图 <stem>.png 排在最前
    list__produced = sorted(
        path__source.parent.glob(f"{path__source.stem}*{path__output.suffix}")
    )
    if not list__produced:
        raise DiagramToolError("plantuml did not produce the expected output file.")
    list__moved = []
    for path__produced in list__produced:
        # 命名规则: <输出主干><序号部分><扩展名>, 序号部分 = 产物主干去掉源主干后的余部
        part = path__produced.stem[len(path__source.stem) :]
        path__moved = path__output.with_name(
            f"{path__output.stem}{part}{path__output.suffix}"
        )
        shutil.move(str(path__produced), str(path__moved))
        list__moved.append(path__moved)
    return list__moved


def _render_mermaid(
    path__source: Path, path__output: Path, list__extra_args: list[str]
) -> list[Path]:
    """调用 mermaid-cli (mmdc) 渲染到 path__output (格式由输出文件扩展名决定), 返回产物路径"""
    path__exe = resolve_mermaid()
    list__command = [str(path__exe), "-i", str(path__source), "-o", str(path__output)]
    if path__output.suffix.lower() == ".png":
        # png 输出统一白底 (默认背景透明); scale 放大像素密度让预览更清晰
        list__command += ["-b", "white", "-s", str(MERMAID_PNG_SCALE)]
    # 自定义参数追加在内置参数之后: 靠后的同名 flag 通常优先生效, 用户可覆盖内置行为
    list__command += list__extra_args
    _run_subprocess(list__command, "mermaid")
    return [path__output]


def _render_graphviz(
    path__source: Path,
    path__output: Path,
    string__layout: str,
    list__extra_args: list[str],
) -> list[Path]:
    """调用 graphviz 渲染到 path__output (格式由输出文件扩展名决定), 返回产物路径.

    始终显式传 -K<layout>: 即使实际调用的是 dot.exe (退化场景) 也能按请求的引擎布局
    """
    path__exe = resolve_graphviz(string__layout)
    list__command = [
        str(path__exe),
        "-K" + string__layout,
        "-T" + path__output.suffix.lstrip("."),
        str(path__source),
        "-o",
        str(path__output),
    ]
    # 自定义参数追加在内置参数之后: 靠后的同名 flag 通常优先生效, 用户可覆盖内置行为
    list__command += list__extra_args
    _run_subprocess(list__command, "graphviz")
    return [path__output]


def _render_to_file(
    string__engine: str,
    path__source: Path,
    path__output: Path,
    string__layout: str,
    list__extra_args: list[str],
) -> list[Path]:
    """按引擎分发渲染调用, 返回全部产物文件路径"""
    if string__engine == "plantuml":
        return _render_plantuml(path__source, path__output, list__extra_args)
    elif string__engine == "mermaid":
        return _render_mermaid(path__source, path__output, list__extra_args)
    elif string__engine == "graphviz":
        return _render_graphviz(
            path__source, path__output, string__layout, list__extra_args
        )
    else:
        raise ValueError(f"Unsupported engine: {string__engine}")


def render_diagram(
    string__code: str,
    string__engine: str,
    string__format: str,
    string__layout: str,
    string__extra_args: str = "",
    flag__verbose: bool = True,
) -> DiagramRenderResult:
    """渲染图表源码, 产物写入 ComfyUI temp 目录.

    png 模式: 只渲染 png;
    svg 模式: 渲染 png (供 IMAGE 输出) 与 svg (供预览与源码输出),
    svg 渲染失败不视为整体失败, 返回空源码并打印警告.
    string__extra_args: 用户自定义命令行参数, shell 风格拆分后追加到目标程序
    命令行末尾 (png 与 svg 两次渲染均生效); 拆分失败抛 ValueError
    """
    if check_is_equivalent_empty(string__code):
        raise ValueError("Diagram code is empty.")
    if string__engine not in ENGINES:
        raise ValueError(f"Unsupported engine: {string__engine}")
    if string__format not in FORMATS:
        raise ValueError(f"Unsupported format: {string__format}")
    # 拆分提前到所有文件 IO 之前: 参数字符串非法时直接报错, 不留下半途产物
    list__extra_args = _split_command_args(string__extra_args)

    dir__temp = Path(folder_paths.get_temp_directory())
    dir__temp.mkdir(parents=True, exist_ok=True)
    # png 与 svg 各使用一个独立的随机主干名; 同一源的多个图表块共享主干并以序号区分
    stem__png = f"dynamic_diagram_{uuid.uuid4().hex}"
    stem__svg = (
        f"dynamic_diagram_{uuid.uuid4().hex}" if string__format == "svg" else None
    )

    # 源码写入系统临时目录的独立工作文件夹, 结束后整体清理
    dir__work = Path(tempfile.mkdtemp(prefix="comfy_dynamic_diagram_"))
    try:
        path__source = dir__work / f"source{SOURCE_SUFFIXES[string__engine]}"
        path__source.write_text(string__code, encoding="utf-8")

        list__path__png = _render_to_file(
            string__engine,
            path__source,
            dir__temp / f"{stem__png}.png",
            string__layout,
            list__extra_args,
        )
        list__name__png = [path__png.name for path__png in list__path__png]

        list__path__svg: list[Path] = []
        list__name__svg: list[str] = []
        list__text__svg: list[str] = []
        if stem__svg is not None:
            try:
                list__path__svg = _render_to_file(
                    string__engine,
                    path__source,
                    dir__temp / f"{stem__svg}.svg",
                    string__layout,
                    list__extra_args,
                )
                list__name__svg = [path__svg.name for path__svg in list__path__svg]
                list__text__svg = [
                    path__svg.read_text(encoding="utf-8")
                    for path__svg in list__path__svg
                ]
            except Exception as exception:
                # png 已成功, svg 侧任何失败 (工具错误 / IO 错误 / 解码错误) 都不阻塞整体执行:
                # 降级为空源码, 由节点层以空字符串按图像数量对齐补齐
                _print_warn(
                    f"svg render failed (the image output is unaffected): {exception}",
                    flag__verbose,
                )
                list__path__svg = []
                list__name__svg = []
                list__text__svg = []

        return DiagramRenderResult(
            list__path__png=list__path__png,
            list__name__png=list__name__png,
            list__path__svg=list__path__svg,
            list__name__svg=list__name__svg,
            list__text__svg=list__text__svg,
        )
    finally:
        shutil.rmtree(dir__work, ignore_errors=True)


# ==================== fingerprint 支持 ====================


def _file_signature(path: Optional[Path]) -> str:
    """文件指纹签名 (mtime + 大小), 用于检测工具文件变化"""
    if path is None:
        return "missing"
    try:
        stat = path.stat()
        return f"{stat.st_mtime_ns}:{stat.st_size}"
    except OSError:
        return "invalid"


def describe_resolved_tools(string__layout: str, flag__verbose: bool = False) -> str:
    """汇总当前设置下各工具的解析结果签名, 供 fingerprint_inputs 使用.

    任一工具文件变化都会改变指纹并触发节点重新渲染;
    解析失败不抛异常 (返回 unresolved 标记, 执行阶段会给出完整报错)
    """
    list__parts = []
    try:
        tool = resolve_plantuml(flag__verbose)
        list__parts.append(
            f"plantuml={_file_signature(tool.path__jar or tool.path__exe)}"
        )
        list__parts.append(f"java={_file_signature(tool.path__java)}")
    except DiagramToolError:
        list__parts.append("plantuml=unresolved")
    try:
        list__parts.append(f"mermaid={_file_signature(resolve_mermaid(flag__verbose))}")
    except DiagramToolError:
        list__parts.append("mermaid=unresolved")
    try:
        list__parts.append(
            f"graphviz={_file_signature(resolve_graphviz(string__layout, flag__verbose))}"
        )
    except DiagramToolError:
        list__parts.append("graphviz=unresolved")
    return ";".join(list__parts)
