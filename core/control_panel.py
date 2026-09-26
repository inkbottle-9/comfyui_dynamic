# core/control_panel.py
# 资源监控后端服务: 提供 CPU / RAM / VRAM / GPU 利用率与已加载模型列表的快照接口,
# 以及内存/显存清理动作 (由前端浮动面板通过 HTTP 端点触发).
#
# 设计要点:
# - 不提供任何 ComfyUI 节点, 纯 HTTP 服务, 前端浮动面板是唯一消费者.
# - 快照使用短 TTL 缓存, 避免多标签页高频轮询时重复计算.
# - 显存清理在队列空闲时立即执行, 执行中则置 flag 延迟到任务结束后清理
#   (与官方 POST /free 行为一致, 参考 server.py post_free / main.py 执行循环).
# - 对 ComfyUI 内部结构 (current_loaded_models / cached_patcher_init) 的访问
#   全部带降级保护, 内部实现变化时功能退化而不是报错.
from __future__ import annotations

import asyncio
import gc
import os
import platform
import subprocess
import threading
import time

import psutil

from aiohttp import web
from server import PromptServer

import comfy.model_management
import folder_paths


# ============================================================
# 常量
# ============================================================

API_PREFIX = "/comfyui_dynamic/monitor"

# 快照缓存有效期 (秒). 前端最高 10 Hz 轮询, 后端实际重算频率被限制到 5 Hz.
SNAPSHOT_TTL = 0.2


# ============================================================
# NVML (pynvml) 可选支持: 提供 GPU 利用率与温度, 检测不到时优雅降级
# ============================================================

try:
    import pynvml
except Exception:  # pragma: no cover - 依赖缺失或非 NVIDIA 环境
    pynvml = None

_nvml_lock = threading.Lock()
_nvml_handles: dict = {}  # cuda 设备索引 -> nvml handle
_nvml_failed = False  # 初始化失败后不再重试, 避免每次快照都付出初始化代价


def _get_nvml_handles() -> dict:
    """惰性初始化 NVML 并返回 cuda 设备句柄表, 失败时返回空表."""
    global _nvml_failed
    if pynvml is None or _nvml_failed:
        return {}
    with _nvml_lock:
        if not _nvml_handles:
            try:
                pynvml.nvmlInit()
                for i in range(pynvml.nvmlDeviceGetCount()):
                    _nvml_handles[i] = pynvml.nvmlDeviceGetHandleByIndex(i)
            except Exception:
                _nvml_failed = True
                return {}
    return _nvml_handles


def _nvml_query(device_index: int) -> tuple | None:
    """查询单个 cuda 设备的 (利用率%, 温度 C, nvml已用字节, nvml总量字节), 失败返回 None."""
    handle = _get_nvml_handles().get(device_index)
    if handle is None:
        return None
    try:
        util = pynvml.nvmlDeviceGetUtilizationRates(handle).gpu
        temp = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
        mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
        return (float(util), float(temp), int(mem.used), int(mem.total))
    except Exception:
        return None


def _start_cpu_temp_thread() -> None:
    """Windows 下启动温度后台轮询线程 (守护线程, 静默失败不影响主功能)."""
    if platform.system() != "Windows":
        return
    try:
        threading.Thread(
            target=_cpu_temp_cache_loop, daemon=True, name="dynmon-cpu-temp"
        ).start()
    except Exception:
        pass


# 模块加载时预热 cpu_percent: 该函数首次调用固定返回 0.0, 之后才返回真实区间占比
psutil.cpu_percent(interval=None)

# 启动 Windows 下的 CPU 温度后台轮询 (WMI 查询耗时秒级, 不能在快照路径中执行)
_start_cpu_temp_thread()


# ============================================================
# 模型加载/卸载时间跟踪: 通过快照间 uuid 集合差分检测卸载事件
# (覆盖所有卸载路径: 手动卸载 / 清理按钮 / CUI 自动 offload)
# ============================================================

# 已卸载记录上限 (仅保存在进程内, 重启后清空)
MAX_UNLOADED_RECORDS = 100

_model_track_lock = threading.Lock()
_known_models: dict[str, dict] = {}  # uuid -> 最近一次快照中的模型条目 (含 loaded_at)
_unloaded_models: list[dict] = []  # 新在前, 条目含 unloaded_at


