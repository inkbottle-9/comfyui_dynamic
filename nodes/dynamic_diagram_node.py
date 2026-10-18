# 动态图表节点 (V3): 将 PlantUML / Mermaid / Graphviz 源码渲染为图像并显示在节点上.
#
# 设计要点:
# - 输出端口固定为 [image (IMAGE), text (STRING)], 两者均声明为输出列表 (is_output_list):
#   PlantUML 源码可包含多个 @start* 块, 会渲染出多张图, 此时两个端口各输出与图像数量
#   对齐的列表; image 始终是 png 渲染结果 (svg 无法直接栅格化, 因此 svg 模式下额外渲染
#   一份 png), text 在 svg 模式下逐图输出 SVG 源码, png 模式下输出空字符串
# - 节点同时声明为输出节点 (is_output_node=True): 输出端口未连接时也能作为终点执行并预览,
#   连接时则可参与下游执行链
# - 节点上显示的图像来自 ui.SavedImages (V3 标准 UI 输出通道, 与内置 PreviewImage 相同),
#   多图时预览列表同样展示全部图像, 新版前端对任意输出节点的 ui.images 都有通用预览渲染,
#   无需配套 JS
# - 渲染失败 (代码语法错误 / 工具未配置或缺失 / 执行超时) 会抛出异常终止执行,
#   错误信息包含工具的 stderr 摘要; PlantUML 的严格报错依赖 -failfast2 参数,
#   需要较新版本的 PlantUML, 过旧版本遇到无效代码可能以无关的参数错误失败
# - 源码通过 code 输入端口接入 (MultiType 声明为 STRING,ARRAY, force_input, 不生成节点内
#   编辑框): 接受单段字符串, 也接受字符串列表 (上游 STRING 列表输出或 ARRAY), 每个列表项
#   独立渲染一组图 (auto 模式逐项识别引擎, 各项可用不同引擎); 非字符串项与空白项忽略并
#   打印警告, 过滤后空集输出 0 张图 (no-op, 不报错).
#   节点声明 is_input_list=True: 所有输入单次执行整列表处理, 不走 ComfyUI 默认的
#   按列表元素多次执行机制
# - 节点末尾的 extra args 单行输入框用于向目标程序追加自定义命令行参数
#   (仅做 shell 风格拆分后逐字透传, 不做校验)
# - 工具路径解析 (含智能退化) 与外部进程调用全部在 core/diagram.py 中, 本文件只负责
#   schema 声明与结果组装
from pathlib import Path

import numpy as np
import torch
from PIL import Image as PILImage

from comfy_api.latest import io
from comfy_api.latest import ui

from ..core.diagram import ENGINE_OPTIONS
from ..core.diagram import FORMATS
from ..core.diagram import GRAPHVIZ_LAYOUT_ENGINES
from ..core.diagram import detect_engine
from ..core.diagram import describe_resolved_tools
from ..core.diagram import render_diagram
from ..core.utils import LogUtils
from ..core.utils import get_category


def _load_png_as_tensor(path__png: Path) -> torch.Tensor:
    """把 png 文件转为 ComfyUI IMAGE 格式 tensor, 形状 [1, H, W, 3], 取值范围 0..1"""
    image = PILImage.open(path__png)
    try:
        image.load()
        # 带透明通道的 png (graphviz 默认透明背景) 合成到白底, 避免直接转 RGB 时透明区域变黑
        if image.mode in ("RGBA", "LA", "P"):
            image = image.convert("RGBA")
            background = PILImage.new("RGB", image.size, (255, 255, 255))
            background.paste(image, mask=image.getchannel("A"))
            image = background
        elif image.mode != "RGB":
            image = image.convert("RGB")
        array = np.asarray(image, dtype=np.float32) / 255.0
        return torch.from_numpy(array).unsqueeze(0)
    finally:
        image.close()


def _unwrap_single(value):
    """解包 is_input_list 模式下单值输入的单元素列表包装, 标量原样返回.

    is_input_list=True 时所有输入均以列表形态到达执行函数: widget 输入恒为
    单元素包装 (如 ["auto"]), 必须解包后才能参与比较与透传; 上游 is_output_list
    的完整列表不能在此解包 (由调用方按语义区分处理)
    """
    if isinstance(value, list) and len(value) == 1:
        return value[0]
    return value


