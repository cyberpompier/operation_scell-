
import React from 'react';
import { COLORS } from '../constants.tsx';

interface HUDFrameProps {
  title: string;
  children: React.ReactNode;
  variant?: 'neon' | 'alert' | 'muted';
}

const HUDFrame: React.FC<HUDFrameProps> = ({ title, children, variant = 'neon' }) => {
  const borderColor = variant === 'alert' ? 'border-red-600' : variant === 'muted' ? 'border-slate-700' : 'border-[#F0FF00]';
  const textColor = variant === 'alert' ? 'text-red-500' : variant === 'muted' ? 'text-slate-500' : 'text-[#F0FF00]';

  return (
    <div className={`relative border-2 ${borderColor} p-4 bg-[#0A192F]/80 backdrop-blur-md`}>
      {/* Corner Brackets */}
      <div className={`absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 ${borderColor}`}></div>
      <div className={`absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 ${borderColor}`}></div>
      <div className={`absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 ${borderColor}`}></div>
      <div className={`absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 ${borderColor}`}></div>
      
      {/* Title Bar */}
      <div className={`absolute -top-3 left-6 px-2 bg-[#0A192F] text-[10px] font-bold uppercase tracking-widest ${textColor}`}>
        [ {title} ]
      </div>
      
      <div className="mt-2 h-full">
        {children}
      </div>
    </div>
  );
};

export default HUDFrame;