def _update_model_tracking(models: list[dict]) -> None:
    """差分当前快照与上次快照: 首次出现记 loaded_at, 消失移入已卸载记录, 重现则移出."""
    now = time.time()
    with _model_track_lock:
        current: dict[str, dict] = {}
        for m in models:
            uuid = m["uuid"]
            known = _known_models.get(uuid)
            m["loaded_at"] = known["loaded_at"] if known else now
            current[uuid] = m

        for uuid, old in _known_models.items():
            if uuid not in current:
                _unloaded_models.insert(0, {**old, "unloaded_at": now})

        if current:
            alive_uuids = {m["uuid"] for m in _unloaded_models}
            alive_uuids -= set(current.keys())
            _unloaded_models[:] = [
                m for m in _unloaded_models if m["uuid"] in alive_uuids
            ]

        del _unloaded_models[MAX_UNLOADED_RECORDS:]
        _known_models.clear()
        _known_models.update(current)


def _patcher_uuid(patcher) -> str:
    """模型的稳定标识: 优先 clone_base_uuid (现代 CUI), 缺失时退回对象身份 id.

    快照枚举与按 uuid 查找两处消费方必须共用本函数, 保证回退策略一致,
    否则旧版 CUI (无 clone_base_uuid) 下两侧 uuid 永远对不上, 卸载/打开必然失败.
    注意: id 回退在对象回收后可能被新对象复用, 已卸载记录存在被同名新对象
    "复活" 的理论可能, 仅作为旧版兼容的降级路径.
    """
    uuid_val = getattr(patcher, "clone_base_uuid", None)
    if uuid_val:
        return str(uuid_val)
    return f"id-{id(patcher):x}"


# ============================================================
# 快照构建与缓存
# ============================================================

_snapshot_lock = threading.Lock()
_snapshot_cache: dict | None = None
_snapshot_time = 0.0


def _safe_device_name(device) -> str:
    try:
        return comfy.model_management.get_torch_device_name(device)
    except Exception:
        return str(device)


def _build_devices() -> list[dict]:
    """枚举全部 torch 设备的显存信息, 主设备排在最前 (与官方 /system_stats 一致)."""
    mm = comfy.model_management
    primary = mm.get_torch_device()
    devices = list(mm.get_all_torch_devices())
    if primary in devices:
        devices = [primary] + [d for d in devices if d != primary]
    else:
        devices = [primary] + devices

    entries = []
    for d in devices:
        try:
            vram_total, torch_vram_total = mm.get_total_memory(d, torch_total_too=True)
            vram_free, torch_vram_free = mm.get_free_memory(d, torch_free_too=True)
        except Exception:
            continue

        vram_total = int(vram_total)
        vram_used = max(0, vram_total - int(vram_free))
        index = d.index if d.index is not None else 0

        gpu_util = temp = nvml_used = nvml_total = None
        if d.type == "cuda":
            info = _nvml_query(index)
            if info is not None:
                gpu_util, temp, nvml_used, nvml_total = info

        entries.append(
            {
                "name": _safe_device_name(d),
                "type": d.type,
                "index": index,
                "vram_total": vram_total,
                "vram_used": vram_used,
                "vram_percent": round(vram_used / vram_total * 100, 1)
                if vram_total > 0
                else 0.0,
                "torch_vram_total": int(torch_vram_total),
                "torch_vram_used": max(0, int(torch_vram_total) - int(torch_vram_free)),
                "gpu_util": gpu_util,
                "temperature": temp,
                "nvml_used": nvml_used,
                "nvml_total": nvml_total,
            }
        )
    return entries


def _extract_model_path(patcher) -> str | None:
    """从 patcher 的 cached_patcher_init 重载工厂参数中提取模型文件路径.

    该属性由核心加载器挂载, 各加载器的参数位置不同:
    - checkpoint: (load_checkpoint_guess_config, (ckpt_path, ...), index)
    - diffusion:  (load_diffusion_model, (unet_path, ...))
    - clip:       (load_clip_model_patcher, (ckpt_paths_list, ...))
    统一策略: 取参数元组首个 str 元素; 找不到 (第三方加载器/附加模型) 返回 None.
    """
    factory = getattr(patcher, "cached_patcher_init", None)
    if not factory or len(factory) < 2:
        return None
    try:
        args = factory[1]
        if not args:
            return None
        first = args[0]
        if isinstance(first, (list, tuple)):
            first = next((x for x in first if isinstance(x, str)), None)
        if isinstance(first, str) and first:
            return os.path.abspath(first)
    except Exception:
        pass
    return None