def _normalize_code_segments(value) -> list[str]:
    """把 code 端口原始输入归一化为字符串段列表, 每段独立渲染一组图.

    is_input_list 模式下 code 端口的到达形态由上游来源决定:
    - 普通字符串源: ["code"] (执行引擎对非列表值做单元素包装)
    - 字符串列表源 (上游 is_output_list): ["c1", "c2", ...] (整列表原样到达)
    - ARRAY 源: [[...]] (整个 list 值又被包进单元素外层列表, 需解一层)
    - 空 ARRAY 源: [[]]

    归一化规则: 仅保留非空白字符串项; 非字符串项与空白项忽略并打印警告
    (警告用于排查 "列表内容全部被过滤导致输出 0 张图" 的静默场景)
    """
    if isinstance(value, str):  # 兜底: 执行引擎保证列表形态, 此分支正常不可达
        value = [value]
    # ARRAY 源解包: 单元素且元素本身是 list (字符串列表源不会命中, 其元素恒为 str)
    if len(value) == 1 and isinstance(value[0], list):
        value = value[0]
    list__segments = [item for item in value if isinstance(item, str) and item.strip()]
    count__dropped = len(value) - len(list__segments)
    if count__dropped:
        LogUtils.print_log(
            f"ignored {count__dropped} non-string/blank code item(s)",
            _name__node="DynamicDiagramNode",
        )
    return list__segments


