import { useState, useEffect, type FormEvent } from 'react';
import { useConfirm } from './confirm';
import {
  GitBranch,
  Plus,
  Trash2,
  Edit3,
  Save,
  CheckCircle2,
  Sparkles,
  ShoppingBag,
  Flame,
  ChefHat,
  MessageSquare,
  ArrowRight,
  Check,
  X,
  Eye,
  RotateCcw,
  Layers,
  ArrowDown,
} from 'lucide-react';
import { STEP_PRESETS, TUTORIAL_STEPS } from './flowPresets';
import BotFlowTutorialModal from './BotFlowTutorialModal';
import StepBuilderTab from './StepBuilderTab';
import type { BotCatalog, CatalogItem, ItemNextStep, StepButton } from './types';

/** The catalog lists a menu item can be in. */
type ItemListKey = 'dietKits' | 'rteVegItems' | 'rteNonVegItems' | 'rtcVegItems' | 'rtcNonVegItems';
/** The add/edit form's category (maps to an ItemListKey on save). */
type ItemCategory = 'diet_kits' | 'rte_veg' | 'rte_nonveg' | 'rtc_veg' | 'rtc_nonveg';

interface BotFlowScreenProps {
  catalog?: BotCatalog;
  onSaveCatalog: (catalog: BotCatalog) => void;
  onResetCatalog: () => void;
}