def _scan_model_residency(inner) -> tuple[int, str | None]:
    """扫描内部 torch 模块的参数/缓冲设备, 返回 (GPU 驻留字节数, 按字节数占比最大的设备串).

    这是权重真实位置的 ground truth, 用于纠正 ComfyUI 记账 (model_loaded_weight_memory)
    可能存在的过期状态 (如 CLIP 权重已被卸载到内存但计数器未清零).
    """
    if inner is None:
        return 0, None
    dev_bytes: dict[str, int] = {}
    try:
        items = list(inner.parameters()) + list(inner.buffers())
    except Exception:
        return 0, None
    for p in items:
        try:
            if p is None or getattr(p, "device", None) is None:
                continue
            nbytes = int(p.numel()) * int(p.element_size())
            key = str(p.device)
            dev_bytes[key] = dev_bytes.get(key, 0) + nbytes
        except Exception:
            continue
    if not dev_bytes:
        return 0, None
    main_dev = max(dev_bytes.items(), key=lambda kv: kv[1])[0]
    gpu_bytes = sum(
        v for k, v in dev_bytes.items() if k.split(":")[0] not in ("cpu", "meta")
    )
    return gpu_bytes, main_dev


def _device_type(dev) -> str | None:
    """提取 torch 设备类型字符串 (cuda/cpu/mps/xpu...), 容错各种设备表示."""
    try:
        return str(getattr(dev, "type", dev)).split(":")[0]
    except Exception:
        return None


def _vram_resident_bytes(patcher, inner) -> tuple[int, str | None]:
    """判定模型在显存中的真实驻留字节数, 返回 (vram_bytes, display_device).

    语义约定 (关键):
    - CUI 记账值 loaded_size() 表示 "驻留在 load_device 上的权重字节数";
      load_device 为 GPU 时即显存占用; load_device 为 CPU 时表示权重驻留内存,
      此时记账值可能等于 model_size (全部 "加载" 到了内存), 与显存无关.
    - 判定顺序: 记账为主判据, 参数设备扫描 (_scan_model_residency) 仅作兜底,
      用于纠正记账过期 (声称在 GPU 而参数实际全在 CPU) 与展示设备.
    - 动态加载模型 (aimdo/vbar) 的权重不由 nn.Parameter 持有, 扫描不可用,
      记账值 (含 vbar 统计) 即真相.
    """
    loaded = int(patcher.loaded_size())
    device_str = str(patcher.current_loaded_device())

    dynamic = False
    try:
        dynamic = bool(patcher.is_dynamic())
    except Exception:
        dynamic = False
    if dynamic:
        return loaded, device_str

    gpu_bytes, main_dev = _scan_model_residency(inner)
    if main_dev is not None:
        device_str = main_dev

    load_dev = getattr(patcher, "load_device", None)
    if load_dev is not None and _device_type(load_dev) == "cpu":
        # load_device 为 CPU: 记账表示内存驻留, 显存驻留只可能来自扫描
        # (如 hook 权重被拉到 GPU 的少数场景), 常规情况为 0
        return gpu_bytes, device_str

    # load_device 为 GPU: 记账即显存驻留; 仅当记账声称 > 0 而参数实际
    # 全部不在 GPU 时 (记账过期), 用扫描结果纠正为 0
    if loaded > 0 and gpu_bytes <= 0:
        loaded = 0
    return loaded, device_str


def _collect_loaded_models() -> list[dict]:
    """枚举当前已加载模型, 数据源为 model_management.current_loaded_models.

    位置 (location) 三态 (基于 _vram_resident_bytes 的显存驻留语义):
    - vram:    全部权重驻留显存
    - partial: 部分驻留显存 (低显存/动态 offload, 权重分散在两侧)
    - ram:     无权重驻留显存 (load_device 为 CPU, 或已完全 offload)
    """
    mm = comfy.model_management
    loaded_list = getattr(mm, "current_loaded_models", None)
    if not loaded_list:
        return []

    # "使用中" 判定: CUI 的 currently_used 标志在任务结束后不会主动复位,
    # 需与队列状态联判, 空闲时一律视为空闲 (否则 CPU 模式模型会永远显示使用中)
    busy_now = _is_busy()
    entries = []
    for lm in loaded_list:
        try:
            patcher = getattr(lm, "model", None)  # 弱引用解包, 模型被回收时为 None
            if patcher is None:
                # 弱引用已失效: 该条目实际已不持有模型, 必须跳过, 否则会出现
                # "已卸载但仍显示使用中且无法移入已卸载列表" 的幽灵条目
                continue

            inner = getattr(patcher, "model", None)
            class_name = inner.__class__.__name__ if inner is not None else "unknown"

            size = int(patcher.model_size())
            loaded, device_str = _vram_resident_bytes(patcher, inner)

            if loaded <= 0:
                location = "ram"
            elif loaded >= size:
                location = "vram"
            else:
                location = "partial"

            try:
                dtype = patcher.model_dtype()
                dtype_str = (
                    str(dtype).replace("torch.", "") if dtype is not None else "unknown"
                )
            except Exception:
                dtype_str = "unknown"

            path = _extract_model_path(patcher)
            entries.append(
                {
                    "uuid": _patcher_uuid(patcher),
                    "class": class_name,
                    "dtype": dtype_str,
                    "size": size,
                    "loaded": loaded,
                    "device": device_str,
                    "location": location,
                    "used": bool(getattr(lm, "currently_used", False)) and busy_now,
                    "path": path,
                    "filename": os.path.basename(path) if path else None,
                }
            )
        except Exception:
            continue
    return entries