# 动态图表节点 (V3)
class DynamicDiagramNode(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id=cls.__name__,  # 直接使用类名
            display_name="Dynamic Diagram Node",
            category=get_category("utils"),
            description=(
                "Renders PlantUML / Mermaid / Graphviz code into images and shows them on the node. "
                "Tool paths are configured in the settings (Comfy Dynamic / Diagram). "
                "A PlantUML source may contain multiple @start* blocks and renders one image per block. "
                "The code input also accepts a list of strings; each item is rendered independently "
                "(an empty list renders nothing). "
                "Render failures (bad code, missing tools, timeout) raise an exception and terminate "
                "execution; strict PlantUML error reporting uses -failfast2, which requires a fairly "
                "recent PlantUML version (very old versions fail with an unrelated argument error)."
            ),
            search_aliases=[
                "plantuml",
                "mermaid",
                "graphviz",
                "diagram",
                "uml",
                "flowchart",
            ],
            is_output_node=True,
            # 整列表单次执行: code 端口以完整列表形态到达 (字符串列表 / ARRAY 解包后
            # 逐项渲染), widget 输入以单元素列表包装到达 (execute 内统一解包);
            # 不使用 ComfyUI 默认的按列表元素多次执行机制
            is_input_list=True,
            inputs=[
                # code 端口: MultiType 混合类型声明 (io_type 拼接为 "STRING,ARRAY"),
                # 传入的 String.Input 作为类型覆写保留 force_input 与 tooltip;
                # 字符串列表源 (上游 is_output_list) 与 ARRAY 源均可接入
                io.MultiType.Input(
                    io.String.Input(
                        "code",
                        force_input=True,  # 无节点内编辑框, 源码由上游节点提供
                        tooltip=(
                            "Diagram source code: a single string, or a list of strings. "
                            "Each list item renders as an independent diagram group; "
                            "non-string and blank items are ignored; an empty list "
                            "renders nothing (the node outputs zero images without an "
                            "error). "
                            "With engine 'auto' the engine is detected from each item "
                            "independently (@start* -> plantuml, mermaid keywords -> "
                            "mermaid, digraph/graph -> graphviz), so items may mix "
                            "engines. "
                            "For PlantUML, do not use named @start blocks "
                            "(e.g. '@startuml myname'): their outputs are written under "
                            "custom file names and get lost; use a plain '@start*' "
                            "instead."
                        ),
                    ),
                    [io.Array],
                ),
                io.Combo.Input(
                    "engine",
                    options=ENGINE_OPTIONS,
                    default="auto",
                    tooltip=(
                        "Which rendering engine to use. "
                        "'auto' detects the engine from each code item independently with heuristics "
                        "and defaults to mermaid when nothing matches."
                    ),
                ),
                io.Combo.Input(
                    "format",
                    options=FORMATS,
                    default="png",
                    tooltip=(
                        "Output format. "
                        "In svg mode the SVG source code is additionally provided through the text output "
                        "(a png render is still produced for the image output); "
                        "in png mode the text output is an empty string."
                    ),
                ),
                io.Combo.Input(
                    "layout",
                    options=GRAPHVIZ_LAYOUT_ENGINES,
                    default="dot",
                    tooltip=(
                        "Graphviz layout engine (ignored by other engines). "
                        "The matching executable is resolved next to the configured graphviz tool at "
                        "execution time; falls back to the configured executable with '-K<layout>', "
                        "then to 'dot' on PATH."
                    ),
                ),
                io.String.Input(
                    "extra_args",
                    display_name="extra args",
                    default="",
                    tooltip=(
                        "Custom command-line arguments appended to the target rendering tool's "
                        "command line, after the built-in arguments (repeated flags typically take "
                        "the later value, e.g. graphviz's -K / -G / -N / -E). "
                        "Exceptions: do not pass -T to graphviz (a repeated -T adds output formats "
                        "instead of overriding; change the format via the format port), and do not "
                        "override mermaid's -i / -o (products would no longer be written to "
                        "ComfyUI's temp directory). "
                        "Arguments are split with shell-like quoting rules; quote values that "
                        "contain spaces. "
                        "Leave empty to pass nothing. "
                        "In plantuml.jar mode the arguments are consumed by PlantUML itself, "
                        "not by the java launcher."
                    ),
                ),
            ],
            outputs=[
                io.Image.Output(
                    display_name="image",
                    tooltip=(
                        "The rendered diagrams (always png renders, also in svg mode); "
                        "one entry per diagram."
                    ),
                    is_output_list=True,
                ),
                io.String.Output(
                    display_name="text",
                    tooltip=(
                        "SVG source code, one entry per diagram, in svg mode "
                        "(all entries are empty strings when the svg render failed); "
                        "empty strings in png mode."
                    ),
                    is_output_list=True,
                ),
            ],
        )

    @classmethod
    def fingerprint_inputs(cls, engine=None, format=None, layout=None, **kwargs):
        # 代码与选项变化会自动触发重新执行, 这里只需覆盖设置文件中的工具路径变化:
        # 修改设置后无需改动任何输入即可重新渲染.
        # flag__verbose=False: 指纹计算发生在每次队列时, 退化警告不应重复刷屏.
        # is_input_list 模式下 layout 可能以单元素列表形态到达 (视调用路径而定),
        # 统一解包后再透传, 避免列表对象被当作布局引擎名参与解析
        layout = _unwrap_single(layout)
        return describe_resolved_tools(layout if layout else "dot", flag__verbose=False)

    @classmethod
    def execute(cls, code, engine, format, layout, extra_args, **kwargs) -> io.NodeOutput:
        # is_input_list 模式: 所有输入均以列表形态到达, widget 输入解包为标量后使用
        # (到达形态详见 _unwrap_single / _normalize_code_segments 的文档)
        engine = _unwrap_single(engine)
        format = _unwrap_single(format)
        layout = _unwrap_single(layout)
        extra_args = _unwrap_single(extra_args)

        # code 归一化为字符串段列表; 过滤后空集 (空列表 / 全部项被忽略) 走 no-op:
        # 输出 0 张图与空 text 列表, 不报错
        list__segments = _normalize_code_segments(code)
        if not list__segments:
            LogUtils.print_log(
                "no valid code segments (empty list or nothing left after filtering), "
                "outputting zero images",
                _name__node=cls.__name__,
            )
            return io.NodeOutput([], [], ui=ui.SavedImages([]))

        # 逐段渲染并扁平化合并; auto 模式逐段独立识别引擎, 各段可用不同引擎
        list__tensor = []
        list__text = []
        list__preview = []
        for string__segment in list__segments:
            engine_resolved = (
                detect_engine(string__segment) if engine == "auto" else engine
            )
            # 渲染产物: png 列表始终非空 (单段 PlantUML 多 @start* 块时为多张);
            # svg 列表仅在 svg 模式且渲染成功时非空
            result = render_diagram(
                string__segment, engine_resolved, format, layout, extra_args
            )
            list__tensor.extend(
                _load_png_as_tensor(path__png) for path__png in result.list__path__png
            )
            # text 与 image 逐图对齐: svg 模式逐图输出源码 (降级的条目为空串),
            # png 模式全为空串
            if result.list__text__svg:
                list__text.extend(result.list__text__svg)
            else:
                list__text.extend([""] * len(result.list__path__png))
            # 预览优先使用 svg (矢量更清晰); svg 渲染失败时整组退回 png
            list__preview_names = (
                result.list__name__svg
                if result.list__name__svg
                else result.list__name__png
            )
            list__preview.extend(
                ui.SavedResult(name, "", io.FolderType.temp)
                for name in list__preview_names
            )

        LogUtils.print_log(
            f"rendered {len(list__segments)} code segment(s) as {format} "
            f"-> {len(list__tensor)} image(s)",
            _name__node=cls.__name__,
        )
        # is_output_list 输出: 返回元素列表, 每个元素为一张图 (tensor 形状 [1, H, W, 3])
        return io.NodeOutput(list__tensor, list__text, ui=ui.SavedImages(list__preview))
