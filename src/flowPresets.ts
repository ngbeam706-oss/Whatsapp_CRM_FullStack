// -------------------------------------------------------------
// WhatsApp Bot Flow Preset Templates & Guided Tutorial Data
// -------------------------------------------------------------

import type { StepButton } from './types';

/** A ready-made "next step" the owner can start from. */
export interface StepPreset {
  key: string;
  name: string;
  stepType: 'buttons' | 'direct' | string;
  prompt: string;
  buttons: StepButton[];
  finalMessage: string;
}

export const STEP_PRESETS: Record<string, StepPreset> = {
  portions: {
    key: 'portions',
    name: 'Quantity / Portion Selection',
    stepType: 'buttons',
    prompt: '✅ *Selected: {title}* ({price})\n\nHow many portions would you like to order today?',
    buttons: [
      { id: 'qty_1', title: '🍽️ 1 Portion', responseMessage: '🎉 *Order Received!* (1 Portion of {title})\n\nOur kitchen has logged your order. Our team will contact you shortly to confirm your delivery address!' },
      { id: 'qty_2', title: '🍽️ 2 Portions', responseMessage: '🎉 *Order Received!* (2 Portions of {title})\n\nOur kitchen has logged your order. Our team will contact you shortly to confirm your delivery address!' },
      { id: 'qty_family', title: '👨‍👩‍👧 Family Pack (4)', responseMessage: '🎉 *Order Received!* (Family Pack of {title})\n\nOur kitchen has logged your order. Our team will contact you shortly to confirm your delivery address!' }
    ],
    finalMessage: '🎉 *Order Received!*\n\nThank you! We have logged your selection. Our kitchen team will contact you shortly on WhatsApp to confirm delivery details.'
  },
  delivery_slots: {
    key: 'delivery_slots',
    name: 'Delivery Time Slot',
    stepType: 'buttons',
    prompt: '✅ *Selected: {title}* ({price})\n\nPlease select your preferred delivery time slot:',
    buttons: [
      { id: 'slot_lunch', title: '☀️ Lunch (12:30 PM)', responseMessage: '🎉 *Slot Booked: Lunch Delivery (12:30 PM)* for {title}!\n\nOur delivery rider will reach you around 12:30 PM. We will message you to confirm your address.' },
      { id: 'slot_dinner', title: '🌙 Dinner (7:30 PM)', responseMessage: '🎉 *Slot Booked: Dinner Delivery (7:30 PM)* for {title}!\n\nOur kitchen will prepare your meal fresh for 7:30 PM delivery.' },
      { id: 'slot_tomorrow', title: '📦 Pre-Order Tomorrow', responseMessage: '🎉 *Pre-order Confirmed for Tomorrow* ({title})!\n\nThank you! We will prepare your meal fresh tomorrow.' }
    ],
    finalMessage: '🎉 *Slot Booked!*\n\nOur delivery team has logged your timing for {choice}.'
  },
  meal_addons: {
    key: 'meal_addons',
    name: 'Healthy Meal Add-ons',
    stepType: 'buttons',
    prompt: '✅ *Selected: {title}* ({price})\n\nWould you like to add an immunity booster or side dish?',
    buttons: [
      { id: 'addon_sprouts', title: '🥗 Add Sprouts (+₹40)', responseMessage: '🎉 *Order Received with Fresh Sprouts Bowl!* ({title})\n\nOur team will confirm your delivery address shortly.' },
      { id: 'addon_buttermilk', title: '🥛 Buttermilk (+₹30)', responseMessage: '🎉 *Order Received with Organic Spiced Buttermilk!* ({title})\n\nOur team will confirm your delivery address shortly.' },
      { id: 'addon_none', title: '🛵 No Add-ons', responseMessage: '🎉 *Order Confirmed!* ({title})\n\nOur kitchen has logged your order and will contact you shortly!' }
    ],
    finalMessage: '🎉 *Order Confirmed!*\n\nOur kitchen has logged your selection with {choice}.'
  },
  address_prompt: {
    key: 'address_prompt',
    name: 'Delivery Address & Location Prompt',
    stepType: 'address_prompt',
    prompt: '✅ *Selected: {title}* ({price})\n\nGreat choice! 📍 Please reply with your Delivery Address, House No, Landmark, or share your WhatsApp Live Location:',
    buttons: [],
    finalMessage: 'Thank you! We have received your address and are preparing your order.'
  },
  direct_order: {
    key: 'direct_order',
    name: 'Direct Order Confirmation (Default)',
    stepType: 'direct',
    prompt: '✅ *Selected: {title}*\n\nPrice: {price}\n{desc}\n\nWhat would you like to do next?',
    buttons: [
      { id: 'btn_confirm', title: '🛵 Order Now', responseMessage: '🎉 *Order Enquiry Received!* \n\nThank you! We have logged your request. Our delivery team will call or message you on this WhatsApp number to confirm your delivery address and preferred delivery slot.' },
      { id: 'btn_diet_kits', title: '🌿 View 28-Day Kits', responseMessage: '' }
    ],
    finalMessage: '🎉 *Order Enquiry Received!*'
  }
};