def _is_busy() -> bool:
    """队列中是否有正在执行或排队等待的任务. 判定失败时按忙处理 (宁可保守)."""
    try:
        running, queued = (
            PromptServer.instance.prompt_queue.get_current_queue_volatile()
        )
        return len(running) > 0 or len(queued) > 0
    except Exception:
        return True


def _cpu_temperature() -> float | None:
    """CPU 温度 (摄氏度), 多级退化获取:

    1. psutil sensors (Linux / macOS 常见, Windows 通常返回空);
    2. LibreHardwareMonitor 的 WMI 命名空间 (需前台运行 LHM, 部分 ComfyUI 便携包自带);
    3. OpenHardwareMonitor 的 WMI 命名空间 (同上, 旧版工具);
    4. ACPI 热区温度 (root/wmi MSAcpi_ThermalZoneTemperature, Windows 内置可用,
        但反映的是主板热区而非 CPU 核心温度, 精度有限, 仅兜底).

    WMI 查询通过 PowerShell 子进程, 耗时秒级, 因此 Windows 下的查询在后台线程
    中周期执行并缓存结果, 快照构建只读缓存, 不阻塞.
    """
    if platform.system() != "Windows":
        return _cpu_temp_psutil()

    # 直接返回后台线程维护的缓存值 (线程停止刷新时返回旧值, 避免跳变)
    return _cpu_temp_cache.get("value")


# psutil 传感器命中 CPU 的关键词 (chip 名称与传感器标签小写匹配;
# tctl/tdie 为 AMD CPU 的核心温度传感器惯用名)
_CPU_TEMP_SENSOR_KEYWORDS = ("cpu", "package", "core", "tctl", "tdie")


def _cpu_temp_psutil() -> float | None:
    """psutil 温度读取: 优先取名称/标签命中 CPU 关键词的传感器最大值,
    无命中时退回全部传感器最大值 (可能选中 nvme/主板热区等非 CPU 来源,
    精度有限, 仅兜底)."""
    try:
        temps = psutil.sensors_temperatures()
    except Exception:
        return None
    cpu_best = None
    any_best = None
    for chip, entries in (temps or {}).items():
        chip_l = str(chip).lower()
        for t in entries:
            try:
                if not t.current:
                    continue
                value = float(t.current)
                any_best = max(any_best or 0.0, value)
                label_l = f"{chip_l} {t.label or ''}".lower()
                if any(k in label_l for k in _CPU_TEMP_SENSOR_KEYWORDS):
                    cpu_best = max(cpu_best or 0.0, value)
            except Exception:
                continue
    return cpu_best if cpu_best is not None else any_best


# 后台温度缓存: {"value": float | None}
_cpu_temp_cache: dict = {"value": None}

# PowerShell 脚本: 依次尝试三级来源, 输出首个命中的温度值 (摄氏度, 单行数字)
# - SensorType=2 在 LHM/OHM 中表示 Temperature, 取名称含 CPU 的传感器最大值
# - MSAcpi_ThermalZoneTemperature 的 CurrentTemperature 单位为 0.1 开尔文
_POWERSHELL_TEMP_SCRIPT = r"""
$v = $null
foreach ($ns in @('root\LibreHardwareMonitor', 'root\OpenHardwareMonitor')) {
    if ($v) { break }
    try {
        $v = (Get-CimInstance -Namespace $ns -ClassName Sensor -Filter 'SensorType=2' |
              Where-Object { $_.Name -match 'CPU' } |
              Measure-Object -Property Value -Maximum).Maximum
    } catch { $v = $null }
}
if (-not $v) {
    try {
        $z = (Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature |
              Measure-Object -Property CurrentTemperature -Maximum).Maximum
        if ($z) { $v = ($z / 10.0) - 273.15 }
    } catch { $v = $null }
}
if ($v) { Write-Output $v }
"""


