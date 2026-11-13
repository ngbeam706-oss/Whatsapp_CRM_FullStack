import { useState, type FormEvent } from 'react';
import { Bot, Plus, Trash2, Edit2, X, Tag, MessageSquare, ToggleLeft, ToggleRight, Sparkles } from 'lucide-react';
import type { BotRule } from './types';

interface BotConfigScreenProps {
  botRules: BotRule[];
  onSaveRule: (rule: BotRule) => void;
  onDeleteRule: (id: string) => void;
  onToggleRule: (id: string) => void;
}

export default function BotConfigScreen({ botRules, onSaveRule, onDeleteRule, onToggleRule }: BotConfigScreenProps) {
  const [editingRule, setEditingRule] = useState<BotRule | null>(null);
  const [keyword, setKeyword] = useState('');
  const [matchType, setMatchType] = useState('contains'); // 'exact' or 'contains'
  const [responseType, setResponseType] = useState('text'); // 'text' or 'buttons'
  const [responseText, setResponseText] = useState('');
  const [button1, setButton1] = useState('');
  const [button2, setButton2] = useState('');
  const [button3, setButton3] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const openCreateModal = () => {
    setEditingRule(null);
    setKeyword('');
    setMatchType('contains');
    setResponseType('text');
    setResponseText('');
    setButton1('');
    setButton2('');
    setButton3('');
    setIsModalOpen(true);
  };

  const openEditModal = (rule: BotRule) => {
    setEditingRule(rule);
    setKeyword(rule.keyword);
    setMatchType(rule.matchType || 'contains');
    setResponseType(rule.responseType || 'text');
    setResponseText(rule.responseText || '');
    setButton1(rule.buttons?.[0]?.title || '');
    setButton2(rule.buttons?.[1]?.title || '');
    setButton3(rule.buttons?.[2]?.title || '');
    setIsModalOpen(true);
  };

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    if (!keyword.trim() || !responseText.trim()) return;

    const buttons: Array<{ id: string; title: string }> = [];
    if (responseType === 'buttons') {
      if (button1.trim()) buttons.push({ id: `btn_${Date.now()}_1`, title: button1.trim() });
      if (button2.trim()) buttons.push({ id: `btn_${Date.now()}_2`, title: button2.trim() });
      if (button3.trim()) buttons.push({ id: `btn_${Date.now()}_3`, title: button3.trim() });
    }

    const payload: BotRule = {
      id: editingRule ? editingRule.id : `rule_${Date.now()}`,
      keyword: keyword.trim().toLowerCase(),
      matchType,
      responseType,
      responseText: responseText.trim(),
      buttons,
      isActive: editingRule ? editingRule.isActive : true
    };

    onSaveRule(payload);
    setIsModalOpen(false);
  };

  return (
    <div className="flex-1 bg-slate-50 flex flex-col h-full overflow-hidden select-text">
      {/* Top Header */}
      <div className="bg-white border-b border-wa-border px-6 py-4 flex items-center justify-between shadow-xs">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-teal-50 text-wa-teal flex items-center justify-center font-bold text-lg border border-teal-200">
            <Bot className="w-5 h-5 text-wa-teal" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Auto-replies</h1>
            <p className="text-sm text-slate-500">When a customer's message contains a word you choose (like "price" or "timings"), the bot answers with your reply straight away.</p>
          </div>
        </div>

        <button
          onClick={openCreateModal}
          className="bg-wa-teal hover:bg-teal-700 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-sm flex items-center gap-1.5 transition cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Add New Keyword Rule</span>
        </button>
      </div>

      {/* Rules Content List */}
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin space-y-4">
        {botRules.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center max-w-md mx-auto my-12 shadow-xs">
            <div className="w-12 h-12 rounded-full bg-teal-50 text-wa-teal flex items-center justify-center mx-auto mb-3">
              <Sparkles className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-sm text-slate-800">No Keyword Rules Configured</h3>
            <p className="text-xs text-slate-500 mt-1 mb-4 leading-relaxed">
              Create your first trigger rule like "price", "diet", or "offer" to automatically send custom replies and WhatsApp buttons.
            </p>
            <button
              onClick={openCreateModal}
              className="bg-wa-teal hover:bg-teal-700 text-white text-xs font-medium px-4 py-2 rounded-lg transition"
            >
              Create Rule
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {botRules.map((rule) => (
              <div
                key={rule.id}
                className={`bg-white rounded-xl border transition shadow-xs flex flex-col justify-between p-4 ${
                  rule.isActive ? 'border-slate-200 hover:border-teal-300' : 'border-slate-200 opacity-60 bg-slate-50/50'
                }`}
              >
                <div>
                  {/* Trigger Badge & Status Toggle */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center space-x-1.5">
                      <span className="bg-teal-50 text-teal-800 border border-teal-200 text-xs font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 font-mono">
                        <Tag className="w-3 h-3 text-teal-600" />
                        "{rule.keyword}"
                      </span>
                      <span className="text-xs text-slate-400 uppercase font-semibold">
                        ({rule.matchType})
                      </span>
                    </div>

                    <button
                      onClick={() => onToggleRule(rule.id)}
                      title={rule.isActive ? 'Disable rule' : 'Enable rule'}
                      className="text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {rule.isActive ? (
                        <ToggleRight className="w-6 h-6 text-wa-teal" />
                      ) : (
                        <ToggleLeft className="w-6 h-6 text-slate-400" />
                      )}
                    </button>
                  </div>

                  {/* Reply Message Preview */}
                  <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-100 mb-3 text-xs text-slate-700 whitespace-pre-wrap line-clamp-4 leading-relaxed font-sans">
                    {rule.responseText}
                  </div>

                  {/* Attached Buttons Preview */}
                  {rule.buttons && rule.buttons.length > 0 && (
                    <div className="space-y-1 mb-3">
                      <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">Attached Buttons:</span>
                      <div className="flex flex-wrap gap-1">
                        {rule.buttons.map((btn, i) => (
                          <span key={i} className="bg-white border border-slate-200 text-slate-700 text-xs font-medium px-2 py-0.5 rounded shadow-2xs">
                            {btn.title}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Card Actions */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                  <span className="text-xs text-slate-400 font-medium">
                    {rule.responseType === 'buttons' ? 'Interactive Buttons' : 'Plain Text'}
                  </span>
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => openEditModal(rule)}
                      className="p-1.5 hover:bg-slate-100 text-slate-600 hover:text-slate-900 rounded transition cursor-pointer"
                      title="Edit rule"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onDeleteRule(rule.id)}
                      className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded transition cursor-pointer"
                      title="Delete rule"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit Rule Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-wa-teal text-white px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <Bot className="w-4 h-4" />
                {editingRule ? 'Edit Keyword Rule' : 'New Automated Keyword Rule'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-teal-200 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-5 space-y-4 text-xs text-slate-700">
              {/* Keyword & Match Type */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Trigger Keyword <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="e.g. price, diet, offers, sample"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono focus:ring-1 focus:ring-wa-teal focus:border-wa-teal focus:outline-none"
                  />
                  <p className="text-xs text-slate-400 mt-1">When customer types this word</p>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Match Type
                  </label>
                  <select
                    value={matchType}
                    onChange={(e) => setMatchType(e.target.value)}
                    className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-wa-teal focus:border-wa-teal focus:outline-none bg-white"
                  >
                    <option value="contains">Contains Word</option>
                    <option value="exact">Exact Match</option>
                  </select>
                </div>
              </div>

              {/* Response Type Selector */}
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Response Format
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setResponseType('text')}
                    className={`py-2 px-3 rounded-lg border text-xs font-medium transition cursor-pointer flex items-center justify-center gap-1.5 ${
                      responseType === 'text'
                        ? 'border-wa-teal bg-teal-50 text-wa-teal font-bold'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5" /> Plain Text Reply
                  </button>
                  <button
                    type="button"
                    onClick={() => setResponseType('buttons')}
                    className={`py-2 px-3 rounded-lg border text-xs font-medium transition cursor-pointer flex items-center justify-center gap-1.5 ${
                      responseType === 'buttons'
                        ? 'border-wa-teal bg-teal-50 text-wa-teal font-bold'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                    }`}
                  >
                    <Tag className="w-3.5 h-3.5" /> Text + Quick Buttons
                  </button>
                </div>
              </div>

              {/* Response Body Text */}
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Automated Reply Text <span className="text-rose-500">*</span>
                </label>
                <textarea
                  required
                  rows={4}
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  placeholder="Enter the automated reply message to be delivered to the customer on WhatsApp..."
                  className="w-full p-2.5 border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-wa-teal focus:border-wa-teal focus:outline-none resize-none leading-relaxed"
                ></textarea>
              </div>

              {/* Quick Reply Buttons (if buttons selected) */}
              {responseType === 'buttons' && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                  <label className="block font-bold text-slate-700 uppercase tracking-wider text-xs">
                    Interactive Buttons (Max 3, up to 20 characters each)
                  </label>
                  <input
                    type="text"
                    maxLength={20}
                    value={button1}
                    onChange={(e) => setButton1(e.target.value)}
                    placeholder="Button 1 (e.g. 🍱 Lunch Box)"
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:border-wa-teal"
                  />
                  <input
                    type="text"
                    maxLength={20}
                    value={button2}
                    onChange={(e) => setButton2(e.target.value)}
                    placeholder="Button 2 (e.g. 📋 Our services)"
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:border-wa-teal"
                  />
                  <input
                    type="text"
                    maxLength={20}
                    value={button3}
                    onChange={(e) => setButton3(e.target.value)}
                    placeholder="Button 3 (e.g. 💬 Talk to Staff)"
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:border-wa-teal"
                  />
                </div>
              )}

              {/* Modal Buttons */}
              <div className="pt-2 flex justify-end space-x-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg font-medium transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-wa-teal hover:bg-teal-700 text-white font-semibold rounded-lg shadow transition cursor-pointer"
                >
                  {editingRule ? 'Save Changes' : 'Create Bot Rule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

