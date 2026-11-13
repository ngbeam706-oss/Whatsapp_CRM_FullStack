import {
  GitBranch, 
  ShoppingBag, 
  Layers, 
  Eye, 
  CheckCircle2, 
  Check, 
  X, 
  ChevronLeft, 
  Lightbulb 
} from 'lucide-react';
import { TUTORIAL_STEPS } from './flowPresets';

interface BotFlowTutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Index into TUTORIAL_STEPS. */
  tutorialStep: number;
  onNext: () => void;
  onPrev: () => void;
  onJump: (step: number) => void;
}

export default function BotFlowTutorialModal({
  isOpen,
  onClose,
  tutorialStep,
  onNext,
  onPrev,
  onJump
}: BotFlowTutorialModalProps) {
  if (!isOpen) return null;

  const current = TUTORIAL_STEPS[tutorialStep];

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden border border-slate-200 flex flex-col">
        
        {/* Step Progress Top Bar */}
        <div className="bg-slate-100 border-b border-slate-200 px-6 pt-4 pb-3">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-purple-700 bg-purple-100 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
              {current.badge}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-slate-500 font-bold">
                {tutorialStep + 1} / {TUTORIAL_STEPS.length}
              </span>
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-200 transition cursor-pointer"
                title="Close Tour"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Progress dots & line */}
          <div className="flex items-center justify-between gap-2">
            {TUTORIAL_STEPS.map((s, idx) => (
              <button
                key={idx}
                onClick={() => onJump(idx)}
                className={`flex-1 h-2 rounded-full transition-all cursor-pointer ${
                  idx === tutorialStep
                    ? 'bg-purple-600 ring-2 ring-purple-300'
                    : idx < tutorialStep
                    ? 'bg-purple-400'
                    : 'bg-slate-300 hover:bg-slate-400'
                }`}
                title={`Jump to ${s.title}`}
              />
            ))}
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4">
          {/* Header Title with Icon */}
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-lg border border-purple-200 flex-shrink-0">
              {tutorialStep === 0 && <GitBranch className="w-5 h-5 text-purple-700" />}
              {tutorialStep === 1 && <ShoppingBag className="w-5 h-5 text-emerald-700" />}
              {tutorialStep === 2 && <Layers className="w-5 h-5 text-purple-700" />}
              {tutorialStep === 3 && <Eye className="w-5 h-5 text-teal-700" />}
              {tutorialStep === 4 && <CheckCircle2 className="w-5 h-5 text-emerald-700" />}
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 leading-tight">
                {current.title}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {current.tagline}
              </p>
            </div>
          </div>

          {/* Key Highlights */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
              What You Need to Know:
            </span>
            <div className="space-y-1.5">
              {current.description.map((line, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs text-slate-700 leading-relaxed">
                  <Check className="w-3.5 h-3.5 text-purple-600 flex-shrink-0 mt-0.5" />
                  <span>{line}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Pro-Tip Box */}
          <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-amber-900">
            <Lightbulb className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <span className="leading-snug">{current.proTip}</span>
          </div>
        </div>

        {/* Modal Navigation Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-4 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-800 font-semibold cursor-pointer"
          >
            Skip Tutorial
          </button>

          <div className="flex items-center gap-2">
            {tutorialStep > 0 && (
              <button
                type="button"
                onClick={onPrev}
                className="px-3.5 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition cursor-pointer flex items-center gap-1"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Previous</span>
              </button>
            )}

            <button
              type="button"
              onClick={onNext}
              className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-sm transition cursor-pointer flex items-center gap-1.5"
            >
              <span>{current.actionText}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

