# comfyui_dynamic

![banner](../icon/logo__comfy_dynamic__banner.png)

[英文](../README.md)


## 1. 摘要

- 为 ComfyUI 添加如下节点:
  - python 脚本节点 (DynamicScriptNode)
  - 文件读取节点 (DynamicLoadTextFileNode)
  - 动态管道节点 (DynamicPipeAnyNode)
  - 动态切换节点 (DynamicSwitchAnyNode)
  - 随机数节点 (DynamicRandomNumberNode)
  - None 节点 (DynamicNoneNode)
  - 通用选择器节点 (DynamicUniversalSelector)
- 附带资源监控控制面板 (无需节点, 页面加载后自动出现, 详见下文)
- 插件目录 = `/comfyui_dynamic`
- **LICENSE** = `GNU Lesser General Public License v3.0`


## 2. 介绍

**comfyui_dynamic 添加了如下节点/功能**

- **控制面板 (资源监控)**
  - 浏览器内的资源监控与管理浮动面板, 无需任何节点即可使用 (页面加载后自动出现)
  - 资源监控
    - 统计卡片: CPU / RAM / GPU / VRAM 利用率与 CPU / GPU 温度 (温度满量程 = 100 C)
    - 折线图: 上述六个系列的近期历史 (保留 180 个采样点, 窗口时长取决于刷新率),
      利用率映射到 0-100%, 温度映射到 20-100 C 窗口以提高可读性
    - 占用超过 50% 后卡片背景与描边渐变为红色
  - 告警: 任一温度超过 90 C / 显存告急 (剩余不足 max(2%, 512 MB)) / 内存剩余不足 10% / 后端断连
    - 标题栏图标常态为仪表盘, 出现警告时变为红色三角; 后端断连时副标题显示断连提示
  - 模型管理
    - 已加载模型列表: 显示路径 / 体积 / 精度 / 设备 / 状态 (使用中或空闲) 等完整信息
      - 行按钮: 复制完整信息 / 在文件管理器中定位文件 / 从内存显存中卸载 (任务执行中不可用)
      - 绿色边框表示正在使用, 底部横条显示模型体积与主 GPU 显存的比例
        (红色 = 已加载进显存, 蓝色 = 仍在内存的部分)
    - 已卸载模型列表: 页面打开后被释放的模型记录 (最新在前, 仅供参考),
      可删除单条记录或全部清空
    - 清理显存: 有任务执行中时自动延迟到任务结束后执行; 常驻内存的模型不受影响
    - 清理内存: 始终立即生效, 即使任务执行中; 可选 "全进程" 模式,
      同时修剪其它进程的工作集 (Windows, 可能影响其它正在运行的程序)
  - 面板交互
    - 按住标题栏拖动; 停靠/取消停靠 (左下角, 退出停靠恢复之前的浮动位置);
      最小化/展开 (可双击标题栏); 垂直最大化 (高度撑满页面); 重置 (默认尺寸 + 停靠)
    - 打开大面积弹窗 (设置/模板等对话框) 时自动最小化, 关闭后自动还原
    - 不透明度可调 (30-100%); 支持点击穿透 (面板忽略鼠标, 仅切换按钮可交互)
    - 可暂停刷新; 界面支持中英双语
    - 快速链接与本地目录: 提供常用站点快捷入口, 可直接打开 ComfyUI 登记的模型目录
    - 所有设置项持久化到 ComfyUI 设置 (无 API 时回退 localStorage)
  - 环境要求
    - GPU 监控 (利用率/显存/温度) 仅支持 NVIDIA 显卡 (通过 NVML)
    - Windows 下 CPU 温度需要运行 LibreHardwareMonitor 或 OpenHardwareMonitor 才能获取,
      缺失时退化为 ACPI 热区温度 (反映主板热区而非 CPU 核心, 精度有限), 均不可用时无数据
    - Linux / macOS 下 CPU 温度通过 psutil 传感器读取 (视硬件而定)

  ![控制面板](./sample__control_panel.png)

