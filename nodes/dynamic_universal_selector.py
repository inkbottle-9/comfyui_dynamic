import folder_paths
import comfy
import re
import threading
import random

from comfy_api.latest import io
from ..core.utils import get_category


class DynamicUniversalSelector(io.ComfyNode):
    """通用选择器, 用于快速获取各类模型文件/各种参数的路径/名称文本"""

    LIST__CATEGORIES: list[str] = []
    set__all_items: set[str] = set()  # 项目全集
    dict__items: dict[str, set[str]] = {}  # 按种类收纳所有项目
    _lock__data = threading.RLock()  # 可重入锁

    @classmethod
    def update_data(cls):
        """更新信息"""
        with cls._lock__data:
            cls.LIST__CATEGORIES.clear()
            cls.LIST__CATEGORIES.extend(["sampler", "scheduler"])
            cls.LIST__CATEGORIES.extend(folder_paths.folder_names_and_paths.keys())

            cls.set__all_items.clear()
            cls.dict__items.clear()

            try:
                cls.dict__items["sampler"] = set(comfy.samplers.KSampler.SAMPLERS)
                cls.dict__items["scheduler"] = set(comfy.samplers.KSampler.SCHEDULERS)
            except:
                pass

            # 遍历设置
            for category in sorted(cls.LIST__CATEGORIES):
                items = cls.dict__items.get(category, None)
                if not items:
                    items = folder_paths.get_filename_list(category)
                    cls.dict__items[category] = set(items)  # 加入字典
                if items:
                    cls.set__all_items.update(items)  # 加入全集

    @classmethod
    def define_schema(cls) -> io.Schema:
        # 初始化数据
        cls.update_data()

        return io.Schema(
            node_id=cls.__name__,  # 直接使用类名
            display_name="Dynamic Universal Selector",
            category=get_category("utils"),
            description=(
                "This node is used to quickly obtain some text, such as the model path, sampler name, etc."
            ),
            search_aliases=[
                "selector",
                "text",
                "path",
                "name",
                "parameter",
                "sampler",
                "scheduler",
            ],
            accept_all_inputs=False,
            hidden=[io.Hidden.unique_id, io.Hidden.prompt],
            inputs=[
                io.Combo.Input(
                    "category",
                    options=cls.LIST__CATEGORIES,
                    default=cls.LIST__CATEGORIES[0] if cls.LIST__CATEGORIES else "",
                    tooltip="All the types, select one to narrow the search scope (when 'search_all' not enabled).",
                ),
                io.String.Input(
                    "regex",
                    default="",
                    tooltip="Regex to match the items you are interested in. Empty to match everything.",
                ),
                io.Combo.Input(
                    "sort_mode",
                    options=["ascending", "descending", "shuffling", "disabled"],
                    default="ascending",
                    tooltip="Sorting order of items. You can use 'shuffling' to produce a random first item.",
                ),
                io.Boolean.Input(
                    "search_all",
                    default=False,
                    tooltip="Search across all categories of items, ignoring 'category'.",
                ),
                io.Boolean.Input(
                    "refresh",
                    default=False,
                    tooltip=(
                        "Update data before every execution. "
                        "Not recommended to enable unless there is an explicit need for refreshing."
                    ),
                ),
            ],
            outputs=[
                io.AnyType.Output(
                    display_name="first_matched",
                    tooltip=(
                        "Outputs the first string from the matching list."
                        "In certain scenarios, you can use strict-matching regex to ensure that the matched item is unique. "
                        "This output is essentially a string, but its type is deliberately set to *, "
                        "so you can connect it to any port that accepts COMBOl, e.g. the name port of a Checkpoint Loader"
                    ),
                ),
                io.AnyType.Output(
                    display_name="items_matched",
                    tooltip="Outputs a string list, you can link to 'PreviewAny' or some index node.",
                ),
                io.Int.Output(
                    display_name="matches_count",
                    tooltip="Length of the matching list.",
                ),
            ],
            is_output_node=True,
        )

    # 该函数应该接收和主函数相同的参数, 这里用 **kwargs 接收所有参数
    @classmethod
    def fingerprint_inputs(cls, sort_mode: str, **kwargs):
        if isinstance(sort_mode, str) and sort_mode.lower() == "shuffling":
            return float("NaN")
        else:
            return "lazy_execution"

    @classmethod
    def execute(
        cls,
        category: str | None,
        regex: str | None,
        sort_mode: str | None = "ascending",
        search_all: bool = False,
        refresh: bool | None = False,
        **kwargs,
    ) -> io.NodeOutput:
        """获取指定类别中的匹配项"""
        with cls._lock__data:
            flag__data_ready = cls.dict__items and cls.set__all_items
            if refresh or not flag__data_ready:
                cls.update_data()

            pattern = None
            if regex:
                try:
                    pattern = re.compile(regex)
                except re.error as e:
                    raise ValueError(
                        f"Illegal regular expression: regex={regex!r}, exception={e!r}"
                    )
            set__container = cls.set__all_items

            if not search_all:
                set__container = cls.dict__items.get(category, cls.set__all_items)
            if not isinstance(set__container, set):
                set__container = set(set__container)

            list__matched = None

            if pattern:
                list__matched = list(filter(pattern.search, set__container))
            else:
                list__matched = list(set__container)

        if sort_mode:
            if sort_mode.lower() == "ascending":  # 升序
                list__matched = sorted(list__matched)
            elif sort_mode.lower() == "descending":  # 降序
                list__matched = sorted(list__matched, reverse=True)
            elif sort_mode.lower() == "shuffling":  # 乱序
                random.shuffle(list__matched)

        return io.NodeOutput(
            list__matched[0] if list__matched else None,
            list__matched,
            len(list__matched),
        )
