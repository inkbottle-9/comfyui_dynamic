# 动态脚本节点

**DynamicScriptNode**

- 可以运行任意 Python 脚本代码以实现更加复杂的功能
- 支持可自定义数量的输入输出端
  - 支持 [0, 100] 个输入, 支持 [0, 100] 个输出


## 警告

> **<span style=color:red;>注意 !!!!!</span>**
>
> - <span style=color:red;>执行包含本节点的工作流时请务必检查节点中代码的安全性 !!!</span>
> - <span style=color:red;>本节点的代码可以从其它节点中传入, 请务必注意 !!!</span>
> - <span style=color:red;>包导入限制可以一定程度上提升安全性, 但仍需代码检查</span>
> - <span style=color:red;>如果您无法确定代码的安全性, 可以尝试交给 AI 检查</span>

- 刷新节点可能会导致代码丢失, 尽量避免直接在节点的文本框中编辑代码
  - 可以使用多行字符串节点或文本文件读取节点输入代码至该节点
  - 使用 vs code 编辑并在您的硬盘上保存完整的代码文件是很好的选择


## 参数

**输入**

|           参数名           |            说明            |                                       注释                                       |
| :------------------------: | :------------------------: | :------------------------------------------------------------------------------: |
|     input_ports_count      | 定义节点的动态输入端的数量 |                      输入端的值会传入代码, 可以来自其它节点                      |
|     output_ports_count     | 定义节点的动态输出端的数量 |                    输出端从代码中获取值, 并可以传递到其它节点                    |
| remove_import_restrictions |   移除 python 包导入限制   | 若开启则可以在脚本中导入任意包, 这将导致脚本可以执行任何代码, 包括潜在的恶意代码 |
|            code            |   python 代码编辑 / 输入   |                          节点运行时将执行的 python 代码                          |


**输出**

|  参数名   |     说明     |                            注释                             |
| :-------: | :----------: | :---------------------------------------------------------: |
| exception | 异常信息输出 | 若脚本运行出现异常则返回包含异常信息的元组, 否则返回 `None` |

- 异常信息元组的结构为:

  ```python
  (                                # 异常信息元组
      type__exception,             # 异常的类型
      value__exception,            # 异常对象
      traceback__exception,        # 回溯对象 (堆栈对象)
      lines__traceback,            # 列表, 包含了异常的堆栈信息
      "".join(lines__traceback),   # 包含完整堆栈信息的单一字符串 (有换行)
  )
  ```


## 用法

- 该节点使用预先定义的 `inputs` 和 `outputs` 数组来访问节点的自定义输入输出

  ```python
  # 这行代码将第一个输入端赋值给第一个输出端
  outputs[0] = inputs[0]

  # 这行代码将第二个输入端赋值给第二个输出端
  outputs[1] = inputs[1]
  ```

- 可以导入一些基础的库

  - 示例代码

    ```python
    # 必须存在, 否则报错
    import math

    x = 25.0
    # 5.0
    print(math.sqrt(x))
    ```

  - 允许的包

    ```txt
    math,
    random,
    json,
    re,
    string,
    pathlib,
    os.path,
    collections,
    itertools,
    functools,
    datetime,
    numpy,
    torch,
    hashlib,
    base64,
    statistics,
    bisect,
    heapq,
    typing,
    inspect,
    decimal,
    fractions,
    PIL,
    Pillow,
    imageio,
    skimage,
    colorsys,
    dataclasses,
    uuid,
    csv,
    tomllib,
    html,
    ipaddress,
    textwrap,
    difflib,
    enum,
    numbers,
    scipy,
    cmath,
    ```

