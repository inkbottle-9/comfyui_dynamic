from comfy_api.latest import io

from ..core.utils import get_category
from ..core.utils import any_type
from ..core.utils import FlexibleOptionalInputTypeLazy
from ..core.utils import InfiniteFalseList


# 动态任意切换节点 (V3)
class DynamicSwitchAnyNode(io.ComfyNode):
    OUTPUT_IS_LIST = InfiniteFalseList()

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id=cls.__name__,  # 直接使用类名
            display_name="dynamic_switch_any",
            category=get_category("utils"),
            description=(
                "This node is used to switch between multiple cases by index. "
                "It accepts an index as input and returns the value of the case at that index, "
                "or returns the default value (specified or None) if out of range."
            ),
            search_aliases=["branch", "case", "select"],
            # 动态输入端口 (case_0, case_1, ...) 由前端 JS 管理, 不在 schema 中声明;
            # 打开此开关后, prompt 中未声明的输入会按原名作为 kwargs 传入 execute
            accept_all_inputs=True,
            inputs=[
                io.Int.Input(
                    "index",
                    default=0,
                    min=-1,
                    max=100,
                    step=1,
                    tooltip="The index of the case to return. Must be between 0 and cases_count - 1, else the default value will be returned.",
                ),
                io.Int.Input(
                    "cases_count",
                    default=2,
                    min=0,
                    max=100,
                    step=1,
                    tooltip="The number of cases for this node. Must be between 0 and 100.",
                    # socketless: 计数控件只允许作为纯控件存在, 禁止接线
                    # (若允许接线, 前端按固定偏移计算动态端口的逻辑会被破坏)
                    socketless=True,
                ),
                io.AnyType.Input(
                    "default",
                    optional=True,
                    lazy=True,
                    tooltip="The default value to return if no cases match. None if not specified.",
                ),
            ],
            outputs=[
                io.AnyType.Output(
                    display_name="result",
                    tooltip="The value of the case at the specified index.",
                ),
            ],
        )

    # 注意: 这里有意覆盖 V3 基类标记为 final 的 INPUT_TYPES.
    # 原因: 动态输入 case_N 无法在 schema 中静态声明, 也就无法携带 lazy 标记;
    # 而图编排阶段 (comfy_execution/graph.py) 会通过原始的 INPUT_TYPES() 查询 lazy 标记.
    # 用 FlexibleOptionalInputTypeLazy 包装 optional 字典后, 任意未声明的输入名都会被视为 lazy,
    # 从而保留旧版节点"只求值被选中的分支"的行为.
    # @final 只是类型标注, 运行时类方法查找会优先命中本子类的定义.
    @classmethod
    def INPUT_TYPES(cls):
        data = super().INPUT_TYPES()
        # 动态生成的输入会放在 optional 中
        data["optional"] = FlexibleOptionalInputTypeLazy(
            any_type,
            data.get("optional", {}),
            True,  # 开启懒求值
            "Dynamic inputs (case_0, case_1, ...).",
        )
        return data

    @classmethod
    def check_lazy_status(cls, index: int, cases_count: int, **kwargs):
        """
        kwargs 包含所有实际连接的输入, 检查是否需要确定指定的输入.
        该函数用于描述节点依赖哪些输入, 当依赖的输入有改动时,
        会再获取节点指纹判断是否真正需要执行, 还是直接使用缓存的值
        """
        needed = []

        # 计算应该选中的输入名
        target_input = f"case_{index}"

        # 如果这个输入在 kwargs 中, 就加入 needed 列表
        # 不检查时可能会报错, CUI 提示节点缺少目标输入
        if target_input in kwargs:
            needed.append(target_input)
        # 若目标值不存在, 且 default 输入存在, 则加入 needed 列表
        elif "default" in kwargs:
            # index 超出范围时, 需要执行 default 输入
            needed.append("default")

        # 其他输入不需要执行,不加入 needed 列表
        return needed

    @classmethod
    def execute(
        cls,
        index: int,
        cases_count: int,
        **kwargs,
    ) -> io.NodeOutput:
        """根据 index 返回对应的 case 输入, 如果 index 超出范围则返回 default"""
        # 从 kwargs 中获取 default 输入
        # 注意必须动态获取, 否则 CUI 认为该参数是必须的 (必须连接)
        default = kwargs.get("default", None)
        # 从 kwargs 中获取对应的 case 输入, 格式为 case_0, case_1, ...
        if index < 0 or index >= cases_count:
            return io.NodeOutput(default)
        result = kwargs.get(f"case_{index}", default)
        return io.NodeOutput(result)
