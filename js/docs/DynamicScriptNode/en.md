# DynamicScriptNode

- Run any Python script code to achieve more complex functions
- Supports customizable input and output ports
  - Support [0, 100] inputs and [0, 100] outputs


## Warning

> **<span style=color:red;>Attention !!!!!</span>**
>
> - <span style=color:red;>Always review the code inside `DynamicScriptNode` for security before running a workflow that contains it !!!</span>
> - <span style=color:red;>The code for this node can be passed from other nodes. Please be sure to pay attention to this !!!</span>
> - <span style=color:red;>Package import restrictions can enhance security to a certain extent, but code review is still necessary</span>
> - <span style=color:red;>If you are unsure about the security of the code, you can try having it checked by AI</span>

- Refreshing the node may result in code loss. Try to avoid directly editing the code in the text box of the node
  - You can use the multi-line string node or the text file reading node to input the code into this node
  - Using VS Code for editing and saving the complete code file on your hard drive is a good choice


## Parameters

**Input**

|       Parameter name       |                      Description                      |                                                                           Notes                                                                            |
| :------------------------: | :---------------------------------------------------: | :--------------------------------------------------------------------------------------------------------------------------------------------------------: |
|     input_ports_count      | Define the number of dynamic input ports of the node  |                                The values at the input end will be passed into the code, and they can come from other nodes                                |
|     output_ports_count     | Define the number of dynamic output ports of the node |                                       The output port fetches values from the code and can be passed to other nodes                                        |
| remove_import_restrictions | Remove the import restrictions for the Python package | If enabled, it will allow the import of any package in the script, which will enable the script to execute any code, including potentially malicious code. |
|            code            |              Python code editing / input              |                                              The Python code that will be executed during the node's runtime                                               |


**Output**

| Parameter name |      Description      |                                                                  Notes                                                                   |
| :------------: | :-------------------: | :--------------------------------------------------------------------------------------------------------------------------------------: |
|   exception    | Exception info output | If the script encounters an exception during execution, it returns a tuple containing the exception details; otherwise it returns `None` |

- The structure of the exception information tuple is:

  ```python
  (                                # exception information tuple
      type__exception,             # type of exception
      value__exception,            # exception object
      traceback__exception,        # traceback object
      lines__traceback,            # list, contains exception traceback information
      "".join(lines__traceback),   # a single string containing the complete traceback (with line breaks)
  )
  ```


## Usage

- This node uses the pre-defined `inputs` and `outputs` arrays to access the custom inputs and outputs of the node

  ```python
  # This line of code assigns the value from the first input port to the first output port
  outputs[0] = inputs[0]

  # This line of code assigns the value from the second input port to the second output port
  outputs[1] = inputs[1]
  ```

- Some basic libraries can be imported

  - Sample code

    ```python
    # It must exist; otherwise an error will occur
    import math

    x = 25.0
    # 5.0
    print(math.sqrt(x))
    ```

  - Allowed package

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