export const TUTORIAL_STEPS = [
  {
    step: 1,
    title: 'Visual Flow Architecture',
    badge: 'Step 1 of 5: The Big Picture',
    targetTab: 'visual_flow',
    icon: 'GitBranch',
    tagline: 'Understand the multi-level journey your WhatsApp customer takes.',
    description: [
      'Level 1: Welcome Greeting ("Hi") with 3 interactive category buttons.',
      'Level 2: Interactive Lists for 28-Day Diet Kits, RTE Meals, and RTC Batters.',
      'Level 3: Connected Step After Selection (e.g. Quantity or Delivery Slot).',
      'Level 4: Final Order Receipt & Notification to Kitchen / Delivery Team.'
    ],
    proTip: 'Every single message, price, and button shown in the tree diagram is editable directly in this UI!',
    actionText: 'Next: Explore Menus & Prices →'
  },
  {
    step: 2,
    title: 'Managing Menus & Prices',
    badge: 'Step 2 of 5: Catalog Control',
    targetTab: 'rte',
    icon: 'ShoppingBag',
    tagline: 'Add, edit, or remove food items without writing any backend code.',
    description: [
      'Click "Ready to Eat (RTE)" or "Ready to Cook (RTC)" to browse current dishes.',
      'Add New Dishes with Name, Price (₹), and Description with 1 click.',
      'Meta Character Limits are automatically enforced: Titles (max 24 chars) and descriptions (max 72 chars) so Meta Cloud API never rejects them.',
      'Edit prices or delete out-of-stock items in real-time.'
    ],
    proTip: 'All changes automatically sync to Supabase so your menu stays persistent even when Netlify reboots.',
    actionText: 'Next: Step After Food Selection →'
  },
  {
    step: 3,
    title: 'Step After Food Selection Builder',
    badge: 'Step 3 of 5: The Magic Next Step',
    targetTab: 'next_step',
    icon: 'Layers',
    tagline: 'Control what happens immediately after a customer picks a dish.',
    description: [
      'Choose from 5 One-Click Presets: Portion & Quantity (1 or 2 meals), Delivery Time Slot (Lunch/Dinner), Healthy Add-ons, Address Prompt, or Direct Order.',
      'Customize the WhatsApp Message Prompt using dynamic placeholders: {title}, {price}, and {desc}.',
      'Edit up to 3 interactive tap buttons and define what message WhatsApp replies when each button is clicked!'
    ],
    proTip: 'Meta Cloud API allows up to 3 quick-reply buttons with a 20-character limit per button title.',
    actionText: 'Next: Live Phone Simulator →'
  },
  {
    step: 4,
    title: 'Live WhatsApp Customer Simulator',
    badge: 'Step 4 of 5: Real-Time Preview',
    targetTab: 'next_step',
    icon: 'Eye',
    tagline: 'Preview the exact mobile screen before your customers see it.',
    description: [
      'On the right side of the Step Builder, you see a real-time WhatsApp mobile phone frame.',
      'Shows the customer\'s selection bubble ("Selected: Daily Veg Thali").',
      'Renders the interactive buttons exactly as they appear on WhatsApp Android & iOS.',
      'Updates dynamically in real-time as you type your changes!'
    ],
    proTip: 'Use the simulator to verify that your button titles and prompt formatting look clean before saving.',
    actionText: 'Next: Instant Sync & Testing →'
  },
  {
    step: 5,
    title: 'Instant Sync & Testing on Phone',
    badge: 'Step 5 of 5: Go Live',
    targetTab: 'visual_flow',
    icon: 'CheckCircle2',
    tagline: 'Your changes are live immediately—test it right from your personal WhatsApp!',
    description: [
      'When you click "Save Step Configuration" or edit any menu item, it updates your database.',
      'The live serverless Netlify function fetches the latest catalog on the very next incoming message.',
      'Test right now: Send "Hi" to +91 97011 01555, tap a meal, and watch your new step trigger instantly!'
    ],
    proTip: 'You can replay this tutorial anytime by clicking the "Interactive Tutorial" button in the top header.',
    actionText: 'Complete Tutorial 🎉'
  }
];

