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
        <p className="text-sm text-slate-400">支持 PNG, JPG, WebP <br/> 一键转换为 SVG 矢量图</p>
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
                                {p.hex.toUpperCase()} <br/>
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

            {/* Smart Auto Tune Button (Replaces AI) */}
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
            
            {/* Background Removal Group */}
            <div className={`rounded-lg border transition-all overflow-hidden ${params.ignoreWhite ? 'bg-purple-500/5 border-purple-500/30' : 'bg-slate-800/50 border-slate-800 hover:border-slate-700'}`}>
                {/* Main Toggle */}
                <div 
                    className="flex items-center justify-between p-3 cursor-pointer"
                    onClick={() => updateParam('ignoreWhite', !params.ignoreWhite)}
                >
                    <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${params.ignoreWhite ? 'bg-purple-500 text-white' : 'bg-slate-700 text-slate-400'}`}>
                            <Eraser className="w-4 h-4" />
                        </div>
                        <div>
                            <div className={`text-sm font-medium ${params.ignoreWhite ? 'text-purple-100' : 'text-slate-300'}`}>去除背景</div>
                            <div className="text-[10px] text-slate-500">智能移除背景色</div>
                        </div>
                    </div>
                    <div className={`w-5 h-5 rounded border flex items-center justify-center ${params.ignoreWhite ? 'bg-purple-500 border-purple-500' : 'border-slate-600'}`}>
                        {params.ignoreWhite && <Check className="w-3.5 h-3.5 text-white" />}
                    </div>
                </div>

                {/* Sub-option: Color Selection */}
                {params.ignoreWhite && (
                    <div className="px-3 pb-3 space-y-2 border-t border-purple-500/10 pt-2">
                        <div className="flex items-center justify-between pl-11">
                             <div className="text-[10px] text-slate-400">目标颜色</div>
                             <div className="flex items-center gap-2">
                                {/* Color Preview */}
                                {params.backgroundColor ? (
                                    <div 
                                        className="flex items-center gap-2 px-2 py-1 rounded bg-slate-800 border border-slate-600 cursor-pointer hover:border-red-500 group"
                                        title="点击重置为自动"
                                        onClick={clearBackgroundColor}
                                    >
                                        <div 
                                            className="w-3 h-3 rounded-full border border-white/20"
                                            style={{ backgroundColor: `rgb(${params.backgroundColor.r},${params.backgroundColor.g},${params.backgroundColor.b})` }}
                                        ></div>
                                        <span className="text-[9px] text-slate-300 font-mono">自定义</span>
                                        <X className="w-3 h-3 text-slate-500 group-hover:text-red-400" />
                                    </div>
                                ) : (
                                    <div className="px-2 py-1 rounded bg-slate-800 border border-slate-700 text-[9px] text-slate-400">
                                        自动识别 (Auto)
                                    </div>
                                )}
                                
                                {/* Pipette Button */}
                                <button
                                    onClick={(e) => { e.stopPropagation(); setIsPickingColor(!isPickingColor); }}
                                    className={`p-1.5 rounded transition-colors ${isPickingColor ? 'bg-purple-500 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
                                    title="吸管工具：在图片上点击选择背景色"
                                >
                                    <Pipette className="w-3.5 h-3.5" />
                                </button>
                             </div>
                        </div>

                         <div 
                            className="flex items-center justify-between cursor-pointer"
                            onClick={() => updateParam('smartBackground', !params.smartBackground)}
                        >
                             <div className="flex items-center gap-2 pl-11">
                                 <div className="text-[10px] text-slate-400 flex flex-col leading-tight">
                                    <span className={params.smartBackground ? 'text-blue-300 font-medium' : ''}>智能保留主体内部</span>
                                 </div>
                             </div>
                             <div className={`w-6 h-3 rounded-full p-0.5 transition-colors ${params.smartBackground ? 'bg-blue-500' : 'bg-slate-700'}`}>
                                 <div className={`w-2 h-2 bg-white rounded-full shadow-sm transition-transform ${params.smartBackground ? 'translate-x-3' : 'translate-x-0'}`}></div>
                             </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Colors Slider & Palette */}
            <div className={`space-y-3 transition-opacity ${params.colorMode === 'binary' ? 'opacity-40 pointer-events-none' : ''}`}>
                 <div className="flex justify-between items-end">
                    <label className="text-sm font-medium text-slate-200 flex items-center gap-2">
                        <Palette className="w-4 h-4 text-purple-400" />
                        色彩数量 (Colors)
                    </label>
                    <span className="text-xs font-mono text-slate-400">{params.colorMode === 'binary' ? 2 : params.colors}</span>
                </div>
                <input 
                    type="range" min="2" max="64" step="1"
                    value={params.colors} 
                    onChange={(e) => updateParam('colors', Number(e.target.value))}
                    className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500 hover:accent-purple-400"
                />
                
                {/* Visual Palette */}
                {renderPalette()}
            </div>

            {/* Sampling (Upscale) */}
            <div className="space-y-2">
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

            {/* Auto Anti-Alias Toggle */}
             <div 
                className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50 border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors"
                onClick={() => updateParam('autoAntiAlias', !params.autoAntiAlias)}
             >
                <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${params.autoAntiAlias ? 'bg-green-500/20 text-green-400' : 'bg-slate-700/50 text-slate-500'}`}>
                        <Aperture className="w-4 h-4" />
                    </div>
                    <div>
                        <div className={`text-sm font-medium ${params.autoAntiAlias ? 'text-green-300' : 'text-slate-300'}`}>自动抗锯齿</div>
                        <div className="text-[10px] text-slate-500">平滑边缘锯齿 (Auto AA)</div>
                    </div>
                </div>
                <div className={`w-8 h-4 rounded-full p-0.5 transition-colors ${params.autoAntiAlias ? 'bg-green-500' : 'bg-slate-700'}`}>
                    <div className={`w-3 h-3 bg-white rounded-full shadow-sm transition-transform ${params.autoAntiAlias ? 'translate-x-4' : 'translate-x-0'}`}></div>
                </div>
            </div>

            {/* Advanced Trigger */}
            <button 
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-widest py-2 border-b border-slate-800 hover:text-slate-300 transition-colors"
            >
                <span>高级设置 (Advanced)</span>
                {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            {/* Advanced Sliders */}
            {showAdvanced && (
                <div className="space-y-6 pt-2 animate-in fade-in slide-in-from-top-2 duration-200">
                    <Slider 
                        label="路径拟合度 (Paths)" 
                        value={params.paths} min={10} max={100} 
                        onChange={(v) => updateParam('paths', v)} 
                        description="值越高，线条越贴合原图像素；值越低，线条越平滑。"
                    />
                    <Slider 
                        label="边角平滑度 (Corners)" 
                        value={params.corners} min={0} max={100} 
                        onChange={(v) => updateParam('corners', v)} 
                        description="值越高，保留锐利转角；值越低，转角圆润化。"
                    />
                    <Slider 
                        label="去除杂色 (Noise)" 
                        value={params.noise} min={0} max={100} 
                        onChange={(v) => updateParam('noise', v)} 
                        description="忽略小于指定像素大小的噪点区域。"
                    />
                     <Slider 
                        label="预处理模糊 (Blur)" 
                        value={params.blur} min={0} max={10} 
                        onChange={(v) => updateParam('blur', v)} 
                        description="处理前模糊图片，有助于平滑低质量图片的边缘。"
                    />
                </div>
            )}
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
                Vector.AI
            </h1>
            <p className="text-xs text-slate-500 mt-1 font-mono tracking-tight">SVG TRACER & CONVERTER</p>
        </div>

        <div className="flex-1 overflow-hidden relative">
            {!hasImage ? renderEmptyState() : renderControls()}
        </div>
    </div>
  );
};