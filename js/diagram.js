// diagram.js
// Dynamic Diagram Node 的设置项注册 (工具可执行文件路径)
//
// 说明:
// - 仅注册前端设置项, 后端 (core/diagram.py) 每次执行时实时读取 comfy.settings.json,
//   因此修改路径后无需重启, 下一次执行即生效
// - 路径约定的完整说明写在各设置项的 tooltip 中 (设置界面中名称右侧的悬浮按钮):
//   必须使用绝对路径, 允许指向文件或目录, 首尾引号会被自动剥离
// - 设置 ID 经 export 供 warning.js 的设置 ID 信息列表引用, 避免字面量重复维护
import { app } from "../../scripts/app.js";


// 设置项 ID (与 core/diagram.py 中的 SETTING_KEY__* 常量保持一致)
export const SETTING_ID__PATH_PLANTUML = "ComfyDynamic.Diagram.path__plantuml";
export const SETTING_ID__PATH_JAVA = "ComfyDynamic.Diagram.path__java";
export const SETTING_ID__PATH_MERMAID = "ComfyDynamic.Diagram.path__mermaid";
export const SETTING_ID__PATH_GRAPHVIZ = "ComfyDynamic.Diagram.path__graphviz";

// 路径公共约定 (各 tooltip 复用)
const TOOLTIP__PATH_RULES =
    "Use an absolute path (relative paths are rejected); " +
    "it may point to a file or a directory as described below; " +
    "surrounding quotes are stripped automatically (Windows 'Copy as path').";

app.registerExtension({
    name: "dynamic.diagram",

    settings: [
        {
            id: SETTING_ID__PATH_PLANTUML,
            name: "PlantUML path (PlantUML 路径)",
            type: "text",
            defaultValue: "",
            tooltip:
                "Path for PlantUML rendering. " + TOOLTIP__PATH_RULES + " " +
                "Accepts: " +
                "(1) a plantuml.jar file, invoked via java; " +
                "(2) a plantuml executable (exe/cmd/bat); " +
                "(3) a directory, where plantuml.jar is preferred and a plantuml executable is the fallback. " +
                "If the jar is configured but java is unavailable, an executable next to the jar is tried, " +
                "then 'plantuml' on PATH. " +
                "Leave empty to look up 'plantuml' on PATH. " +
                "Strict error reporting requires a fairly recent PlantUML version (-failfast2).",
            category: ["Comfy Dynamic", "Diagram", SETTING_ID__PATH_PLANTUML],
        },
        {
            id: SETTING_ID__PATH_JAVA,
            name: "Java path (Java 路径, 用于 plantuml.jar)",
            type: "text",
            defaultValue: "",
            tooltip:
                "Path to the java executable used to run plantuml.jar. " + TOOLTIP__PATH_RULES + " " +
                "For a directory, java is looked up inside it (the bin subdirectory is checked too). " +
                "Leave empty to look up 'java' on PATH. Only needed for the plantuml.jar mode.",
            category: ["Comfy Dynamic", "Diagram", SETTING_ID__PATH_JAVA],
        },
        {
            id: SETTING_ID__PATH_MERMAID,
            name: "Mermaid path (mermaid-cli 路径)",
            type: "text",
            defaultValue: "",
            tooltip:
                "Path to the mermaid-cli executable (mmdc, typically mmdc.cmd on Windows from npm). " +
                TOOLTIP__PATH_RULES + " " +
                "Leave empty to look up 'mmdc' on PATH. " +
                "Install with 'npm install -g @mermaid-js/mermaid-cli' if missing.",
            category: ["Comfy Dynamic", "Diagram", SETTING_ID__PATH_MERMAID],
        },
        {
            id: SETTING_ID__PATH_GRAPHVIZ,
            name: "Graphviz path (Graphviz 路径)",
            type: "text",
            defaultValue: "",
            tooltip:
                "Path to a Graphviz executable or a Graphviz directory. " + TOOLTIP__PATH_RULES + " " +
                "If a file is given: for a layout other than its own, the matching executable " +
                "(e.g. neato.exe next to dot.exe) is looked up first; if missing, the file itself is " +
                "used with '-K<layout>'. " +
                "If a directory is given: '<layout>(.exe)' is looked up inside it first, then 'dot(.exe)' " +
                "(the bin subdirectory is checked too). " +
                "When the configured path is invalid or empty, 'dot' on PATH is used as the last fallback.",
            category: ["Comfy Dynamic", "Diagram", SETTING_ID__PATH_GRAPHVIZ],
        },
    ],
});
