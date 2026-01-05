
# comfyui_dynamic

[简体中文](./documents/README__zh_CN.md)


## 1. abstract

- Adds a full-featured (maybe not that full) Python script node to ComfyUI
- Plugin directory = `/comfyui_dynamic`
- **LICENSE** = `GNU Lesser General Public License v3.0`


## 2. introduce

**comfyui_dynamic has added the following nodes**

> **Attention !!!!!**
>
> - Always review the code inside `DynamicScriptNode` for security before running a workflow that contains it !!!
> - The code for this node can be passed from other nodes. Please be sure to pay attention to this !!!
> - Package import restrictions can enhance security to a certain extent, but code review is still necessary
> - If you are unsure about the security of the code, you can try having it checked by AI

- `DynamicScriptNode`
  - For dynamically executing Python code within a workflow
  - Can have any number of dynamically added input and output ports
  - Always exposes a fixed “exception” output (emits  None  when no error occurs, otherwise outputs the exception object)
    - The content can be viewed with the “Display Anything” node
  - Further details are available in ComfyUI’s built-in node-documentation page ("Node Info" in the menu)
  - Refreshing the node may result in code loss. Try to avoid directly editing the code in the text box of the node
    - You can use the multi-line string node or the text file reading node to input the code into this node
    - Using VS Code for editing and saving the complete code file on your hard drive is a good choice

  ![DynamicScriptNode](./documents/DynamicScriptNode.png)

- `DynamicLoadTextFileNode`
  - Read text files from disk via the provided path

  ![DynamicLoadTextFileNode](./documents/DynamicLoadTextFileNode.png)


## 3. install

- Clone this repository into ComfyUI's `custom_nodes` directory:

  ```shell
  cd ComfyUI/custom_nodes
  git clone https://github.com/inkbottle-9/comfyui_dynamic.git
  ```


## 4. dependencies

- zero-dependency


## 5. notes

- Does not currently support Node 2.0 (I don't know how to)
- The plugin may contain bugs; if you run into any issues, please report them on the Issues page
- Feature suggestions or requests for additional functionality are also welcome, feel free to open an issue

