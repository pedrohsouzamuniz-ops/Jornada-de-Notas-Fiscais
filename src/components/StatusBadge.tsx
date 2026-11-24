import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileCheck2,
  XCircle,
} from 'lucide-react';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
  info: 'bg-blue-50 text-blue-700 border-blue-200',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  danger: 'bg-red-50 text-red-700 border-red-200',
};

const TONE_ICONS: Record<Tone, React.ReactNode> = {
  neutral: <Clock className="w-3.5 h-3.5 shrink-0" />,
  info: <FileCheck2 className="w-3.5 h-3.5 shrink-0" />,
  success: <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />,
  warning: <AlertTriangle className="w-3.5 h-3.5 shrink-0" />,
  danger: <XCircle className="w-3.5 h-3.5 shrink-0" />,
};

export function StatusTag({
  label,
  tone,
}: {
  label: string;
  tone: Tone;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 ${TONE_CLASSES[tone]}`}
    >
      {TONE_ICONS[tone]}
      <span>{label}</span>
    </span>
  );
}
