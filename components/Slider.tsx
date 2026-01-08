import React from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (val: number) => void;
  description?: string;
  disabled?: boolean;
}

export const Slider: React.FC<SliderProps> = ({ 
  label, 
  value, 
  min, 
  max, 
  step = 1, 
  onChange, 
  description,
  disabled 
}) => {
  return (
    <div className="mb-5 group">
      <div className="flex justify-between items-center mb-2">
        <label className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors">
            {label}
        </label>
        <span className="text-xs font-mono text-purple-200 bg-purple-900/40 border border-purple-500/30 px-2 py-0.5 rounded min-w-[32px] text-center shadow-[0_0_10px_rgba(168,85,247,0.2)]">
          {value}
        </span>
      </div>
      
      <div className="relative h-6 flex items-center mb-1">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            disabled={disabled}
            className={`
                w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer 
                accent-purple-500 hover:accent-purple-400 
                focus:outline-none focus:ring-2 focus:ring-purple-500/30 
                transition-all z-10 relative
                ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
            `}
          />
          {/* Custom Track Background */}
          <div className="absolute top-1/2 left-0 w-full h-1.5 bg-slate-800/80 border border-white/5 rounded-lg -translate-y-1/2 pointer-events-none"></div>
      </div>
      
      {/* Description Area - Now fully visible and wrapping */}
      {description && (
          <p className="text-[10px] text-slate-500 leading-relaxed whitespace-normal break-words opacity-80 group-hover:opacity-100 group-hover:text-purple-300/80 transition-all">
             {description}
          </p>
      )}
    </div>
  );
};