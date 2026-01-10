import React, { useState } from 'react';
import {
    Download, Upload, Image as ImageIcon, Zap, Settings2,
    Palette, Sparkles, Wand2,
    ChevronDown, ChevronUp, Check, Layers,
    FileImage, Eraser, Microscope, Contrast, Aperture, Pipette, X,
    Bot, Undo2, Redo2, Wand, Info
} from 'lucide-react';
import { Slider } from './Slider';
import { TracerParams, PresetName, PaletteItem } from '../types';

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
    // History Props
    onUndo: () => void;
    onRedo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    // Palette
    palette: PaletteItem[];
    // API Key Props (已废弃，保留接口兼容但隐藏)
    apiKey: string;
    setApiKey: (key: string) => void;
}

const PRESETS: Record<PresetName, Partial<TracerParams> & { label: string, icon: any }> = {
    'default': { label: '默认设置 (Default)', icon: Sparkles, colors: 32, paths: 85, corners: 75, noise: 5, blur: 0, sampling: 2, colorMode: 'color', autoAntiAlias: true },
    'clipart': { label: '剪贴画/插图 (Clipart)', icon: Palette, colors: 16, paths: 80, corners: 60, noise: 5, blur: 0, sampling: 2, colorMode: 'color', autoAntiAlias: true },
    'photo': { label: '复杂照片 (Photo)', icon: ImageIcon, colors: 64, paths: 95, corners: 85, noise: 2, blur: 0, sampling: 2, colorMode: 'color', autoAntiAlias: false },
    'sketch': { label: '灰度素描 (Sketch)', icon: Wand2, colors: 8, paths: 60, corners: 40, noise: 20, blur: 1, sampling: 2, colorMode: 'grayscale', autoAntiAlias: true },
    'lineart': { label: '黑白线稿 (Line Art)', icon: Contrast, colors: 2, paths: 90, corners: 90, noise: 50, blur: 0, sampling: 4, colorMode: 'binary', autoAntiAlias: true },
    'poster': { label: '海报艺术 (Poster)', icon: Layers, colors: 6, paths: 70, corners: 70, noise: 10, blur: 1, sampling: 1, colorMode: 'color', autoAntiAlias: true },
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
    onUndo,
    onRedo,
    canUndo,
    canRedo,
    palette
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

    const renderPalette = () => {
        if (!palette || palette.length === 0) return null;

        // Sort logic already handled in mockVTracer, but ensure consistency
        // We display up to 32 colors visually to avoid clutter, though calculation might have more
        const displayPalette = palette.slice(0, 48);

        return (
            <div className="mt-4 bg-slate-900/40 rounded-lg p-3 border border-slate-800">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">检测到的色板 (Palette)</span>
                    <span className="text-[10px] text-slate-600 font-mono">{palette.length} Colors</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {displayPalette.map((p, idx) => {
                        // Calculate size based on ratio (dominance)
                        // Base size 12px, max additional 12px
                        // Use log scale so small percentages are still visible
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
                                {/* Tooltip */}
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-black/90 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 font-mono border border-white/10">
                                    {p.hex.toUpperCase()} <br />
                                    {(p.ratio * 100).toFixed(1)}%
                                </div>
                            </div>
                        );
                    })}
                </div>
                {params.colors > 48 && (
                    <div className="mt-2 text-[9px] text-center text-slate-600 italic">
                        ...及更多微小色块 (噪音)
                    </div>
                )}
            </div>
        );
    };

    const renderControls = () => (
        <div className="flex flex-col h-full">
            {/* Top: Preset Selector */}
            <div className="p-5 border-b border-slate-800 space-y-4 bg-slate-900/50">
                <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">预设场景 (Scene)</label>
                    {processing && <span className="text-[10px] text-purple-400 font-mono animate-pulse">PROCESSING...</span>}
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
                    className="w-full py-2.5 bg-gradient-to-r from-emerald-600/20 to-teal-600/20 hover:from-emerald-600/30 hover:to-teal-600/30 text-emerald-300 border border-emerald-500/30 rounded-xl flex items-center justify-center gap-2 text-xs font-semibold transition-all group relative overflow-hidden active:scale-[0.98]"
                >
                    <Wand className="w-4 h-4 group-hover:rotate-12 transition-transform" />
                    <span> 推荐设置 (Recommended)</span>
                    <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                </button>
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
                    {renderPalette()}
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

                    {/* Blur Filter (New) */}
                    <Slider
                        label="预模糊 (Pre-Blur)"
                        value={params.blur}
                        min={0} max={4} step={1}
                        onValueChange={(v) => updateParam('blur', v)}
                        className="py-1"
                        formatValue={(v) => v === 0 ? 'Off' : `${v}px`}
                    />
                    <p className="text-[10px] text-slate-500 -mt-2 mb-2 px-1">
                        * 增加模糊可减少锯齿和噪点
                    </p>

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