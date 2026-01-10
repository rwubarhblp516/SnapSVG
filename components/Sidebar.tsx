import React, { useState } from 'react';
import {
    Download, Upload, Image as ImageIcon, Zap, Settings2,
    Palette, Sparkles, Wand2,
    ChevronDown, ChevronUp, Check, Layers,
    FileImage, Eraser, Microscope, Contrast, Aperture, Pipette, X,
    Bot, Undo2, Redo2, Wand, Info
} from 'lucide-react';
import { Slider } from './Slider';
import { TracerParams, PresetName, PaletteItem, ThreadStatus } from '../types';

interface SidebarProps {
    params: TracerParams;
    setParams: React.Dispatch<React.SetStateAction<TracerParams>>;
    onUploadClick: () => void;
    onDownloadSvg: () => void;
    onDownloadPng: () => void;
    processing: boolean;
    hasImage: boolean;
    isPickingColor: boolean;
    setIsPickingColor: (v: boolean) => void;
    onAiSplit: () => void;
    aiProcessing: boolean;
    detectedImageType?: string | null;
    threadStatus?: ThreadStatus;
    // History Props
    onUndo: () => void;
    onRedo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    // Palette
    palette: PaletteItem[];
    originalPalette?: PaletteItem[];
    // API Key Props (已废弃，保留接口兼容但隐藏)
    apiKey: string;
    setApiKey: (key: string) => void;
}

const PRESETS: Record<PresetName, Partial<TracerParams> & { label: string, icon: any }> = {
    // vtracer 参数映射说明:
    // colors (2-64) → layer_difference: 64色=4(不合并), 2色=64(强合并)
    // paths (0-100) → path_precision: 100%=8, 0%=1
    // corners (0-100) → corner_threshold: 100=180°(保留尖角), 0=0°(圆滑)
    // noise (0-100) → filter_speckle: 过滤小于该面积(px²)的路径

    'default': {
        label: '默认设置 (Default)',
        icon: Sparkles,
        colors: 32,      // layer_diff≈35, 适中合并
        paths: 80,       // precision=6
        corners: 55,     // threshold≈99°
        noise: 20,
        blur: 0,
        sampling: 2,
        colorMode: 'color',
        autoAntiAlias: true
    },
    'clipart': {
        label: '剪贴画/图标 (Clipart)',
        icon: Palette,
        colors: 20,      // layer_diff≈46, 合并成色块
        paths: 75,       // precision=6
        corners: 65,     // threshold≈117°, 保留尖角
        noise: 20,
        blur: 0,
        sampling: 2,
        colorMode: 'color',
        autoAntiAlias: true
    },
    'photo': {
        label: '复杂照片 (Photo)',
        icon: ImageIcon,
        colors: 64,      // layer_diff=4, 最小合并
        paths: 85,       // precision=7
        corners: 35,     // threshold≈63°, 圆滑渐变
        noise: 25,
        blur: 0,
        sampling: 1,
        colorMode: 'color',
        autoAntiAlias: false
    },
    'sketch': {
        label: '灰度素描 (Sketch)',
        icon: Wand2,
        colors: 6,       // layer_diff≈60, 简化为灰阶
        paths: 65,       // precision=5
        corners: 40,     // threshold≈72°
        noise: 20,
        blur: 0,
        sampling: 2,
        colorMode: 'grayscale',
        autoAntiAlias: true
    },
    'lineart': {
        label: '黑白线稿 (Line Art)',
        icon: Contrast,
        colors: 2,       // layer_diff=64, 纯黑白
        paths: 90,       // precision=7, 精确
        corners: 85,     // threshold≈153°, 保留尖角
        noise: 25,
        blur: 0,
        sampling: 4,
        colorMode: 'binary',
        autoAntiAlias: true
    },
    'poster': {
        label: '海报风格 (Poster)',
        icon: Layers,
        colors: 8,       // layer_diff≈58, 简化主色
        paths: 70,       // precision=6
        corners: 50,     // threshold=90°
        noise: 20,
        blur: 0,
        sampling: 2,
        colorMode: 'color',
        autoAntiAlias: true
    },
};