- `DynamicScriptNode`

  > **注意 !!!!!**
  >
  > - 执行包含 `DynamicScriptNode` 的工作流时请务必检查节点中代码的安全性 !!!
  > - 该节点的代码可以从其它节点中传入, 请务必注意 !!!
  > - 包导入限制可以一定程度上提升安全性, 但仍需代码检查
  > - 如果您无法确定代码的安全性, 可以尝试交给 AI 检查

  - 用于在工作流中动态执行 python 代码
    - 可以设置数量不定的输入端和输出端
    - 具有固定的异常信息输出端 (无异常时输出 None, 否则输出异常对象)
      - 可以使用 "预览任意" (PreviewAny) 等节点显示内容
    - 执行环境基本与 ComfyUI 环境等效, 可以创建节点并执行, 清理显存或执行其它任何操作
    - 默认状态只能使用一些常用的 python 模块
      - 解除包导入限制后可以使用任意模块, 节点会呈现红色
  - ComfyUI 的某些版本中刷新节点可能会导致代码丢失
    - 尽量避免直接在节点的文本框中编辑代码
    - 可以使用多行字符串节点或文本文件读取节点输入代码至该节点
    - 使用 vs code 编辑并在您的硬盘上保存完整的代码文件是很好的选择
  - 现在支持自定义模块导入
    - 通过新的 "module_name_prefix" 和 "module_count" 端口
    - module_name_prefix: 用于定义模块名
    - module_count: 声明动态输入的前多少项作为自定义模块代码 (0 表示禁用)
  - 现在支持跨执行共享缓存
    - 脚本环境中注入了名为 `cache` 的全局单例字典, 代码中可以访问
    - 所有 `DynamicScriptNode` 实例共享, 可以把计算开销巨大的值存入其中
    - 该字典的增删改查完全由您的代码负责
    - 该缓存字典仅存在于内存中, ComfyUI 服务重启后清空
    - 注意: 使用 `cache` 时脚本不再是纯函数, 此时一般不开启 `lazy_execution`, 容易造成错误

    ```python
    # 示例: 将计算开销巨大的值存入缓存
    if "heavy_value" not in cache:
        cache["heavy_value"] = expensive_computation(inputs[0])
    outputs[0] = cache["heavy_value"]
    # ...
    del cache["heavy_value"]  # 移除存储的值
    ```

  - 其它属性
    - `is_output_node` = True

  - 更多详细信息可在 ComfyUI 内置的节点文档页面找到 (菜单里的 "节点信息" "Node Info")

  ![DynamicScriptNode](./DynamicScriptNode__module_import.png)


- `DynamicLoadTextFileNode`
  - 通过提供的路径读取硬盘上的文本文件
  - 支持选择文件编码格式, 内置了所有可用的文本编码列表
  - 具有异常信息输出端, 读取失败时输出异常对象而非直接报错中断工作流
  - 支持文件内容变化检测, 当文件被修改后节点会自动重新执行 (使用 MD5 校验)
  - 可搭配 `DynamicScriptNode` 使用, 将代码文件动态加载后传入脚本节点执行

  ![DynamicLoadTextFileNode](./DynamicLoadTextFileNode.png)


- `DynamicPipeAnyNode`
  - 动态管道节点, 用于将多个数据打包成一个列表 (pipe) 输出, 同时支持解包
  - 通过 `ports_count` 设置动态输入/输出端口的数量 (0 ~ 100)
  - 接受一个 `pipe` 输入 (可以是 Python 列表或元组):
    - 若 `pipe` 长度小于 `ports_count`, 会自动用 `None` 填充至指定长度
    - 若 `pipe` 长度大于 `ports_count`, 会自动截断至指定长度
    - 若 `pipe` 未连接或类型无效, 则初始化为全 `None` 列表
  - 动态输入端口 `input_0`, `input_1`, ... 会覆盖 `pipe` 中对应位置的值
  - 固定输出端口 `pipe` 输出完整的列表
  - 动态输出端口 `output_0`, `output_1`, ... 分别输出列表中的每个元素
  - 其它属性
    - `is_output_node` = True


- `DynamicSwitchAnyNode`
  - 切换/分支节点, 根据索引选择并返回对应的输入值
  - 通过 `cases_count` 设置动态输入端口的数量 (0 ~ 100)
  - 通过 `index` 指定要返回的输入索引, 对应动态输入端口 `case_0`, `case_1`, ...
  - 支持 **懒执行 (lazy execution)**: 仅执行被选中的 `case_N` 分支, 未选中的上游节点不会触发
  - 当 `index` 超出范围 (小于 0 或大于等于 `cases_count`) 时, 返回 `default` 值
  - `default` 输入为可选, 若未连接则默认视为 `None`
  - 所有输入端口均支持任意类型


