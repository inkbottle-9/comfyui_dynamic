from comfy_api.latest import io

from ..core.utils import get_category
from ..core.utils import ByPassTypeTuple
from ..core.utils import InfiniteFalseList


# 动态管道节点 (V3)
class DynamicPipeAnyNode(io.ComfyNode):
    # 注意: 这里有意覆盖 V3 基类标记为 final 的 RETURN_TYPES / RETURN_NAMES.
    # 原因与 DynamicScriptNode 相同: prompt 校验阶段会用 RETURN_TYPES[输出端口序号] 取类型,
    # 而前端 JS 动态添加的输出端口 (output_0, output_1, ...) 不在 V3 schema 静态声明的 outputs 中,
    # 定长列表会在校验处直接 IndexError. ByPassTypeTuple 越界时返回 AnyType("*") 以绕过该校验.
    RETURN_TYPES = ByPassTypeTuple(("*",))
    RETURN_NAMES = ByPassTypeTuple(("pipe",))

    OUTPUT_IS_LIST = InfiniteFalseList()

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id=cls.__name__,  # 直接使用类名
            display_name="dynamic_pipe_any",
            category=get_category("utils"),
            description=(
                "This node works just like you'd expect. Here are the details: "
                "it builds a new list sized to your ports_count. "
                "Takes your pipe if you got one, pads with None or trims to fit, "
                "then replaces positions with any connected dynamic inputs (input_*) that aren't None. "
                "Outputs the full list as 'pipe', plus each item on its own through dynamic outputs (output_*)."
                "This is an output node."
            ),
            search_aliases=["pipe"],
            # 动态输入端口 (input_0, input_1, ...) 由前端 JS 管理, 不在 schema 中声明;
            # 打开此开关后, prompt 中未声明的输入会按原名作为 kwargs 传入 execute
            accept_all_inputs=True,
            inputs=[
                io.Int.Input(
                    "ports_count",
                    default=2,
                    min=0,
                    max=100,
                    step=1,
                    tooltip="The number of port-pair for this node.",
                    # socketless: 计数控件只允许作为纯控件存在, 禁止接线
                    # (旧版用 connection_blocking.js 拦截连接, V3 原生支持该特性)
                    socketless=True,
                ),
                io.AnyType.Input(
                    "pipe",
                    optional=True,
                    tooltip="The pipe in. Accept any Python list or tuple.",
                ),
            ],
            outputs=[
                io.AnyType.Output(
                    display_name="pipe",
                    tooltip="Essentially outputs a Python list.",
                ),
            ],
            is_output_node=True,
        )

    @classmethod
    def execute(
        cls,
        ports_count: int,
        **kwargs,
    ) -> io.NodeOutput:
        # 获取 pipe 输入, 如果没有指定, 则使用 None
        list__input = kwargs.get("pipe", None)
        if isinstance(list__input, tuple):
            list__input = list(list__input)
        if isinstance(list__input, list):
            length = len(list__input)
            if length < ports_count:
                # 填充 None 到 ports_count 个元素 (新建列表)
                list__input = list__input + [None] * (ports_count - length)
            elif length == ports_count:
                # 新建一个列表, 避免修改原列表
                list__input = list(list__input)
            else:
                # 取前 ports_count 个元素 (新建列表)
                list__input = list__input[:ports_count]
        else:
            # pipe 无效, 使用 None 初始化输入数组 (新建列表)
            list__input = [None] * ports_count
        # 用动态端口的输入覆盖输入数组
        for i in range(ports_count):
            input = kwargs.get(f"input_{i}", None)
            if input is not None:
                list__input[i] = input
        return io.NodeOutput(list__input, *list__input)