def _cpu_temp_windows_query() -> float | None:
    """执行一次 PowerShell 查询 (内部已按 LHM -> OHM -> ACPI 退化), 失败返回 None."""
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        proc = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                _POWERSHELL_TEMP_SCRIPT,
            ],
            capture_output=True,
            text=True,
            timeout=8,
            creationflags=creationflags,
        )
        out = (proc.stdout or "").strip()
        return float(out) if out else None
    except Exception:
        return None


def _cpu_temp_cache_loop() -> None:
    """后台线程: 每 2 s 刷新一次 CPU 温度缓存.

    连续失败 3 次后拉长间隔到 30 s (如未安装 LHM/OHM 且 ACPI 不可用的环境),
    避免高频空转拉起 PowerShell 进程.
    """
    fail_streak = 0
    while True:
        value = _cpu_temp_windows_query()
        if value is not None and value > 0:
            _cpu_temp_cache["value"] = round(value, 1)
            fail_streak = 0
        else:
            fail_streak += 1
        time.sleep(2.0 if fail_streak < 3 else 30.0)


def _build_snapshot() -> dict:
    """构建完整监控快照 (纯 JSON 可序列化数据)."""
    vm = psutil.virtual_memory()
    try:
        proc_rss = psutil.Process().memory_info().rss
    except Exception:
        proc_rss = None

    return {
        "time": time.time(),
        "busy": _is_busy(),
        "cpu": {
            "percent": psutil.cpu_percent(interval=None),
            "cores": psutil.cpu_count(logical=True),
            "temp": _cpu_temperature(),
        },
        "ram": {
            "total": int(vm.total),
            "used": int(vm.total - vm.available),
            "available": int(vm.available),
            "percent": float(vm.percent),
            "proc_rss": proc_rss,
        },
        "devices": _build_devices(),
        "models": _collect_loaded_models(),
    }


def get_snapshot() -> dict:
    """获取监控快照, TTL 内直接返回缓存 (多标签页共享)."""
    global _snapshot_cache, _snapshot_time
    now = time.monotonic()
    with _snapshot_lock:
        if _snapshot_cache is not None and (now - _snapshot_time) < SNAPSHOT_TTL:
            return _snapshot_cache
        snapshot = _build_snapshot()
        _update_model_tracking(snapshot["models"])
        with _model_track_lock:
            snapshot["unloaded_models"] = list(_unloaded_models)
        _snapshot_cache = snapshot
        _snapshot_time = now
        return snapshot


# ============================================================
# 清理动作
# ============================================================


def _primary_vram_used() -> int:
    """主 cuda 设备当前显存占用量 (model_management 口径), 用于清理前后对比."""
    mm = comfy.model_management
    try:
        device = mm.get_torch_device()
        vram_total, _ = mm.get_total_memory(device, torch_total_too=True)
        vram_free, _ = mm.get_free_memory(device, torch_free_too=True)
        return max(0, int(vram_total) - int(vram_free))
    except Exception:
        return 0


def _cleanup_vram() -> dict | None:
    """显存清理: 卸载全部模型 + GC + 清空 torch 缓存.

    HTTP 层的忙时预检与本函数的实际执行位于不同线程, 之间存在 TOCTOU 窗口
    (预检后任务可能恰好入队), 因此本函数入口再次复查队列状态: 忙时返回 None,
    调用方据此按 "已排队" 语义响应, 与官方 /free 的延迟清理行为对齐.
    """
    if _is_busy():
        return None
    mm = comfy.model_management
    before = _primary_vram_used()
    try:
        mm.unload_all_models()
    except Exception:
        pass
    gc.collect()
    try:
        mm.soft_empty_cache(force=True)
    except Exception:
        pass
    time.sleep(0.2)  # 等待驱动/统计更新
    return {"freed": max(0, before - _primary_vram_used())}


# Win32 常量: 当前进程伪句柄, EmptyWorkingSet 所需全访问权限, 以及
# SetSystemFileCacheSize 的 flush 哨兵值 (SIZE_MAX, 恰与伪句柄同为 -1 但语义无关)
_WIN_CURRENT_PROCESS = -1
_WIN_PROCESS_ALL_ACCESS = 0x001F0FFF
_WIN_CACHE_FLUSH_SENTINEL = -1  # 传入 SIZE_MAX 表示清空全部系统文件缓存


