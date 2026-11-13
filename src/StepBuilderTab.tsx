import type { FormEvent } from 'react';
import {
  Layers,
  Sparkles,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  Eye
} from 'lucide-react';
import type { StepButton } from './types';

export interface StepBuilderTabProps {
  stepEnabled: boolean;
  setStepEnabled: (on: boolean) => void;
  selectedPreset: string;
  handleApplyPreset: (presetKey: string) => void;
  stepName: string;
  setStepName: (name: string) => void;
  stepType: string;
  setStepType: (type: string) => void;
  stepPrompt: string;
  setStepPrompt: (prompt: string) => void;
  stepButtons?: StepButton[];
  handleAddButton: () => void;
  handleUpdateButton: (index: number, field: keyof StepButton, value: string) => void;
  handleRemoveButton: (index: number) => void;
  stepFinalMessage: string;
  handleSaveStepConfig: (e?: FormEvent) => void;
  stepSaveSuccess: boolean;
}

export default function StepBuilderTab({
  stepEnabled,
  setStepEnabled,
  selectedPreset,
  handleApplyPreset,
  stepName,
  setStepName,
  stepType,
  setStepType,
  stepPrompt,
  setStepPrompt,
  stepButtons = [],
  handleAddButton,
  handleUpdateButton,
  handleRemoveButton,
  stepFinalMessage,
  handleSaveStepConfig,
  stepSaveSuccess
}: StepBuilderTabProps) {
  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-purple-900 to-indigo-900 text-white rounded-2xl p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 bg-purple-800/80 px-3 py-1 rounded-full text-xs font-semibold text-purple-200 mb-2 border border-purple-700">
            <Layers className="w-3.5 h-3.5 text-purple-300" />
            <span>Interactive Flow Step Builder</span>
          </div>
          <h3 className="text-xl font-bold flex items-center gap-2">
            <span>Step After Food Item Selection</span>
          </h3>
          <p className="text-xs text-purple-200 mt-1 max-w-xl">
            Configure what happens right after a customer picks any food item (RTE meal or RTC prep) from your WhatsApp menu. Change quantity options, delivery slots, add-ons, or custom text with 1 click!
          </p>
        </div>

        {/* Master Toggle */}
        <div className="bg-purple-800/60 border border-purple-700/80 rounded-xl p-3 flex items-center gap-3">
          <span className="text-xs font-bold text-purple-200">
            {stepEnabled ? 'Intermediate Step Active' : 'Direct Order Mode'}
          </span>
          <button
            type="button"
            onClick={() => setStepEnabled(!stepEnabled)}
            className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer ${
              stepEnabled ? 'bg-emerald-500' : 'bg-purple-700'
            }`}
          >
            <span
              className={`block w-4 h-4 bg-white rounded-full transition-transform absolute top-1 ${
                stepEnabled ? 'left-7' : 'left-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Quick-Start Preset Templates */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>Choose a Pre-built Step Template (1-Click Apply)</span>
          </h4>
          <span className="text-xs text-slate-400">Click any card to auto-populate the form below</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Preset 1: Portions */}
          <div
            onClick={() => handleApplyPreset('portions')}
            className={`p-3 rounded-xl border transition cursor-pointer flex flex-col justify-between ${
              selectedPreset === 'portions'
                ? 'border-purple-500 bg-purple-50/70 shadow-xs ring-2 ring-purple-200'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div>
              <div className="w-8 h-8 rounded-lg bg-orange-100 text-orange-700 flex items-center justify-center font-bold text-sm mb-2">
                🍽️
              </div>
              <h5 className="font-bold text-xs text-slate-800 mb-1">Portion & Quantity</h5>
              <p className="text-xs text-slate-500 leading-snug">Ask 1 Portion, 2 Portions, or Family Pack 4</p>
            </div>
            <span className="mt-3 text-xs font-bold text-purple-700 flex items-center gap-1">
              {selectedPreset === 'portions' ? '✓ Selected' : 'Apply Template'}
            </span>
          </div>

          {/* Preset 2: Delivery Slots */}
          <div
            onClick={() => handleApplyPreset('delivery_slots')}
            className={`p-3 rounded-xl border transition cursor-pointer flex flex-col justify-between ${
              selectedPreset === 'delivery_slots'
                ? 'border-purple-500 bg-purple-50/70 shadow-xs ring-2 ring-purple-200'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div>
              <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm mb-2">
                ⏰
              </div>
              <h5 className="font-bold text-xs text-slate-800 mb-1">Delivery Time Slot</h5>
              <p className="text-xs text-slate-500 leading-snug">Choose Lunch 12:30 PM, Dinner 7:30 PM, Pre-order</p>
            </div>
            <span className="mt-3 text-xs font-bold text-purple-700 flex items-center gap-1">
              {selectedPreset === 'delivery_slots' ? '✓ Selected' : 'Apply Template'}
            </span>
          </div>

          {/* Preset 3: Meal Add-ons */}
          <div
            onClick={() => handleApplyPreset('meal_addons')}
            className={`p-3 rounded-xl border transition cursor-pointer flex flex-col justify-between ${
              selectedPreset === 'meal_addons'
                ? 'border-purple-500 bg-purple-50/70 shadow-xs ring-2 ring-purple-200'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div>
              <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm mb-2">
                🥗
              </div>
              <h5 className="font-bold text-xs text-slate-800 mb-1">Meal Add-ons</h5>
              <p className="text-xs text-slate-500 leading-snug">Upsell Sprouts (+₹40), Buttermilk (+₹30)</p>
            </div>
            <span className="mt-3 text-xs font-bold text-purple-700 flex items-center gap-1">
              {selectedPreset === 'meal_addons' ? '✓ Selected' : 'Apply Template'}
            </span>
          </div>

          {/* Preset 4: Address Prompt */}
          <div
            onClick={() => handleApplyPreset('address_prompt')}
            className={`p-3 rounded-xl border transition cursor-pointer flex flex-col justify-between ${
              selectedPreset === 'address_prompt'
                ? 'border-purple-500 bg-purple-50/70 shadow-xs ring-2 ring-purple-200'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div>
              <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center font-bold text-sm mb-2">
                📍
              </div>
              <h5 className="font-bold text-xs text-slate-800 mb-1">Address & Location</h5>
              <p className="text-xs text-slate-500 leading-snug">Ask user to reply with delivery address or live pin</p>
            </div>
            <span className="mt-3 text-xs font-bold text-purple-700 flex items-center gap-1">
              {selectedPreset === 'address_prompt' ? '✓ Selected' : 'Apply Template'}
            </span>
          </div>

          {/* Preset 5: Direct Order */}
          <div
            onClick={() => handleApplyPreset('direct_order')}
            className={`p-3 rounded-xl border transition cursor-pointer flex flex-col justify-between ${
              selectedPreset === 'direct_order'
                ? 'border-purple-500 bg-purple-50/70 shadow-xs ring-2 ring-purple-200'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div>
              <div className="w-8 h-8 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center font-bold text-sm mb-2">
                ⚡
              </div>
              <h5 className="font-bold text-xs text-slate-800 mb-1">Direct Confirmation</h5>
              <p className="text-xs text-slate-500 leading-snug">Simple Order Now button directly confirming order</p>
            </div>
            <span className="mt-3 text-xs font-bold text-purple-700 flex items-center gap-1">
              {selectedPreset === 'direct_order' ? '✓ Selected' : 'Apply Template'}
            </span>
          </div>
        </div>
      </div>

      {/* Main Form & Live WhatsApp Preview Side-by-Side */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left Column: Form Editor (7 cols) */}
        <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-5">
          <div>
            <h4 className="font-bold text-sm text-slate-800">Customize Step Settings</h4>
            <p className="text-xs text-slate-500">Edit the message sent to customer and the buttons they tap.</p>
          </div>

          {/* Step Name */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Step Name / Label
            </label>
            <input
              type="text"
              value={stepName}
              onChange={(e) => setStepName(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-800 focus:bg-white focus:border-wa-teal focus:ring-1 focus:ring-wa-teal"
              placeholder="e.g. Quantity Selection, Delivery Slot"
            />
          </div>

          {/* Step Type Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Step Interaction Type
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setStepType('buttons')}
                className={`p-2.5 rounded-lg border text-left cursor-pointer transition ${
                  stepType === 'buttons'
                    ? 'border-purple-500 bg-purple-50/70 text-purple-900 font-bold'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <div className="text-xs font-bold">🔘 Quick Buttons</div>
                <div className="text-xs text-slate-500 font-normal mt-0.5">Up to 3 tap buttons</div>
              </button>

              <button
                type="button"
                onClick={() => setStepType('address_prompt')}
                className={`p-2.5 rounded-lg border text-left cursor-pointer transition ${
                  stepType === 'address_prompt'
                    ? 'border-purple-500 bg-purple-50/70 text-purple-900 font-bold'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <div className="text-xs font-bold">💬 Text / Location Prompt</div>
                <div className="text-xs text-slate-500 font-normal mt-0.5">Asks user to reply</div>
              </button>

              <button
                type="button"
                onClick={() => setStepType('direct')}
                className={`p-2.5 rounded-lg border text-left cursor-pointer transition ${
                  stepType === 'direct'
                    ? 'border-purple-500 bg-purple-50/70 text-purple-900 font-bold'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <div className="text-xs font-bold">⚡ Direct Confirm</div>
                <div className="text-xs text-slate-500 font-normal mt-0.5">Single Order Now button</div>
              </button>
            </div>
          </div>

          {/* WhatsApp Message Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                WhatsApp Message Prompt
              </label>
              <span className="text-xs text-slate-400">Supports *bold*, _italic_</span>
            </div>
            <textarea
              value={stepPrompt}
              onChange={(e) => setStepPrompt(e.target.value)}
              rows={3}
              className="w-full bg-slate-50 border border-slate-300 rounded-lg p-3 text-xs text-slate-800 font-mono focus:bg-white focus:border-wa-teal focus:ring-1 focus:ring-wa-teal"
              placeholder="Enter message sent to customer..."
            />
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <span className="font-semibold text-slate-600">Placeholders:</span>
              <code className="bg-slate-100 px-1 rounded border border-slate-200">{"{title}"}</code>
              <code className="bg-slate-100 px-1 rounded border border-slate-200">{"{price}"}</code>
              <code className="bg-slate-100 px-1 rounded border border-slate-200">{"{desc}"}</code>
            </div>
          </div>

          {/* Buttons Editor (when stepType === 'buttons') */}
          {stepType === 'buttons' && (
            <div className="space-y-3 border-t border-slate-200 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    WhatsApp Interactive Buttons (Max 3)
                  </label>
                  <p className="text-xs text-slate-500">Tap options displayed on customer's phone.</p>
                </div>
                <button
                  type="button"
                  onClick={handleAddButton}
                  disabled={stepButtons.length >= 3}
                  className={`text-xs font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1 transition ${
                    stepButtons.length >= 3
                      ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                      : 'bg-purple-100 text-purple-800 hover:bg-purple-200 cursor-pointer'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Button ({stepButtons.length}/3)</span>
                </button>
              </div>

              <div className="space-y-3">
                {stepButtons.map((btn, idx) => (
                  <div key={idx} className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2 relative">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-purple-800 uppercase tracking-wider">
                        Button #{idx + 1}
                      </span>
                      {stepButtons.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveButton(idx)}
                          className="text-slate-400 hover:text-rose-600 transition cursor-pointer p-0.5"
                          title="Remove button"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-bold text-slate-600 uppercase">Button Label</label>
                        <span className={`text-xs font-mono ${(btn.title || '').length > 20 ? 'text-rose-600 font-bold' : 'text-slate-400'}`}>
                          {(btn.title || '').length}/20 chars (Meta hard limit)
                        </span>
                      </div>
                      <input
                        type="text"
                        value={btn.title || ''}
                        maxLength={20}
                        onChange={(e) => handleUpdateButton(idx, 'title', e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:border-wa-teal focus:ring-1 focus:ring-wa-teal"
                        placeholder="e.g. 🍽️ 1 Portion"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 uppercase mb-1">
                        Automated WhatsApp Reply When Tapped
                      </label>
                      <textarea
                        value={btn.responseMessage || ''}
                        onChange={(e) => handleUpdateButton(idx, 'responseMessage', e.target.value)}
                        rows={2}
                        className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs text-slate-800 font-mono focus:border-wa-teal focus:ring-1 focus:ring-wa-teal"
                        placeholder="Message sent to customer upon tapping this option..."
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Save Button */}
          <div className="border-t border-slate-200 pt-4 flex items-center justify-between">
            <div>
              {stepSaveSuccess && (
                <span className="text-xs font-bold text-emerald-600 flex items-center gap-1.5 animate-fade-in">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Saved to Database & Live in WhatsApp Webhook!</span>
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={handleSaveStepConfig}
              className="bg-wa-teal hover:bg-teal-700 text-white text-xs font-semibold px-5 py-2.5 rounded-lg shadow-sm flex items-center gap-2 transition cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>Save Step Configuration</span>
            </button>
          </div>
        </div>

        {/* Right Column: Live WhatsApp Phone Simulator (5 cols) */}
        <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-5 shadow-xs sticky top-4">
          <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
            <h4 className="font-bold text-xs text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5 text-teal-600" />
              <span>Live WhatsApp Customer Preview</span>
            </h4>
            <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-semibold border border-emerald-200">
              Real-time
            </span>
          </div>

          {/* WhatsApp Chat Box Frame */}
          <div className="rounded-xl overflow-hidden border border-slate-300 shadow-inner bg-[#EFEAE2]">
            {/* WhatsApp Chat Header */}
            <div className="bg-[#075E54] text-white px-3 py-2 flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-emerald-700 flex items-center justify-center font-bold text-xs text-white">
                🌿
              </div>
              <div>
                <div className="font-bold text-xs leading-tight">Arogya Ruchulu Direct</div>
                <div className="text-xs text-emerald-200 leading-tight">Online (WhatsApp Business)</div>
              </div>
            </div>

            {/* WhatsApp Chat Bubbles Body */}
            <div className="p-3 space-y-2.5 text-xs min-h-[320px]">
              
              {/* Simulated Inbound Click */}
              <div className="flex justify-end">
                <div className="bg-[#E7FFDB] rounded-lg p-2 max-w-[85%] shadow-xs text-xs text-slate-800 border border-emerald-200">
                  [List Selected: 🍱 Arogya Daily Veg Thali]
                  <div className="text-2xs text-slate-400 text-right mt-0.5">10:30 AM</div>
                </div>
              </div>

              {/* Simulated Outbound Next Step Bubble */}
              <div className="flex justify-start">
                <div className="bg-white rounded-lg p-2.5 max-w-[90%] shadow-xs text-xs text-slate-800 space-y-2 border border-slate-200">
                  <div className="whitespace-pre-wrap leading-relaxed">
                    {stepPrompt
                      ? stepPrompt
                          .replace(/{title}/gi, 'Arogya Daily Veg Thali')
                          .replace(/{price}/gi, '₹130')
                          .replace(/{desc}/gi, '3 curries, whole wheat phulkas, rice & rasam')
                      : 'How many portions would you like to order today?'}
                  </div>

                  {/* Interactive Buttons Stack */}
                  {stepType === 'buttons' && (
                    <div className="space-y-1 border-t border-slate-100 pt-2">
                      {stepButtons.map((btn, i) => (
                        <div
                          key={i}
                          className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded py-1.5 px-2 text-center text-xs font-semibold text-wa-teal cursor-pointer transition flex items-center justify-center gap-1"
                        >
                          <span>{btn.title || `Option ${i + 1}`}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {stepType === 'direct' && (
                    <div className="space-y-1 border-t border-slate-100 pt-2">
                      <div className="w-full bg-slate-50 border border-slate-200 rounded py-1.5 px-2 text-center text-xs font-semibold text-wa-teal">
                        🛵 Order Now
                      </div>
                      <div className="w-full bg-slate-50 border border-slate-200 rounded py-1.5 px-2 text-center text-xs font-semibold text-wa-teal">
                        🌿 View 28-Day Kits
                      </div>
                    </div>
                  )}

                  <div className="text-2xs text-slate-400 text-right mt-1">10:30 AM ✓✓</div>
                </div>
              </div>

              {/* Step Response Hint */}
              {stepType === 'buttons' && stepButtons.length > 0 && (
                <div className="bg-teal-50/80 border border-teal-200 rounded p-2 text-xs text-teal-900 leading-snug">
                  <strong>When customer taps an option:</strong>
                  <div className="mt-1 text-slate-600 line-clamp-3 font-mono">
                    {stepButtons[0]?.responseMessage || stepFinalMessage}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