- `DynamicRandomNumberNode`
  - 随机整数生成节点
  - 通过 `min` (包含) 和 `max` (不包含) 指定随机数范围
  - 每次执行都会生成新的随机值, 可用于工作流中需要变化种子的场景
  - 该节点每次执行都会刷新, 确保每次都能得到不同的随机数


- `DynamicNoneNode`
  - 空值节点, 始终返回 `None`
  - 接受一个任意类型的输入 `any`, 但该输入会被完全忽略
  - 可用于占位, 初始化或作为默认值传入其它节点

- `DynamicUniversalSelector`
  - 用于快速查询 ComfyUI 环境中的各种文件/选项名称
  - 可以按分类查询
  - 支持使用正则匹配
  - 会返回符合匹配模式的项目的列表
  - 当你需要获取某些模型文件的文本时会非常有用. 实用案例:
    - 工作流需要使用文本配置
    - 模型文件太多不便管理
    - 需要快速一览所有合法的采样器或调度器选项


## 3. 安装

- 将本仓库克隆到 ComfyUI 的 `custom_nodes` 目录:

  ```shell
  cd path_to_comfyui/ComfyUI/custom_nodes
  git clone https://github.com/inkbottle-9/comfyui_dynamic.git
  ```

- 版本要求: 本插件已迁移到 ComfyUI V3 节点规范, 需要较新版本的 ComfyUI
  - 大概需要 2025 年下半年之后的版本, 建议使用最新版
  - 旧版 ComfyUI 请使用本插件的历史版本, 最后一个使用旧 API 的版本:
    - `de7b4914835994f91b5bb1863a65e384c648c932`

      ```shell
      git checkout de7b4914835994f91b5bb1863a65e384c648c932
      git switch --detach de7b4914835994f91b5bb1863a65e384c648c932
      ```

## 4. 依赖

- 节点功能无依赖
- 控制面板 (资源监控) 需要以下 Python 包 (安装插件时由 ComfyUI 自动安装):
  - `psutil`: CPU / 内存统计 (ComfyUI 核心已依赖, 此处显式声明)
  - `pynvml`: GPU 利用率与温度 (可选, 缺失或非 NVIDIA 环境时自动降级,
    仅监控功能不可用, 不影响插件其余功能)


## 5. 设置

**本插件在 ComfyUI 设置界面注册了如下设置项:**

- `Warn when loading workflows with unrestricted import (加载含有解除包导入限制脚本节点的工作流时弹出安全警告)`
  - 开启时 (默认): 加载包含已解除包导入限制的 `DynamicScriptNode` 的工作流时,
    会弹出安全警告, 除非确认否则相关节点保持包导入限制
  - 关闭时: 加载工作流不再弹出该警告, 节点按工作流保存的状态原样加载 (风险自负)
- `Enable logging (启用日志)`
  - 开启时 (默认): 执行某些节点时会将信息输出到日志, 可在 ComfyUI 控制台查看
  - 关闭时: 不会输出日志
  - 修改后需重启软件生效
  - 建议开启, `DynamicScriptNode` 在执行遇到异常时会将其以可读的形式输出到日志
- `Dynamic Resource Monitor: Enabled (启用资源监控控制面板)`
  - 开启时 (默认): 页面加载后显示控制面板
  - 关闭时: 隐藏面板并停止数据轮询, 修改即时生效, 无需重启
- `Dynamic Resource Monitor: Refresh rate (Hz, 0 = paused) (数据刷新率)`
  - 控制面板取数频率 (0-10, 默认 2), 0 表示暂停刷新, 修改即时生效
- `Dynamic Resource Monitor: Language (控制面板界面语言)`
  - `en` (默认) / `zh`, 修改即时生效
- `Dynamic Resource Monitor: Panel opacity (30-100%) (面板不透明度)`
  - 默认 100%, 修改即时生效


## 6. 注释

- 已迁移到新的 ComfyUI API, 现在支持 Node 2.0
- 插件可能会有错误, 使用过程中若发现问题请务必于议题 (issue) 页提交相关信息
  - 真的非常需要您的反馈
- 如对功能实现有任何建议, 或者需要其它的功能, 请随意发表议题 (issue)
