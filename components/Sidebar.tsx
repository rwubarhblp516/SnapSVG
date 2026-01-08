import React, { useState } from 'react';
import { 
  Download, Upload, Image as ImageIcon, Zap, Settings2, 
  Command, Palette, Sparkles, Wand2, Droplet, 
  ChevronDown, ChevronUp, Check, Layers, SlidersHorizontal,
  FileImage, Eraser, ShieldCheck, Microscope
} from 'lucide-react';
import { Slider } from './Slider';
import { TracerParams, PresetName } from '../types';

interface SidebarProps {
  params: TracerParams;
  setParams: React.Dispatch<React.SetStateAction<TracerParams>>;
  onUploadClick: () => void;
  onDownloadSvg: () => void;
  onDownloadPng: () => void;
  processing: boolean;
  hasImage: boolean;
}

// 预设配置：映射到核心参数
const PRESETS: Record<PresetName, Partial<TracerParams> & { label: string, icon: any }> = {
    'default': { label: '默认设置 (Default)', icon: Sparkles, colors: 32, paths: 85, corners: 75, noise: 5, blur: 0, sampling: 2 },
    'high-fidelity': { label: '高保真照片 (Photo High)', icon: ImageIcon, colors: 64, paths: 95, corners: 85, noise: 0, blur: 0, sampling: 2 },
    'low-fidelity': { label: '低保真照片 (Photo Low)', icon: Zap, colors: 16, paths: 60, corners: 40, noise: 15, blur: 2, sampling: 1 },
    '3-colors': { label: '3 色海报 (Poster 3)', icon: Palette, colors: 3, paths: 50, corners: 50, noise: 20, blur: 1, sampling: 1 },
    '6-colors': { label: '6 色插画 (Illustration 6)', icon: Palette, colors: 6, paths: 55, corners: 55, noise: 15, blur: 1, sampling: 2 },
    '16-colors': { label: '16 色艺术 (Art 16)', icon: Palette, colors: 16, paths: 60, corners: 60, noise: 10, blur: 1, sampling: 2 },
    'sketch': { label: '素描线条 (Sketch)', icon: Wand2, colors: 4, paths: 40, corners: 20, noise: 50, blur: 0, sampling: 1 },
    'black-white': { label: '黑白徽标 (Black & White)', icon: Layers, colors: 2, paths: 90, corners: 90, noise: 25, blur: 0, sampling: 4 }, // High res for logos
};

export const Sidebar: React.FC<SidebarProps> = ({
  params,
  setParams,
  onUploadClick,
  onDownloadSvg,
  onDownloadPng,
  processing,
  hasImage
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
          sampling: p.sampling ?? prev.sampling
      }));
  };

  const updateParam = (key: keyof TracerParams, value: any) => {
      setParams(prev => ({ ...prev, [key]: value }));
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

  const renderControls = () => (
    <div className="flex flex-col h-full">
        {/* Top: Preset Selector */}
        <div className="p-5 border-b border-slate-800 space-y-4 bg-slate-900/50">
            <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">预设配置 (Preset)</label>
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

            {/* Ignore White Toggle Group */}
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
                            <div className="text-[10px] text-slate-500">忽略白色/透明区域</div>
                        </div>
                    </div>
                    <div className={`w-5 h-5 rounded border flex items-center justify-center ${params.ignoreWhite ? 'bg-purple-500 border-purple-500' : 'border-slate-600'}`}>
                        {params.ignoreWhite && <Check className="w-3.5 h-3.5 text-white" />}
                    </div>
                </div>

                {/* Sub-option: Smart Keep (Flood Fill) */}
                {params.ignoreWhite && (
                    <div 
                        className="flex items-center justify-between px-3 pb-3 pt-1 cursor-pointer border-t border-purple-500/10"
                        onClick={() => updateParam('smartBackground', !params.smartBackground)}
                    >
                         <div className="flex items-center gap-2 pl-11">
                             <div className="text-[10px] text-slate-400 flex flex-col leading-tight">
                                <span className={params.smartBackground ? 'text-blue-300 font-medium' : ''}>智能保留主体内部</span>
                                <span className="opacity-60 text-[9px] scale-95 origin-left">防止眼睛/花纹被误删</span>
                             </div>
                         </div>
                         
                         {/* Toggle Switch */}
                         <div className={`w-8 h-4 rounded-full p-0.5 transition-colors ${params.smartBackground ? 'bg-blue-500' : 'bg-slate-700'}`}>
                             <div className={`w-3 h-3 bg-white rounded-full shadow-sm transition-transform ${params.smartBackground ? 'translate-x-4' : 'translate-x-0'}`}></div>
                         </div>
                    </div>
                )}
            </div>
        </div>

        {/* Scrollable Settings */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6">
            
            {/* Essential: Colors */}
            <div className="space-y-3">
                 <div className="flex justify-between items-end">
                    <label className="text-sm font-medium text-slate-200 flex items-center gap-2">
                        <Palette className="w-4 h-4 text-purple-400" />
                        色彩数量 (Colors)
                    </label>
                    <span className="text-xs font-mono text-slate-400">{params.colors}</span>
                </div>
                <input 
                    type="range" min="2" max="64" step="1"
                    value={params.colors} 
                    onChange={(e) => updateParam('colors', Number(e.target.value))}
                    className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500 hover:accent-purple-400"
                />
            </div>

            {/* Essential: Sampling (Upscale) */}
            <div className="space-y-2">
                <label className="text-sm font-medium text-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Microscope className="w-4 h-4 text-blue-400" />
                        <span>采样精度 (Smart Upscale)</span>
                    </div>
                    {/* Show current value hint */}
                    <span className="text-[10px] text-slate-500 font-mono">
                        {params.sampling === 1 ? '1x' : params.sampling === 2 ? '2x' : '4x'}
                    </span>
                </label>
                
                {/* Description to clarify logic */}
                <p className="text-[10px] text-slate-500 mb-2">
                    放大并智能锐化边缘 (Smart Sharpen)，模拟高清修复效果。
                </p>

                <div className="grid grid-cols-3 gap-2 bg-slate-900/50 p-1 rounded-xl border border-slate-800">
                     {[1, 2, 4].map(s => {
                         const isActive = params.sampling === s;
                         return (
                             <button 
                                key={s}
                                onClick={() => {
                                    // Prevent re-triggering if already active
                                    if (params.sampling !== s) updateParam('sampling', s);
                                }}
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
                                 
                                 {/* Active Indicator Dot */}
                                 {isActive && (
                                     <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.8)]"></span>
                                 )}
                             </button>
                         );
                     })}
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
    <div className="w-80 bg-slate-900/80 backdrop-blur-xl border-r border-slate-800 flex flex-col shrink-0 h-full relative z-30 shadow-2xl transition-all duration-300">
        {hasImage ? renderControls() : renderEmptyState()}
    </div>
  );
};