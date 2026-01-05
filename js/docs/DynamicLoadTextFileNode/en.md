# DynamicLoadTextFileNode

- Can read any text file from disk via the provided path
- Encoding can be selected (default is `utf_8`)
- Exceptions occurring during file reading can be captured via the exception output (if any)


## Parameters

**Input**

| Parameter Name |  Description  |       Notes        |
| :------------: | :-----------: | :----------------: |
|   file_path    |   File path   |                    |
|    encoding    | File encoding | Default is `utf_8` |

**Output**

| Parameter Name |         Description          |                                         Notes                                         |
| :------------: | :--------------------------: | :-----------------------------------------------------------------------------------: |
|    content     |        Content output        |          Returns file content (string) on successful read, otherwise `None`           |
|   exception    | Exception information output | Returns exception object if an exception occurs during file reading, otherwise `None` |