export default function BotFlowScreen({ catalog = {}, onSaveCatalog, onResetCatalog }: BotFlowScreenProps) {
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState('visual_flow'); // 'visual_flow', 'next_step', 'diet_kits', 'rte', 'rtc', 'messages'
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [targetCategory, setTargetCategory] = useState<ItemCategory>('diet_kits'); // 'diet_kits', 'rte_veg', 'rte_nonveg', 'rtc_veg', 'rtc_nonveg'

  // Form states
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formDetails, setFormDetails] = useState('');

  // Editable messages
  const [welcomeMsg, setWelcomeMsg] = useState(catalog?.welcomeMessage || '');
  const [orderConfirmMsg, setOrderConfirmMsg] = useState(catalog?.orderConfirmReply || '');
  const [staffMsg, setStaffMsg] = useState(catalog?.staffNotificationReply || '');

  // Step After Food Selection States
  const currentNextStep: ItemNextStep = catalog?.itemNextStep || STEP_PRESETS.portions;
  const [stepEnabled, setStepEnabled] = useState(currentNextStep.enabled !== false);
  const [stepType, setStepType] = useState(currentNextStep.stepType || 'buttons');
  const [stepName, setStepName] = useState(currentNextStep.name || 'Quantity / Portion Selection');
  const [stepPrompt, setStepPrompt] = useState(currentNextStep.prompt || STEP_PRESETS.portions.prompt);
  const [stepButtons, setStepButtons] = useState<StepButton[]>(currentNextStep.buttons || STEP_PRESETS.portions.buttons);
  const [stepFinalMessage, setStepFinalMessage] = useState(currentNextStep.finalMessage || STEP_PRESETS.portions.finalMessage);
  const [selectedPreset, setSelectedPreset] = useState(currentNextStep.presetKey || 'portions');
  const [stepSaveSuccess, setStepSaveSuccess] = useState(false);

  // Sync internal state when catalog prop updates (from Supabase fetch or Reset)
  useEffect(() => {
    if (!catalog) return;
    setWelcomeMsg(catalog.welcomeMessage || '');
    setOrderConfirmMsg(catalog.orderConfirmReply || '');
    setStaffMsg(catalog.staffNotificationReply || '');

    const next: ItemNextStep = catalog.itemNextStep || STEP_PRESETS.portions;
    setStepEnabled(next.enabled !== false);
    setStepType(next.stepType || 'buttons');
    setStepName(next.name || 'Quantity / Portion Selection');
    setStepPrompt(next.prompt || STEP_PRESETS.portions.prompt);
    setStepButtons(next.buttons || STEP_PRESETS.portions.buttons);
    setStepFinalMessage(next.finalMessage || STEP_PRESETS.portions.finalMessage);
    setSelectedPreset(next.presetKey || 'portions');
  }, [catalog]);

  // Interactive Tutorial Tour States
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);

  const startTutorial = () => {
    setTutorialStep(0);
    setActiveTab(TUTORIAL_STEPS[0].targetTab);
    setTutorialOpen(true);
  };

  const nextTutorialStep = () => {
    if (tutorialStep < TUTORIAL_STEPS.length - 1) {
      const nextIdx = tutorialStep + 1;
      setTutorialStep(nextIdx);
      setActiveTab(TUTORIAL_STEPS[nextIdx].targetTab);
    } else {
      setTutorialOpen(false);
    }
  };

  const prevTutorialStep = () => {
    if (tutorialStep > 0) {
      const prevIdx = tutorialStep - 1;
      setTutorialStep(prevIdx);
      setActiveTab(TUTORIAL_STEPS[prevIdx].targetTab);
    }
  };

  const jumpToStep = (index: number) => {
    setTutorialStep(index);
    setActiveTab(TUTORIAL_STEPS[index].targetTab);
  };

  const handleApplyPreset = (presetKey: string) => {
    const preset = STEP_PRESETS[presetKey];
    if (!preset) return;
    setSelectedPreset(presetKey);
    setStepName(preset.name);
    setStepType(preset.stepType);
    setStepPrompt(preset.prompt);
    setStepButtons([...preset.buttons]);
    setStepFinalMessage(preset.finalMessage);
  };

  const handleAddButton = () => {
    if (stepButtons.length >= 3) return;
    const newIdx = stepButtons.length + 1;
    setStepButtons([
      ...stepButtons,
      {
        id: `opt_${Date.now()}`,
        title: `Option ${newIdx}`.slice(0, 20),
        responseMessage: `🎉 Confirmed Option ${newIdx}! Our kitchen team will contact you shortly.`
      }
    ]);
  };

  const handleUpdateButton = (index: number, field: keyof StepButton, value: string) => {
    const updated = [...stepButtons];
    updated[index] = {
      ...updated[index],
      [field]: field === 'title' ? value.slice(0, 20) : value
    };
    setStepButtons(updated);
  };

  const handleRemoveButton = (index: number) => {
    setStepButtons(stepButtons.filter((_, i) => i !== index));
  };

  const handleSaveStepConfig = (e?: FormEvent) => {
    e?.preventDefault();
    const updatedStep: ItemNextStep = {
      enabled: stepEnabled,
      presetKey: selectedPreset,
      name: stepName.trim() || 'Next Step',
      stepType: stepType,
      prompt: stepPrompt.trim(),
      buttons: stepButtons.map((b, i) => ({
        id: b.id || `btn_opt_${i}`,
        title: (b.title || `Option ${i + 1}`).trim().slice(0, 20),
        responseMessage: (b.responseMessage || '').trim()
      })),
      finalMessage: stepFinalMessage.trim()
    };

    onSaveCatalog({
      ...catalog,
      itemNextStep: updatedStep
    });

    setStepSaveSuccess(true);
    setTimeout(() => setStepSaveSuccess(false), 3500);
  };

  const openAddModal = (catKey: ItemCategory) => {
    setEditingItem(null);
    setTargetCategory(catKey);
    setFormTitle('');
    setFormDesc('');
    setFormPrice('');
    setFormDetails('');
    setIsModalOpen(true);
  };

  const openEditModal = (catKey: ItemCategory, item: CatalogItem) => {
    setEditingItem(item);
    setTargetCategory(catKey);
    setFormTitle(item.title);
    setFormDesc(item.description || '');
    setFormPrice(item.price ? String(item.price) : '');
    setFormDetails(item.details || '');
    setIsModalOpen(true);
  };

  const handleSaveItem = (e: FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) return;

    const priceNum = parseFloat(formPrice) || 0;
    const cleanTitle = formTitle.trim().slice(0, 24); // Meta 24-char limit
    const cleanDesc = formDesc.trim().slice(0, 72); // Meta 72-char limit

    const updatedCatalog: BotCatalog = { ...catalog };

    let targetArrayKey: ItemListKey = 'dietKits';
    if (targetCategory === 'diet_kits') targetArrayKey = 'dietKits';
    else if (targetCategory === 'rte_veg') targetArrayKey = 'rteVegItems';
    else if (targetCategory === 'rte_nonveg') targetArrayKey = 'rteNonVegItems';
    else if (targetCategory === 'rtc_veg') targetArrayKey = 'rtcVegItems';
    else if (targetCategory === 'rtc_nonveg') targetArrayKey = 'rtcNonVegItems';

    const currentItems = [...(updatedCatalog[targetArrayKey] || [])];

    if (editingItem) {
      const idx = currentItems.findIndex(i => i.id === editingItem.id);
      if (idx >= 0) {
        currentItems[idx] = {
          ...currentItems[idx],
          title: cleanTitle,
          description: cleanDesc,
          price: priceNum,
          details: formDetails.trim() || currentItems[idx].details
        };
      }
    } else {
      const newItem: CatalogItem = {
        id: `${targetCategory}_${Date.now()}`,
        title: cleanTitle,
        description: cleanDesc,
        price: priceNum,
        details: formDetails.trim() || `✅ *${cleanTitle}*\n\nPrice: ₹${priceNum}\n${cleanDesc}\n\nWould you like to place an order enquiry?`
      };
      currentItems.push(newItem);
    }

    updatedCatalog[targetArrayKey] = currentItems;
    onSaveCatalog(updatedCatalog);
    setIsModalOpen(false);
  };

  const handleDeleteItem = async (targetArrayKey: ItemListKey, itemId: string) => {
    if (!await confirm('Are you sure you want to remove this item from the bot menu?')) return;
    const updatedCatalog: BotCatalog = { ...catalog };
    updatedCatalog[targetArrayKey] = (updatedCatalog[targetArrayKey] || []).filter(i => i.id !== itemId);
    onSaveCatalog(updatedCatalog);
  };

  const handleSaveMessages = (e: FormEvent) => {
    e.preventDefault();
    const updatedCatalog = {
      ...catalog,
      welcomeMessage: welcomeMsg,
      orderConfirmReply: orderConfirmMsg,
      staffNotificationReply: staffMsg
    };
    onSaveCatalog(updatedCatalog);
  };

  return (
    <div className="flex-1 bg-slate-50 flex flex-col h-full overflow-hidden select-text">
      
      {/* Top Header */}
      <div className="bg-white border-b border-wa-border px-6 py-4 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-teal-50 text-wa-teal flex items-center justify-center font-bold text-lg border border-teal-200">
            <GitBranch className="w-5 h-5 text-wa-teal" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <span>Interactive WhatsApp Bot Flow & Menu Editor</span>
              <span className="bg-emerald-100 text-emerald-800 text-xs px-2 py-0.5 rounded-full font-semibold">Live in Webhook</span>
            </h2>
            <p className="text-xs text-slate-500">Edit items, prices, descriptions, and interactive WhatsApp lists without touching code.</p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={startTutorial}
            className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-xs px-3.5 py-1.5 rounded-lg shadow-sm transition cursor-pointer flex items-center gap-1.5 font-bold animate-pulse hover:animate-none"
            title="Start Interactive Tutorial & Guided Tour"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>Interactive Tutorial</span>
            <span className="bg-white/20 text-white text-2xs px-1.5 py-0.2 rounded-full font-bold">5 Steps</span>
          </button>

          <button
            onClick={onResetCatalog}
            className="text-slate-500 hover:text-slate-800 text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 transition cursor-pointer flex items-center gap-1.5"
            title="Reset the menus to your starting bot"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Defaults</span>
          </button>
        </div>
      </div>

      {/* Category Navigation Tabs */}
      <div className="bg-white border-b border-slate-200 px-6 flex items-center space-x-2 overflow-x-auto text-xs font-semibold">
        <button
          onClick={() => setActiveTab('visual_flow')}
          className={`py-3 px-3.5 border-b-2 transition flex items-center gap-2 cursor-pointer ${
            activeTab === 'visual_flow'
              ? 'border-wa-teal text-wa-teal'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Eye className="w-4 h-4" />
          <span>Interactive Visual Flow</span>
        </button>

        <button
          onClick={() => setActiveTab('diet_kits')}
          className={`py-3 px-3.5 border-b-2 transition flex items-center gap-2 cursor-pointer ${
            activeTab === 'diet_kits'
              ? 'border-wa-teal text-wa-teal'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Flame className="w-4 h-4 text-orange-500" />
          <span>28-Day Diet Kits</span>
          <span className="bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded-full text-xs">
            {catalog.dietKits?.length || 0}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('rte')}
          className={`py-3 px-3.5 border-b-2 transition flex items-center gap-2 cursor-pointer ${
            activeTab === 'rte'
              ? 'border-wa-teal text-wa-teal'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <ShoppingBag className="w-4 h-4 text-emerald-600" />
          <span>Ready to Eat (RTE)</span>
          <span className="bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded-full text-xs">
            {(catalog.rteVegItems?.length || 0) + (catalog.rteNonVegItems?.length || 0)}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('rtc')}
          className={`py-3 px-3.5 border-b-2 transition flex items-center gap-2 cursor-pointer ${
            activeTab === 'rtc'
              ? 'border-wa-teal text-wa-teal'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <ChefHat className="w-4 h-4 text-indigo-600" />
          <span>Ready to Cook (RTC)</span>
          <span className="bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded-full text-xs">
            {(catalog.rtcVegItems?.length || 0) + (catalog.rtcNonVegItems?.length || 0)}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('next_step')}
          className={`py-3 px-3.5 border-b-2 transition flex items-center gap-2 cursor-pointer ${
            activeTab === 'next_step'
              ? 'border-wa-teal text-wa-teal font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Layers className="w-4 h-4 text-purple-600" />
          <span>Step After Food Selection</span>
          <span className="bg-purple-100 text-purple-700 px-1.5 py-0.2 rounded-full text-xs font-bold">
            Next Step
          </span>
        </button>

        <button
          onClick={() => setActiveTab('messages')}
          className={`py-3 px-3.5 border-b-2 transition flex items-center gap-2 cursor-pointer ${
            activeTab === 'messages'
              ? 'border-wa-teal text-wa-teal'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <MessageSquare className="w-4 h-4 text-teal-600" />
          <span>Flow Messages & Automated Replies</span>
        </button>
      </div>

      {/* Main Content Pane */}
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        
        {/* ========================================================= */}
        {/* TAB 1: VISUAL FLOW VIEW                                    */}
        {/* ========================================================= */}
        {activeTab === 'visual_flow' && (
          <div className="space-y-6 max-w-5xl mx-auto">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs text-emerald-900 flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div>
                <strong className="block font-bold mb-0.5">Live Interactive WhatsApp Bot Architecture</strong>
                This diagram illustrates exactly what the customer receives on WhatsApp at each stage. Every button, dish, price, and message below can be customized in the category tabs above.
              </div>
            </div>

            {/* Tree Flow Columns */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              
              {/* Level 1: Welcome Greeting */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="bg-teal-50 text-teal-700 text-xs font-bold px-2 py-0.5 rounded uppercase">Level 1</span>
                    <span className="text-xs text-slate-400 font-semibold">User sends "Hi"</span>
                  </div>
                  <h4 className="font-bold text-sm text-slate-800 mb-2">Main Welcome Prompt</h4>
                  <div className="bg-slate-50 border border-slate-100 p-2.5 rounded text-xs text-slate-600 mb-3 whitespace-pre-wrap">
                    {catalog.welcomeMessage}
                  </div>
                </div>

                <div className="space-y-1.5 border-t border-slate-100 pt-3">
                  <span className="text-xs text-slate-400 font-bold uppercase tracking-wider block">Customer Buttons:</span>
                  <div className="space-y-1">
                    {catalog.welcomeButtons?.map(b => (
                      <div key={b.id} className="bg-teal-50 border border-teal-200 text-teal-800 rounded px-2 py-1 text-xs font-medium flex items-center justify-between">
                        <span>{b.title}</span>
                        <ArrowRight className="w-3 h-3 text-teal-600" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Level 2A: 28-Day Diet Kits */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="bg-orange-50 text-orange-700 text-xs font-bold px-2 py-0.5 rounded uppercase">Branch A</span>
                    <span className="text-xs text-slate-400 font-semibold">Interactive List</span>
                  </div>
                  <h4 className="font-bold text-sm text-slate-800 mb-1">🌿 28-Day Diet Kits</h4>
                  <p className="text-xs text-slate-500 mb-3">Taps "View 28-Day Kits"</p>

                  <div className="space-y-1.5 max-h-56 overflow-y-auto scrollbar-thin pr-1 mb-3">
                    {catalog.dietKits?.map(k => (
                      <div key={k.id} className="bg-slate-50 border border-slate-200 rounded p-1.5 text-xs">
                        <div className="font-bold text-slate-800 flex justify-between items-center">
                          <span className="truncate">{k.title}</span>
                          <span className="text-emerald-700 font-mono text-xs">₹{k.price}</span>
                        </div>
                        <p className="text-xs text-slate-500 truncate mt-0.5">{k.description}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-orange-50 border border-orange-200 rounded p-2 text-xs text-orange-800 font-medium">
                  Triggers detailed kit inclusions + [Confirm Order] button
                </div>
              </div>

              {/* Level 2B: Ready to Eat (RTE) */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="bg-emerald-50 text-emerald-700 text-xs font-bold px-2 py-0.5 rounded uppercase">Branch B</span>
                    <span className="text-xs text-slate-400 font-semibold">Subcategories</span>
                  </div>
                  <h4 className="font-bold text-sm text-slate-800 mb-1">🍱 Ready to Eat (RTE)</h4>
                  <p className="text-xs text-slate-500 mb-3">Pure Veg vs Non-Veg Meals</p>

                  <div className="space-y-2 mb-3">
                    <div className="border border-emerald-100 rounded-lg p-2 bg-emerald-50/50">
                      <span className="text-xs font-bold text-emerald-800 block mb-1">🥬 Pure Veg ({catalog.rteVegItems?.length || 0} items)</span>
                      <div className="text-xs text-slate-600 space-y-0.5">
                        {catalog.rteVegItems?.slice(0, 3).map(item => (
                          <div key={item.id} className="truncate">• {item.title} (₹{item.price})</div>
                        ))}
                      </div>
                    </div>

                    <div className="border border-rose-100 rounded-lg p-2 bg-rose-50/50">
                      <span className="text-xs font-bold text-rose-800 block mb-1">🍗 Non-Veg Specials ({catalog.rteNonVegItems?.length || 0} items)</span>
                      <div className="text-xs text-slate-600 space-y-0.5">
                        {catalog.rteNonVegItems?.slice(0, 3).map(item => (
                          <div key={item.id} className="truncate">• {item.title} (₹{item.price})</div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-emerald-50 border border-emerald-200 rounded p-2 text-xs text-emerald-800 font-medium">
                  Triggers dish order enquiry + [🛵 Order Now] button
                </div>
              </div>

              {/* Level 2C: Ready to Cook (RTC) */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="bg-indigo-50 text-indigo-700 text-xs font-bold px-2 py-0.5 rounded uppercase">Branch C</span>
                    <span className="text-xs text-slate-400 font-semibold">Batters & Pastes</span>
                  </div>
                  <h4 className="font-bold text-sm text-slate-800 mb-1">🍳 Ready to Cook (RTC)</h4>
                  <p className="text-xs text-slate-500 mb-3">Batters & Curry Pastes</p>

                  <div className="space-y-2 mb-3">
                    <div className="border border-indigo-100 rounded-lg p-2 bg-indigo-50/50">
                      <span className="text-xs font-bold text-indigo-800 block mb-1">🥬 Batters & Mixes ({catalog.rtcVegItems?.length || 0} items)</span>
                      <div className="text-xs text-slate-600 space-y-0.5">
                        {catalog.rtcVegItems?.slice(0, 3).map(item => (
                          <div key={item.id} className="truncate">• {item.title} (₹{item.price})</div>
                        ))}
                      </div>
                    </div>

                    <div className="border border-amber-100 rounded-lg p-2 bg-amber-50/50">
                      <span className="text-xs font-bold text-amber-800 block mb-1">🍗 Non-Veg Pastes ({catalog.rtcNonVegItems?.length || 0} items)</span>
                      <div className="text-xs text-slate-600 space-y-0.5">
                        {catalog.rtcNonVegItems?.slice(0, 3).map(item => (
                          <div key={item.id} className="truncate">• {item.title} (₹{item.price})</div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-indigo-50 border border-indigo-200 rounded p-2 text-xs text-indigo-800 font-medium">
                  Triggers RTC prep enquiry + [🛵 Order Now] button
                </div>
              </div>

            </div>

            {/* Connecting Arrow */}
            <div className="flex items-center justify-center my-2 text-slate-400 gap-2">
              <ArrowDown className="w-5 h-5 text-purple-500 animate-bounce" />
              <span className="text-xs font-semibold text-slate-500">Connected Next Step Configured in UI</span>
              <ArrowDown className="w-5 h-5 text-purple-500 animate-bounce" />
            </div>

            {/* Level 3 & Level 4 Flow Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Level 3: Step After Item Selection */}
              <div className="bg-white rounded-xl border-2 border-purple-300 p-5 shadow-sm flex flex-col justify-between relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-purple-600 text-white text-xs font-bold px-3 py-1 rounded-bl-lg uppercase tracking-wider">
                  Configurable in UI
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="bg-purple-100 text-purple-800 text-xs font-bold px-2 py-0.5 rounded uppercase">Level 3</span>
                    <span className="text-xs text-purple-700 font-semibold">Taps any RTE / RTC dish</span>
                  </div>
                  <h4 className="font-bold text-sm text-slate-800 mb-1 flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-purple-600" />
                    <span>{currentNextStep?.name || 'Step After Food Selection'}</span>
                  </h4>
                  <p className="text-xs text-slate-500 mb-3">WhatsApp automatically sends this next interactive step:</p>

                  <div className="bg-purple-50/70 border border-purple-200 rounded-lg p-3 text-xs text-slate-700 font-mono whitespace-pre-wrap mb-3 leading-relaxed">
                    {currentNextStep?.prompt || 'How many portions would you like to order today?'}
                  </div>

                  <div className="space-y-1.5 mb-3">
                    <span className="text-xs text-slate-500 font-bold uppercase tracking-wider block">Customer Tap Options:</span>
                    <div className="space-y-1">
                      {(currentNextStep?.buttons || []).map((b, i) => (
                        <div key={i} className="bg-purple-50 border border-purple-200 text-purple-900 rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center justify-between">
                          <span>{b.title}</span>
                          <span className="text-xs text-purple-600 bg-white border border-purple-200 px-1.5 py-0.5 rounded">Option {i + 1}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="border-t border-purple-100 pt-3 flex items-center justify-between">
                  <span className="text-xs text-purple-700 font-medium">Need to change options or text?</span>
                  <button
                    onClick={() => setActiveTab('next_step')}
                    className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1 transition cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Customize in UI</span>
                  </button>
                </div>
              </div>

              {/* Level 4: Final Handover */}
              <div className="bg-white rounded-xl border border-emerald-300 p-5 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-2 py-0.5 rounded uppercase">Level 4</span>
                    <span className="text-xs text-emerald-700 font-semibold">Option tapped by user</span>
                  </div>
                  <h4 className="font-bold text-sm text-slate-800 mb-1 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Order Confirmation & Kitchen Notification</span>
                  </h4>
                  <p className="text-xs text-slate-500 mb-3">Dispatched immediately to WhatsApp + Synced to CRM:</p>

                  <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-950 font-mono whitespace-pre-wrap mb-3 leading-relaxed">
                    {catalog.orderConfirmReply}
                  </div>

                  <div className="bg-emerald-50 rounded-lg p-2.5 border border-emerald-200 text-xs text-emerald-800 space-y-1">
                    <div className="flex items-center gap-1.5 font-bold">
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                      <span>Customer details logged into Supabase `whatsapp_leads`</span>
                    </div>
                    <div className="flex items-center gap-1.5 font-bold">
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                      <span>Message history saved into `whatsapp_messages`</span>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-3 flex items-center justify-between text-xs text-slate-500">
                  <span>Delivery rider & kitchen team alerted</span>
                  <span className="font-mono text-emerald-700 font-bold">Live Flow Active</span>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 2: 28-DAY DIET KITS EDITOR                             */}
        {/* ========================================================= */}
        {activeTab === 'diet_kits' && (
          <div className="space-y-4 max-w-5xl mx-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-slate-800">28-Day Functional Diet Plan Kits</h3>
                <p className="text-xs text-slate-500">Curated plans sent in Meta's interactive list when user taps "28-Day Diet Kits" or sends "diet".</p>
              </div>
              <button
                onClick={() => openAddModal('diet_kits')}
                className="bg-wa-teal hover:bg-teal-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-1.5 transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add New Diet Kit</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {catalog.dietKits?.map((kit) => (
                <div key={kit.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col justify-between hover:border-teal-300 transition">
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h4 className="font-bold text-sm text-slate-800 leading-snug">{kit.title}</h4>
                      <span className="bg-emerald-50 text-emerald-800 font-mono font-bold text-xs px-2 py-0.5 rounded border border-emerald-200 flex-shrink-0">
                        ₹{kit.price}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mb-3 leading-relaxed">{kit.description}</p>
                    
                    {kit.details && (
                      <div className="bg-slate-50 border border-slate-100 rounded-lg p-2 text-xs text-slate-500 whitespace-pre-wrap line-clamp-3 mb-3 font-mono">
                        {kit.details}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                    <span className="text-xs text-slate-400 font-mono">ID: {kit.id}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEditModal('diet_kits', kit)}
                        className="p-1.5 text-slate-500 hover:text-wa-teal rounded hover:bg-slate-100 transition cursor-pointer"
                        title="Edit Kit Details"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteItem('dietKits', kit.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 rounded hover:bg-slate-100 transition cursor-pointer"
                        title="Delete Kit"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 3: READY TO EAT (RTE) MEALS EDITOR                    */}
        {/* ========================================================= */}
        {activeTab === 'rte' && (
          <div className="space-y-6 max-w-5xl mx-auto">
            {/* Category 1: Pure Veg */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm text-emerald-900 flex items-center gap-1.5">
                    <span>🥬 Pure Veg Meals & Thalis</span>
                    <span className="text-xs font-normal text-slate-500">(Rendered when user chooses 'Pure Veg Meals')</span>
                  </h3>
                </div>
                <button
                  onClick={() => openAddModal('rte_veg')}
                  className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Veg Item</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {catalog.rteVegItems?.map(item => (
                  <div key={item.id} className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs flex flex-col justify-between hover:border-emerald-300 transition">
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <h4 className="font-bold text-xs text-slate-800 truncate">{item.title}</h4>
                        <span className="bg-emerald-50 text-emerald-800 font-mono font-bold text-xs px-2 py-0.5 rounded border border-emerald-200 flex-shrink-0">
                          ₹{item.price}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mb-2 leading-relaxed">{item.description}</p>
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                      <span className="text-xs text-slate-400 font-mono truncate max-w-[120px]">{item.id}</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEditModal('rte_veg', item)}
                          className="p-1 text-slate-500 hover:text-emerald-700 rounded hover:bg-slate-100 transition cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteItem('rteVegItems', item.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-slate-100 transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Category 2: Non-Veg */}
            <div className="space-y-3 border-t border-slate-200 pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm text-rose-900 flex items-center gap-1.5">
                    <span>🍗 Non-Veg Specials</span>
                    <span className="text-xs font-normal text-slate-500">(Rendered when user chooses 'Non-Veg Specials')</span>
                  </h3>
                </div>
                <button
                  onClick={() => openAddModal('rte_nonveg')}
                  className="bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Non-Veg Item</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {catalog.rteNonVegItems?.map(item => (
                  <div key={item.id} className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs flex flex-col justify-between hover:border-rose-300 transition">
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <h4 className="font-bold text-xs text-slate-800 truncate">{item.title}</h4>
                        <span className="bg-rose-50 text-rose-800 font-mono font-bold text-xs px-2 py-0.5 rounded border border-rose-200 flex-shrink-0">
                          ₹{item.price}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mb-2 leading-relaxed">{item.description}</p>
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                      <span className="text-xs text-slate-400 font-mono truncate max-w-[120px]">{item.id}</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEditModal('rte_nonveg', item)}
                          className="p-1 text-slate-500 hover:text-rose-700 rounded hover:bg-slate-100 transition cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteItem('rteNonVegItems', item.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-slate-100 transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 4: READY TO COOK (RTC) PREPS EDITOR                   */}
        {/* ========================================================= */}
        {activeTab === 'rtc' && (
          <div className="space-y-6 max-w-5xl mx-auto">
            {/* Category 1: Batters & Mixes */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm text-indigo-900 flex items-center gap-1.5">
                    <span>🥬 Ancient Grain Batters & Pre-mixes</span>
                    <span className="text-xs font-normal text-slate-500">(Batters, porridges, podis)</span>
                  </h3>
                </div>
                <button
                  onClick={() => openAddModal('rtc_veg')}
                  className="bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add RTC Batter/Mix</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {catalog.rtcVegItems?.map(item => (
                  <div key={item.id} className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs flex flex-col justify-between hover:border-indigo-300 transition">
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <h4 className="font-bold text-xs text-slate-800 truncate">{item.title}</h4>
                        <span className="bg-indigo-50 text-indigo-800 font-mono font-bold text-xs px-2 py-0.5 rounded border border-indigo-200 flex-shrink-0">
                          ₹{item.price}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mb-2 leading-relaxed">{item.description}</p>
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                      <span className="text-xs text-slate-400 font-mono truncate max-w-[120px]">{item.id}</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEditModal('rtc_veg', item)}
                          className="p-1 text-slate-500 hover:text-indigo-700 rounded hover:bg-slate-100 transition cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteItem('rtcVegItems', item.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-slate-100 transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Category 2: Non-Veg Curry Pastes */}
            <div className="space-y-3 border-t border-slate-200 pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm text-amber-900 flex items-center gap-1.5">
                    <span>🍗 Non-Veg Curry Pastes & Marinades</span>
                    <span className="text-xs font-normal text-slate-500">(10-minute stone-ground gravies)</span>
                  </h3>
                </div>
                <button
                  onClick={() => openAddModal('rtc_nonveg')}
                  className="bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Curry Paste</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {catalog.rtcNonVegItems?.map(item => (
                  <div key={item.id} className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs flex flex-col justify-between hover:border-amber-300 transition">
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <h4 className="font-bold text-xs text-slate-800 truncate">{item.title}</h4>
                        <span className="bg-amber-50 text-amber-800 font-mono font-bold text-xs px-2 py-0.5 rounded border border-amber-200 flex-shrink-0">
                          ₹{item.price}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mb-2 leading-relaxed">{item.description}</p>
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                      <span className="text-xs text-slate-400 font-mono truncate max-w-[120px]">{item.id}</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEditModal('rtc_nonveg', item)}
                          className="p-1 text-slate-500 hover:text-amber-700 rounded hover:bg-slate-100 transition cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteItem('rtcNonVegItems', item.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-slate-100 transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB: STEP AFTER FOOD SELECTION (NEXT STEP BUILDER)         */}
        {/* ========================================================= */}
        {activeTab === 'next_step' && (
          <StepBuilderTab
            stepEnabled={stepEnabled}
            setStepEnabled={setStepEnabled}
            selectedPreset={selectedPreset}
            handleApplyPreset={handleApplyPreset}
            stepName={stepName}
            setStepName={setStepName}
            stepType={stepType}
            setStepType={setStepType}
            stepPrompt={stepPrompt}
            setStepPrompt={setStepPrompt}
            stepButtons={stepButtons}
            handleAddButton={handleAddButton}
            handleUpdateButton={handleUpdateButton}
            handleRemoveButton={handleRemoveButton}
            stepFinalMessage={stepFinalMessage}
            handleSaveStepConfig={handleSaveStepConfig}
            stepSaveSuccess={stepSaveSuccess}
          />
        )}

        {/* ========================================================= */}
        {/* TAB 5: FLOW MESSAGES & REPLIES                            */}
        {/* ========================================================= */}
        {activeTab === 'messages' && (
          <form onSubmit={handleSaveMessages} className="space-y-5 max-w-3xl mx-auto bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
            <div>
              <h3 className="font-bold text-base text-slate-800 mb-1">Bot Flow Prompts & Automated Replies</h3>
              <p className="text-xs text-slate-500">Edit the greeting message and confirmation texts sent during the flow.</p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                1. Main Welcome Message (Sent when customer texts "Hi" or unknown words)
              </label>
              <textarea
                value={welcomeMsg}
                onChange={(e) => setWelcomeMsg(e.target.value)}
                rows={3}
                className="w-full bg-slate-50 border border-slate-300 rounded-lg p-3 text-xs text-slate-800 focus:bg-white focus:border-wa-teal focus:ring-1 focus:ring-wa-teal"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                2. Order Confirmation Reply (Sent when customer clicks "Confirm Order" or "Order Now")
              </label>
              <textarea
                value={orderConfirmMsg}
                onChange={(e) => setOrderConfirmMsg(e.target.value)}
                rows={3}
                className="w-full bg-slate-50 border border-slate-300 rounded-lg p-3 text-xs text-slate-800 focus:bg-white focus:border-wa-teal focus:ring-1 focus:ring-wa-teal"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                3. Staff / Nutritionist Handover Reply (Sent when customer clicks "Ask Nutritionist" or "Talk to Staff")
              </label>
              <textarea
                value={staffMsg}
                onChange={(e) => setStaffMsg(e.target.value)}
                rows={3}
                className="w-full bg-slate-50 border border-slate-300 rounded-lg p-3 text-xs text-slate-800 focus:bg-white focus:border-wa-teal focus:ring-1 focus:ring-wa-teal"
              />
            </div>

            <div className="border-t border-slate-200 pt-4 flex justify-end">
              <button
                type="submit"
                className="bg-wa-teal hover:bg-teal-700 text-white text-xs font-semibold px-5 py-2.5 rounded-lg shadow transition cursor-pointer flex items-center gap-1.5"
              >
                <Save className="w-4 h-4" />
                <span>Save Flow Messages</span>
              </button>
            </div>
          </form>
        )}

      </div>

      {/* Item Create / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200">
            <div className="bg-wa-teal text-white px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <ShoppingBag className="w-4 h-4" />
                <span>{editingItem ? 'Edit Item Details' : 'Add New Item to Bot Menu'}</span>
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-teal-200 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="p-5 space-y-4 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold text-slate-700 uppercase tracking-wider">
                    Item Title / Name
                  </label>
                  <span className={`text-xs font-mono ${formTitle.length > 24 ? 'text-rose-600 font-bold' : 'text-slate-400'}`}>
                    {formTitle.length}/24 chars (Meta Cloud Limit)
                  </span>
                </div>
                <input
                  type="text"
                  required
                  maxLength={24}
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g. Arogya Daily Veg Thali"
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-xs text-slate-800 focus:bg-white focus:border-wa-teal focus:ring-1 focus:ring-wa-teal"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Price (₹ INR)
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-xs font-bold">₹</span>
                  <input
                    type="number"
                    value={formPrice}
                    onChange={(e) => setFormPrice(e.target.value)}
                    placeholder="130"
                    className="w-full pl-7 bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-xs text-slate-800 font-mono font-bold focus:bg-white focus:border-wa-teal focus:ring-1 focus:ring-wa-teal"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold text-slate-700 uppercase tracking-wider">
                    Short Description (In Interactive List)
                  </label>
                  <span className={`text-xs font-mono ${formDesc.length > 72 ? 'text-rose-600 font-bold' : 'text-slate-400'}`}>
                    {formDesc.length}/72 chars (Meta Limit)
                  </span>
                </div>
                <input
                  type="text"
                  maxLength={72}
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="3 curries, whole wheat phulkas, rice & rasam (₹130)"
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-xs text-slate-800 focus:bg-white focus:border-wa-teal focus:ring-1 focus:ring-wa-teal"
                />
              </div>

              {targetCategory === 'diet_kits' && (
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Detailed Inclusions (Sent when customer taps the kit)
                  </label>
                  <textarea
                    rows={4}
                    value={formDetails}
                    onChange={(e) => setFormDetails(e.target.value)}
                    placeholder="• Includes 28 days of portioned mixes..."
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-xs text-slate-800 focus:bg-white focus:border-wa-teal focus:ring-1 focus:ring-wa-teal"
                  />
                </div>
              )}

              <div className="border-t border-slate-200 pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-wa-teal hover:bg-teal-700 text-white font-semibold px-4 py-2 rounded-lg transition cursor-pointer flex items-center gap-1"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Item</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Interactive Guided Tutorial Walkthrough Modal */}
      <BotFlowTutorialModal
        isOpen={tutorialOpen}
        onClose={() => setTutorialOpen(false)}
        tutorialStep={tutorialStep}
        onNext={nextTutorialStep}
        onPrev={prevTutorialStep}
        onJump={jumpToStep}
      />

    </div>
  );
}

