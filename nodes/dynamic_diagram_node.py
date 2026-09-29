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
from ..core.utils import check_is_equivalent_empty
from ..core.utils import get_category


# 源码输入框的占位示例
PLACEHOLDER__CODE = "@startuml\nAlice -> Bob: Hello\n@enduml"


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
            inputs=[
                io.String.Input(
                    "code",
                    multiline=True,
                    default="",
                    placeholder=PLACEHOLDER__CODE,
                    tooltip=(
                        "Diagram source code. "
                        "With engine 'auto' the engine is detected from the code "
                        "(@start* -> plantuml, mermaid keywords -> mermaid, digraph/graph -> graphviz). "
                        "For PlantUML, do not use named @start blocks (e.g. '@startuml myname'): "
                        "their outputs are written under custom file names and get lost; "
                        "use a plain '@start*' instead."
                    ),
                ),
                io.Combo.Input(
                    "engine",
                    options=ENGINE_OPTIONS,
                    default="auto",
                    tooltip=(
                        "Which rendering engine to use. "
                        "'auto' detects the engine from the code with heuristics and defaults to mermaid "
                        "when nothing matches."
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
        # flag__verbose=False: 指纹计算发生在每次队列时, 退化警告不应重复刷屏
        return describe_resolved_tools(layout if layout else "dot", flag__verbose=False)

    @classmethod
    def execute(cls, code: str, engine: str, format: str, layout: str, **kwargs) -> io.NodeOutput:
        # 空代码提前报错: 否则 auto 模式会先误报 "引擎无法识别" 再报空代码错误, 日志产生误导
        if check_is_equivalent_empty(code):
            raise ValueError("Diagram code is empty.")
        # auto 模式下根据代码内容识别引擎
        engine_resolved = detect_engine(code) if engine == "auto" else engine

        # 渲染产物: png 列表始终非空; svg 列表仅在 svg 模式且渲染成功时非空
        result = render_diagram(code, engine_resolved, format, layout)
        list__tensor = [_load_png_as_tensor(path__png) for path__png in result.list__path__png]

        # text 与 image 逐图对齐: svg 模式逐图输出源码 (降级的条目为空串), png 模式全为空串
        if result.list__text__svg:
            list__text = list(result.list__text__svg)
        else:
            list__text = [""] * len(list__tensor)

        # 预览优先使用 svg (矢量更清晰); svg 渲染失败时整组退回 png
        list__preview_names = (
            result.list__name__svg if result.list__name__svg else result.list__name__png
        )
        list__preview = [
            ui.SavedResult(name, "", io.FolderType.temp) for name in list__preview_names
        ]

        LogUtils.print_log(
            f"rendered {engine_resolved} diagram(s) as {format} -> {len(list__tensor)} image(s)",
            _name__node=cls.__name__,
        )
        # is_output_list 输出: 返回元素列表, 每个元素为一张图 (tensor 形状 [1, H, W, 3])
        return io.NodeOutput(list__tensor, list__text, ui=ui.SavedImages(list__preview))
