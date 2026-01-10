import React, { useState, useEffect, useRef } from 'react';

interface SliderProps {
  label?: string; // Optional
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (val: number) => void; // Triggered on commit (MouseUp)
  className?: string; // Support className for layout
  disabled?: boolean;
  formatValue?: (val: number) => string;
}

export const Slider: React.FC<SliderProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  onValueChange,
  className = "",
  disabled,
  formatValue
}) => {
  // Internal state for immediate UI feedback during drag
  const [localValue, setLocalValue] = useState(value);
  const [isDragging, setIsDragging] = useState(false);

  // Sync with prop when not dragging
  useEffect(() => {
    if (!isDragging) {
      setLocalValue(value);
    }
  }, [value, isDragging]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(Number(e.target.value));
  };

  const handleCommit = () => {
    setIsDragging(false);
    if (localValue !== value) {
      onValueChange(localValue);
    }
  };

  const handlePointerDown = () => {
    setIsDragging(true);
  };

  return (
    <div className={`mb-4 group ${className}`}>
      {label && (
        <div className="flex justify-between items-center mb-2">
          <label className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors">
            {label}
          </label>
          <span className="text-xs font-mono text-purple-200 bg-purple-900/40 border border-purple-500/30 px-2 py-0.5 rounded min-w-[32px] text-center shadow-[0_0_10px_rgba(168,85,247,0.2)]">
            {formatValue ? formatValue(localValue) : localValue}
          </span>
        </div>
      )}

      <div className="relative h-6 flex items-center mb-1">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={localValue}
          onChange={handleChange}
          onPointerDown={handlePointerDown}
          onPointerUp={handleCommit}
          onKeyUp={(e) => { if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight')) handleCommit() }}
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
        <div className="absolute top-1/2 left-0 w-full h-1.5 bg-slate-800/80 border border-white/5 rounded-lg -translate-y-1/2 pointer-events-none">
          {/* Progress Bar Visual (Optional) */}
          <div
            className="h-full bg-purple-600/30 rounded-l-lg"
            style={{ width: `${((localValue - min) / (max - min)) * 100}%` }}
          ></div>
        </div>
      </div>
    </div>
  );
};