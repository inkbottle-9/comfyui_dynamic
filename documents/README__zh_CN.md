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
- 插件目录 = `/comfyui_dynamic`
- **LICENSE** = `GNU Lesser General Public License v3.0`


## 2. 介绍

**comfyui_dynamic 添加了如下节点**

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

- 无依赖


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


## 6. 注释

- 已迁移到新的 ComfyUI API, 现在支持 Node 2.0
- 插件可能会有错误, 使用过程中若发现问题请务必于议题 (issue) 页提交相关信息
  - 真的非常需要您的反馈
- 如对功能实现有任何建议, 或者需要其它的功能, 请随意发表议题 (issue)