def _win_trim_own_working_set() -> None:
    """修剪自身进程工作集, 将可换页内存交还给系统 (安全, 不影响其它进程)."""
    import ctypes

    try:
        ctypes.windll.kernel32.SetProcessWorkingSetSize(
            ctypes.c_void_p(_WIN_CURRENT_PROCESS),
            ctypes.c_size_t(_WIN_CURRENT_PROCESS),
            ctypes.c_size_t(_WIN_CURRENT_PROCESS),
        )
    except Exception:
        pass


def _win_trim_system_file_cache() -> None:
    """修剪系统文件缓存 (Windows). 需要管理员权限时静默失败."""
    import ctypes

    try:
        ctypes.windll.kernel32.SetSystemFileCacheSize(
            ctypes.c_size_t(_WIN_CACHE_FLUSH_SENTINEL),
            ctypes.c_size_t(_WIN_CACHE_FLUSH_SENTINEL),
            ctypes.c_uint(0),
        )
    except Exception:
        pass


def _win_empty_all_working_sets() -> None:
    """修剪系统内全部进程的工作集 (激进模式, 默认关闭, 会影响其它正在运行的程序)."""
    import ctypes
    from ctypes import wintypes

    try:
        k32 = ctypes.windll.kernel32
        psapi = ctypes.windll.psapi
        for proc in psutil.process_iter(["pid"]):
            try:
                handle = k32.OpenProcess(
                    wintypes.DWORD(_WIN_PROCESS_ALL_ACCESS),
                    wintypes.BOOL(False),
                    wintypes.DWORD(proc.info["pid"]),
                )
                if handle:
                    psapi.EmptyWorkingSet(ctypes.c_void_p(handle))
                    k32.CloseHandle(ctypes.c_void_p(handle))
            except Exception:
                continue
    except Exception:
        pass


def _linux_trim_malloc() -> None:
    """Linux 下通过 malloc_trim 归还堆内存."""
    import ctypes

    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:
        pass


def _cleanup_ram(aggressive: bool) -> dict:
    """内存清理: GC + 文件缓存修剪 + 自身进程工作集修剪.

    aggressive=True 时额外修剪系统内其它进程 (用户显式勾选后才启用).
    重活在线程池中执行 (含短暂 sleep), 不阻塞 aiohttp 事件循环.
    """
    system = platform.system()
    before = psutil.virtual_memory().available

    gc.collect()
    if system == "Windows":
        _win_trim_system_file_cache()
        _win_trim_own_working_set()
        if aggressive:
            _win_empty_all_working_sets()
    elif system == "Linux":
        _linux_trim_malloc()

    time.sleep(0.3)  # 等待系统内存统计刷新
    freed = max(0, psutil.virtual_memory().available - before)
    return {"freed": freed, "aggressive": aggressive}


def _find_loaded_by_uuid(uuid_str: str):
    """按 clone_base_uuid 在当前已加载模型中查找, 返回 (LoadedModel, ModelPatcher).

    仅返回弱引用仍然存活的条目; 失效条目 (幽灵条目) 视为不存在.
    """
    for lm in getattr(comfy.model_management, "current_loaded_models", []):
        patcher = getattr(lm, "model", None)
        if patcher is None:
            continue  # 幽灵条目, 视为不存在
        if _patcher_uuid(patcher) == uuid_str:
            # 额外校验: 弱引用存活但内部 model 为 None 的半失效状态同样视为已卸载
            if getattr(patcher, "model", None) is None:
                continue
            return lm, patcher
    return None, None


def _count_ram_only_entries() -> int:
    """统计注册表中仍存活但显存驻留为 0 的条目数 (卸载链路无法处理的部分)."""
    count = 0
    for lm in getattr(comfy.model_management, "current_loaded_models", []):
        try:
            patcher = getattr(lm, "model", None)
            if patcher is None or getattr(patcher, "model", None) is None:
                continue
            if _vram_resident_bytes(patcher, getattr(patcher, "model", None))[0] <= 0:
                count += 1
        except Exception:
            continue
    return count