export const Sidebar: React.FC<SidebarProps> = ({
    params,
    setParams,
    onUploadClick,
    onDownloadSvg,
    onDownloadPng,
    processing,
    hasImage,
    isPickingColor,
    setIsPickingColor,
    onAiSplit,
    aiProcessing,
    detectedImageType,
    threadStatus,
    onUndo,
    onRedo,
    canUndo,
    canRedo,
    palette,
    originalPalette
}) => {
    const [selectedPreset, setSelectedPreset] = useState<PresetName>('default');
    const [showAdvanced, setShowAdvanced] = useState(false);

    const applyPreset = (key: PresetName) => {
        setSelectedPreset(key);
        const p = PRESETS[key];
        setParams(prev => ({
            ...prev,
            colors: p.colors ?? prev.colors,
            paths: p.paths ?? prev.paths,
            corners: p.corners ?? prev.corners,
            noise: p.noise ?? prev.noise,
            blur: p.blur ?? prev.blur,
            sampling: p.sampling ?? prev.sampling,
            colorMode: p.colorMode ?? prev.colorMode,
            autoAntiAlias: p.autoAntiAlias ?? prev.autoAntiAlias
        }));
    };

    const updateParam = (key: keyof TracerParams, value: any) => {
        setParams(prev => ({ ...prev, [key]: value }));
    };

    const clearBackgroundColor = (e: React.MouseEvent) => {
        e.stopPropagation();
        setParams(prev => ({ ...prev, backgroundColor: undefined }));
    };

    const getThreadStatusInfo = () => {
        if (!threadStatus || threadStatus.state === 'unknown') {
            return { text: 'WASM 线程：等待初始化', className: 'text-slate-500' };
        }
        if (threadStatus.state === 'enabled') {
            const count = threadStatus.threads && threadStatus.threads > 0 ? `${threadStatus.threads} 线程` : '已启用';
            return { text: `WASM 线程：${count}`, className: 'text-emerald-400' };
        }
        if (threadStatus.state === 'failed') {
            return { text: 'WASM 线程：初始化失败', className: 'text-amber-400' };
        }
        const reasonMap: Record<string, string> = {
            'no-init': '未启用线程构建',
            'not-isolated': '缺少 COOP/COEP',
            'single-thread': '仅 1 线程',
            'init-failed': '初始化失败'
        };
        const reason = threadStatus.reason ? reasonMap[threadStatus.reason] : '';
        const suffix = reason ? `（${reason}）` : '';
        return { text: `WASM 线程：未启用${suffix}`, className: 'text-slate-400' };
    };

    // --- Render Functions ---

    const renderEmptyState = () => (
        <div className="flex flex-col items-center justify-center h-full px-6 text-center space-y-6">
            <div className="relative group cursor-pointer" onClick={onUploadClick}>
                <div className="absolute -inset-1 bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl blur opacity-25 group-hover:opacity-75 transition duration-1000 group-hover:duration-200"></div>
                <div className="relative w-20 h-20 bg-slate-800 rounded-xl flex items-center justify-center border border-slate-700 group-hover:border-purple-500/50 transition-colors">
                    <Upload className="w-8 h-8 text-slate-400 group-hover:text-white transition-colors" />
                </div>
            </div>
            <div>
                <h3 className="text-lg font-semibold text-white mb-2">上传图片</h3>
                <p className="text-sm text-slate-400">支持 PNG, JPG, WebP <br /> 一键转换为 SVG 矢量图</p>
            </div>
            <button
                onClick={onUploadClick}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg border border-slate-700 font-medium text-sm transition-all"
            >
                选择文件
            </button>
        </div>
    );

    // Updated Prop Interface
    interface SidebarProps {
        params: TracerParams;
        setParams: (p: TracerParams) => void;
        onUploadClick: () => void;
        onDownloadSvg: () => void;
        onDownloadPng: () => void;
        processing: boolean;
        hasImage: boolean;
        isPickingColor: boolean;
        setIsPickingColor: (v: boolean) => void;
        onAiSplit: () => void;
        aiProcessing: boolean;
        detectedImageType?: string | null;
        threadStatus?: ThreadStatus;
        onUndo: () => void;
        onRedo: () => void;
        canUndo: boolean;
        canRedo: boolean;
        palette: PaletteItem[];
        originalPalette?: PaletteItem[]; // New Prop
        apiKey: string;
        setApiKey: (k: string) => void;
    }

    // ... (Inside Component)

    const renderPaletteSection = (pal: PaletteItem[] | undefined, title: string, showWarning = false) => {
        if (!pal || pal.length === 0) return null;

        const displayPalette = pal.slice(0, 48);

        return (
            <div className="mt-4 bg-slate-900/40 rounded-lg p-3 border border-slate-800">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">{title}</span>
                    <span className="text-[10px] text-slate-600 font-mono">{pal.length} Colors</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {displayPalette.map((p, idx) => {
                        const size = Math.max(12, Math.min(24, 12 + (Math.log10(p.ratio * 100 + 1) * 8)));
                        return (
                            <div
                                key={`${p.hex}-${idx}`}
                                className="rounded-full shadow-sm border border-white/10 relative group hover:z-10 hover:scale-125 transition-transform cursor-help"
                                style={{
                                    backgroundColor: p.hex,
                                    width: `${size}px`,
                                    height: `${size}px`
                                }}
                            >
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-black/90 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 font-mono border border-white/10">
                                    {p.hex.toUpperCase()} <br />
                                    {(p.ratio * 100).toFixed(1)}%
                                </div>
                            </div>
                        );
                    })}
                </div>
                {showWarning && params.colors > 48 && (
                    <div className="mt-2 text-[9px] text-center text-slate-600 italic">
                        ...及更多微小色块 (噪音)
                    </div>
                )}
            </div>
        );
    };

    const renderControls = () => {
        const threadStatusInfo = getThreadStatusInfo();
        return (
            <div className="flex flex-col h-full">
            {/* Top: Preset Selector */}
            <div className="p-5 border-b border-slate-800 space-y-4 bg-slate-900/50">
                <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">预设场景 (Scene)</label>
                    {processing && <span className="text-[10px] text-purple-400 font-mono animate-pulse">PROCESSING...</span>}
                </div>
                <div className={`text-[10px] font-mono ${threadStatusInfo.className}`}>
                    {threadStatusInfo.text}
                </div>

                <div className="relative">
                    <select
                        value={selectedPreset}
                        onChange={(e) => applyPreset(e.target.value as PresetName)}
                        className="w-full bg-slate-800 text-white text-sm px-4 py-3 rounded-xl border border-slate-700 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none appearance-none cursor-pointer hover:bg-slate-750 transition-colors shadow-sm"
                    >
                        {Object.entries(PRESETS).map(([key, val]) => (
                            <option key={key} value={key}>{val.label}</option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>

                {/* Undo / Redo Row */}
                <div className="flex gap-2">
                    <button
                        onClick={onUndo}
                        disabled={!canUndo}
                        className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 text-xs flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="撤销 (Ctrl+Z)"
                    >
                        <Undo2 className="w-3.5 h-3.5" />
                        撤销
                    </button>
                    <button
                        onClick={onRedo}
                        disabled={!canRedo}
                        className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 text-xs flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="重做 (Ctrl+Shift+Z)"
                    >
                        <Redo2 className="w-3.5 h-3.5" />
                        重做
                    </button>
                </div>

                {/* Smart Auto Tune Button */}
                <button
                    onClick={onAiSplit}
                    disabled={aiProcessing}
                    className="w-full py-2.5 bg-gradient-to-r from-emerald-600/20 to-teal-600/20 hover:from-emerald-600/30 hover:to-teal-600/30 text-emerald-300 border border-emerald-500/30 rounded-xl flex items-center justify-center gap-2 text-xs font-semibold transition-all group relative overflow-hidden active:scale-[0.98] disabled:opacity-50"
                >
                    <Wand className={`w-4 h-4 transition-transform ${aiProcessing ? 'animate-spin' : 'group-hover:rotate-12'}`} />
                    <span>{aiProcessing ? '分析中...' : '推荐设置 (Recommended)'}</span>
                    <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                </button>

                {/* Detection Result Banner */}
                {detectedImageType && (
                    <div className="bg-gradient-to-r from-emerald-900/30 to-teal-900/30 border border-emerald-500/20 rounded-lg px-3 py-2 text-center animate-pulse">
                        <span className="text-xs text-emerald-300">
                            ✓ 检测到: <strong>{detectedImageType}</strong>
                        </span>
                    </div>
                )}
            </div>

            {/* Scrollable Settings */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6">

                {/* Colors Slider & Palette (Main Group) */}
                <div className="space-y-4 rounded-xl bg-slate-800/20 p-4 border border-slate-800">
                    <Slider
                        label="色彩数量 (Colors)"
                        value={params.colors}
                        min={2} max={64} step={1}
                        onValueChange={(v) => updateParam('colors', v)}
                    />
                    <p className="text-[10px] text-slate-500 -mt-2 mb-2 px-1">
                        * 控制矢量图使用的颜色数量。越少=越简洁，越多=越精细
                    </p>
                    <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-900/50 p-2 border border-slate-800">
                        <div className="flex-1">
                            <div className="text-[11px] text-slate-200">色板映射 (Palette Lock)</div>
                            <div className="text-[10px] text-slate-500">
                                将颜色固定到原图色板，可能更稳定但饱和度会降低
                            </div>
                        </div>
                        <button
                            type="button"
                            aria-pressed={params.usePaletteMapping === true}
                            onClick={() => updateParam('usePaletteMapping', !params.usePaletteMapping)}
                            className={`inline-flex h-5 w-9 items-center rounded-full border transition-colors ${params.usePaletteMapping ? 'bg-emerald-500/70 border-emerald-400/40' : 'bg-slate-700 border-slate-600'}`}
                        >
                            <span
                                className={`ml-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${params.usePaletteMapping ? 'translate-x-4' : 'translate-x-0'}`}
                            />
                        </button>
                    </div>
                    {/* Original Source Palette */}
                    {renderPaletteSection(originalPalette, "原图色板 (Source)")}
                    {/* Vector Output Palette */}
                    {renderPaletteSection(palette, "检测到的色板 (Vector)", true)}
                </div>

                {/* Sampling (Upscale) Group */}
                <div className="space-y-3 rounded-xl bg-slate-800/20 p-4 border border-slate-800">
                    <label className="text-sm font-medium text-slate-200 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Microscope className="w-4 h-4 text-blue-400" />
                            <span>采样精度 (Upscale)</span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono">
                            {params.sampling === 1 ? '1x' : params.sampling === 2 ? '2x' : '4x'}
                        </span>
                    </label>

                    <div className="grid grid-cols-3 gap-2 bg-slate-900/50 p-1 rounded-xl border border-slate-800">
                        {[1, 2, 4].map(s => {
                            const isActive = params.sampling === s;
                            return (
                                <button
                                    key={s}
                                    onClick={() => { if (params.sampling !== s) updateParam('sampling', s); }}
                                    className={`
                                    relative py-2.5 text-xs rounded-lg font-medium transition-all duration-200 flex flex-col items-center gap-1
                                    ${isActive
                                            ? 'bg-slate-700 text-white shadow-sm ring-1 ring-slate-600'
                                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                                        }
                                `}
                                >
                                    <span>{s}x</span>
                                    <span className={`text-[9px] scale-90 ${isActive ? 'text-blue-400' : 'text-slate-600'}`}>
                                        {s === 1 ? '标准' : s === 2 ? '清晰' : '极佳'}
                                    </span>
                                    {isActive && <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.8)]"></span>}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Details Group (Cleaned up) */}
                <div className="bg-[#0f172a]/40 rounded-xl p-4 border border-slate-800/50 space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Zap className="w-4 h-4 text-purple-400" />
                        <span className="text-xs font-bold text-slate-300 tracking-wider">细节处理 (DETAILS)</span>
                    </div>


                    {/* Path Precision */}
                    <Slider
                        label="路径精度 (Paths)"
                        value={params.paths}
                        min={0} max={100} step={1}
                        onValueChange={(v) => updateParam('paths', v)}
                        className="py-1"
                        formatValue={(v) => `${v}%`}
                    />
                    <p className="text-[10px] text-slate-500 -mt-2 mb-2 px-1">
                        * 越高越贴合原图轮廓，越低线条越平滑
                    </p>

                    {/* Corner Threshold */}
                    <Slider
                        label="角点平滑 (Corners)"
                        value={params.corners}
                        min={0} max={100} step={1}
                        onValueChange={(v) => updateParam('corners', v)}
                        className="py-1"
                        formatValue={(v) => `${v}`}
                    />
                    <p className="text-[10px] text-slate-500 -mt-2 mb-2 px-1">
                        * 越高保留更多尖角，越低角点越圆润
                    </p>

                    {/* Noise Filter */}
                    <Slider
                        label="噪点过滤 (Noise)"
                        value={params.noise}
                        min={0} max={100} step={1}
                        onValueChange={(v) => updateParam('noise', v)}
                        className="py-1"
                        formatValue={(v) => `${v}px`}
                    />
                    <p className="text-[10px] text-slate-500 -mt-2 mb-2 px-1">
                        * 越高过滤斑点力度越强，可去除细小杂色
                    </p>
                    <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-900/50 p-2 border border-slate-800">
                        <div className="flex-1">
                            <div className="text-[11px] text-slate-200">边缘平滑 (Anti-Alias)</div>
                            <div className="text-[10px] text-slate-500">
                                轻微预平滑以减少锯齿，可能略微牺牲锐度
                            </div>
                        </div>
                        <button
                            type="button"
                            aria-pressed={params.autoAntiAlias === true}
                            onClick={() => updateParam('autoAntiAlias', !params.autoAntiAlias)}
                            className={`inline-flex h-5 w-9 items-center rounded-full border transition-colors ${params.autoAntiAlias ? 'bg-sky-500/70 border-sky-400/40' : 'bg-slate-700 border-slate-600'}`}
                        >
                            <span
                                className={`ml-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${params.autoAntiAlias ? 'translate-x-4' : 'translate-x-0'}`}
                            />
                        </button>
                    </div>
                </div>
            </div>

            {/* Footer Actions */}
            <div className="p-5 bg-slate-900 border-t border-slate-800 space-y-3 z-10">
                <button
                    onClick={onDownloadSvg}
                    className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white rounded-xl shadow-lg shadow-purple-900/20 font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
                >
                    <Download className="w-4 h-4" />
                    导出 SVG 矢量图
                </button>

                <div className="flex gap-2">
                    <button
                        onClick={onDownloadPng}
                        className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 text-xs flex items-center justify-center gap-2 transition-colors"
                    >
                        <FileImage className="w-3.5 h-3.5" />
                        存为 PNG
                    </button>
                    <button
                        onClick={onUploadClick}
                        className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 text-xs flex items-center justify-center gap-2 transition-colors"
                    >
                        <Upload className="w-3.5 h-3.5" />
                        换一张
                    </button>
                </div>
            </div>
        </div>
        );
    };

    return (
        <div className="w-80 h-full bg-slate-900 border-r border-slate-800 flex flex-col shrink-0 relative z-30">
            <div className="p-6 border-b border-slate-800 shrink-0 bg-slate-900 z-20">
                <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent flex items-center gap-2">
                    <Zap className="w-6 h-6 text-purple-400" />
                    SnapSVG
                </h1>
                <p className="text-xs text-slate-500 mt-1 font-mono tracking-tight">SVG TRACER & CONVERTER</p>
            </div>

            <div className="flex-1 overflow-hidden relative">
                {!hasImage ? renderEmptyState() : renderControls()}
            </div>
        </div>
    );
};