def _unload_by_uuid(uuid_str: str) -> dict:
    """卸载指定模型及其克隆, 并验证结果.

    忙时语义: HTTP 层预检 (409 fast-fail) 与本函数线程执行间存在 TOCTOU 窗口,
    竞态输掉 (任务在预检后入队) 时入口复查兜底, 如实上报 busy 而非在任务
    执行中强卸模型.

    CUI 的 unload_model_and_clones -> free_memory 只处理 device 匹配 GPU 的条目
    (get_all_torch_devices 不含 CPU), CPU load_device 模型 (如 CPU 模式文本编码器)
    会被静默跳过, 因此必须在调用后复核注册表与显存驻留, 杜绝假成功:
    - ok=True:               条目已从注册表移除 (真正卸载成功)
    - ok=False, busy:        队列转忙, 放弃本次卸载
    - ok=False, ram_only:    条目仍在且显存驻留为 0 (权重本就在内存, 卸载无意义,
                             内存将在节点缓存淘汰该对象时释放)
    - ok=False, not_found:   模型不存在 (可能已被卸载)
    - ok=False, still_resident: 卸载调用后仍有显存驻留 (异常情况)
    """
    if _is_busy():
        return {"ok": False, "reason": "busy"}

    mm = comfy.model_management
    _, patcher = _find_loaded_by_uuid(uuid_str)
    if patcher is None:
        return {"ok": False, "reason": "not_found"}

    inner = getattr(patcher, "model", None)
    try:
        vram_before = _vram_resident_bytes(patcher, inner)[0]
    except Exception:
        vram_before = 0

    try:
        # all_devices=True: 覆盖多 GPU 场景 (默认只处理主设备)
        mm.unload_model_and_clones(patcher, all_devices=True)
    except Exception as e:
        return {"ok": False, "reason": "error", "message": str(e)}

    gc.collect()
    try:
        mm.soft_empty_cache(force=True)
    except Exception:
        pass

    # 复核: 存活条目应已从注册表消失
    _, patcher2 = _find_loaded_by_uuid(uuid_str)
    if patcher2 is None:
        return {"ok": True, "freed": vram_before}

    # 条目仍在: 检查显存驻留, 区分 "本就在内存" 与 "卸载失败"
    try:
        vram_after = _vram_resident_bytes(patcher2, getattr(patcher2, "model", None))[0]
    except Exception:
        vram_after = vram_before
    if vram_after <= 0:
        return {"ok": False, "reason": "ram_only", "freed": 0}
    return {
        "ok": False,
        "reason": "still_resident",
        "freed": max(0, vram_before - vram_after),
    }


def _open_in_explorer(path: str) -> None:
    """在文件管理器中定位文件 (Windows explorer /select), 其它平台降级为打开目录."""
    system = platform.system()
    if system == "Windows":
        subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
    elif system == "Darwin":
        subprocess.Popen(["open", "-R", path])
    else:
        subprocess.Popen(["xdg-open", os.path.dirname(path) or "/"])


def _open_directory(path: str) -> None:
    """在文件管理器中打开目录 (直接进入, 不选中)."""
    system = platform.system()
    if system == "Windows":
        os.startfile(os.path.normpath(path))  # noqa: S606 - 仅接受后端登记过的目录
    elif system == "Darwin":
        subprocess.Popen(["open", os.path.normpath(path)])
    else:
        subprocess.Popen(["xdg-open", os.path.normpath(path)])


def _is_under_registered_folders(path: str) -> bool:
    """校验路径位于 folder_paths 登记的任意目录之下 (防止任意目录打开)."""
    try:
        target = os.path.normcase(os.path.abspath(path))
        for name in getattr(folder_paths, "folder_names_and_paths", {}):
            for root in folder_paths.get_folder_paths(name):
                root_norm = os.path.normcase(os.path.abspath(str(root)))
                if target == root_norm or target.startswith(root_norm + os.sep):
                    return True
    except Exception:
        pass
    return False


# ============================================================
# HTTP 路由
# ============================================================


def register_monitor_routes() -> None:
    """向 ComfyUI 服务器注册监控端点. PromptServer 未就绪时静默跳过."""
    server = getattr(PromptServer, "instance", None)
    if server is None:
        return
    routes = server.routes

    @routes.get(f"{API_PREFIX}/stats")
    async def monitor_stats(request):
        # 快照构建含逐 tensor 的参数扫描, 大模型场景可能耗时数十 ms 以上,
        # 放入线程池执行以免阻塞 aiohttp 事件循环 (与 free/unload 端点一致)
        try:
            return web.json_response(await asyncio.to_thread(get_snapshot))
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    @routes.post(f"{API_PREFIX}/free")
    async def monitor_free(request):
        try:
            body = await request.json()
        except Exception:
            body = {}
        target = body.get("target")

        if target == "vram":
            if _is_busy():
                # 队列忙: 置 flag, 由主循环在当前任务结束后统一清理 (与官方 /free 一致)
                try:
                    PromptServer.instance.prompt_queue.set_flag("unload_models", True)
                    PromptServer.instance.prompt_queue.set_flag("free_memory", True)
                    return web.json_response({"ok": True, "queued": True})
                except Exception as e:
                    return web.json_response({"ok": False, "error": str(e)}, status=500)
            result = await asyncio.to_thread(_cleanup_vram)
            if result is None:
                # 竞态输掉: 预检后任务入队, 与忙时路径同样转交队列延迟清理
                return web.json_response({"ok": True, "queued": True})
            # 卸载链路 (free_memory) 不处理 CPU load_device 模型, 如实上报跳过数量,
            # 前端据此提示 "n 个常驻内存的模型未受影响"
            skipped = await asyncio.to_thread(_count_ram_only_entries)
            return web.json_response(
                {"ok": True, "queued": False, "skipped": skipped, **result}
            )

        if target == "ram":
            result = await asyncio.to_thread(
                _cleanup_ram, bool(body.get("aggressive", False))
            )
            return web.json_response({"ok": True, "queued": False, **result})

        return web.json_response({"error": "unknown target"}, status=400)

    @routes.post(f"{API_PREFIX}/unload")
    async def monitor_unload(request):
        try:
            body = await request.json()
            uuid_str = str(body.get("uuid", ""))
        except Exception:
            return web.json_response({"error": "bad request"}, status=400)
        if not uuid_str:
            return web.json_response({"error": "missing uuid"}, status=400)

        _, patcher = _find_loaded_by_uuid(uuid_str)
        if patcher is None:
            return web.json_response({"ok": False, "reason": "not_found"}, status=404)
        if _is_busy():
            return web.json_response({"ok": False, "reason": "busy"}, status=409)

        try:
            result = await asyncio.to_thread(_unload_by_uuid, uuid_str)
        except Exception as e:
            return web.json_response(
                {"ok": False, "reason": "error", "message": str(e)}, status=500
            )
        # 结果驱动: ok=True 才代表真正卸载成功 (注册表已移除),
        # ram_only / still_resident 等失败原因原样透传给前端如实提示
        return web.json_response(result)

    @routes.post(f"{API_PREFIX}/open")
    async def monitor_open(request):
        try:
            body = await request.json()
            uuid_str = str(body.get("uuid", ""))
        except Exception:
            return web.json_response({"error": "bad request"}, status=400)

        path = None
        _, patcher = _find_loaded_by_uuid(uuid_str)
        if patcher is not None:
            path = _extract_model_path(patcher)
        else:
            # 已卸载记录兜底: 记录内保存的模型路径支持直接定位 (文件可能仍在磁盘)
            with _model_track_lock:
                path = next(
                    (rec.get("path") for rec in _unloaded_models
                     if rec.get("uuid") == uuid_str),
                    None,
                )
            if path is None:
                return web.json_response({"error": "model not found"}, status=404)
        if not path:
            return web.json_response(
                {"error": "no path info for this model"}, status=400
            )
        if not os.path.exists(path):
            return web.json_response({"error": "file not on disk"}, status=400)

        try:
            _open_in_explorer(path)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)
        return web.json_response({"ok": True, "path": path})

    @routes.post(f"{API_PREFIX}/unloaded/clear")
    async def monitor_unloaded_clear(request):
        """清空已卸载模型记录."""
        with _model_track_lock:
            _unloaded_models.clear()
        return web.json_response({"ok": True})

    @routes.get(f"{API_PREFIX}/folders")
    async def monitor_folders(request):
        """列出 folder_paths 登记的全部目录类别与实际路径 (供前端快捷下拉)."""
        try:
            entries = []
            for name in list(
                getattr(folder_paths, "folder_names_and_paths", {}).keys()
            ):
                try:
                    paths = folder_paths.get_folder_paths(name)
                except Exception:
                    paths = []
                entries.append(
                    {
                        "name": name,
                        "paths": [str(p) for p in paths if p],
                    }
                )
            return web.json_response({"folders": entries})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    @routes.post(f"{API_PREFIX}/folders/open")
    async def monitor_folders_open(request):
        """打开一个登记目录 (仅允许位于 folder_paths 登记目录之下的路径)."""
        try:
            body = await request.json()
            path = str(body.get("path", ""))
        except Exception:
            return web.json_response({"error": "bad request"}, status=400)
        if not path:
            return web.json_response({"error": "missing path"}, status=400)
        if not _is_under_registered_folders(path):
            return web.json_response({"error": "path not registered"}, status=403)
        if not os.path.isdir(path):
            return web.json_response({"error": "directory not found"}, status=404)
        try:
            _open_directory(path)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)
        return web.json_response({"ok": True, "path": path})
