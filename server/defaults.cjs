// @ts-check
// Default bot content. INITIAL_BOT_RULES / DEFAULT_CATALOG are Arogya Ruchulu's own food bot (only
// for that business); NEUTRAL_CATALOG is the basic flow every other business starts with.
// Used until rules/catalog are saved in Supabase.

const INITIAL_BOT_RULES = [
  {
    id: 'rule_custom_test',
    keyword: 'test',
    matchType: 'contains',
    responseType: 'text',
    responseText: 'testing',
    buttons: [],
    isActive: true
  },
  {
    id: 'rule_1',
    keyword: 'hi',
    matchType: 'contains',
    responseType: 'buttons',
    responseText: 'Welcome to Arogya Ruchulu! 🌿 Pure, healthy, and hygienic wellness meals & diet kits. How can we serve you today?',
    buttons: [
      { id: 'btn_cat_diet_kits', title: '🌿 28-Day Diet Kits' },
      { id: 'btn_cat_rte', title: '🍱 Ready to Eat (RTE)' },
      { id: 'btn_cat_rtc', title: '🍳 Ready to Cook (RTC)' }
    ],
    isActive: true
  },
  {
    id: 'rule_2',
    keyword: 'diet',
    matchType: 'contains',
    responseType: 'buttons',
    responseText: 'We offer doctor-curated 28-day functional diet kits for weight loss (Lean Well) and diabetes glycemic care (Sugar Shield). Tap below to explore:',
    buttons: [
      { id: 'btn_lean_well', title: '🏋️ Lean Well Kit' },
      { id: 'btn_sugar_shield', title: '🩸 Sugar Shield Kit' },
      { id: 'btn_talk_staff', title: '💬 Ask Nutritionist' }
    ],
    isActive: true
  },
  {
    id: 'rule_3',
    keyword: 'price',
    matchType: 'contains',
    responseType: 'text',
    responseText: '🍱 Arogya Pricing Overview:\n• Daily Fresh Thali (RTE): ₹130/meal\n• Millet Khichdi Box (RTE): ₹120/meal\n• Multi-Millet Dosa Batter (1kg RTC): ₹95\n• Lean Well 28-Day Plan Kit: ₹3,499\n• Sugar Shield 28-Day Plan Kit: ₹3,699\n\nReply with "order" or click below to book delivery!',
    buttons: [],
    isActive: true
  },
  {
    id: 'rule_4',
    keyword: 'order',
    matchType: 'contains',
    responseType: 'buttons',
    responseText: 'Ready to place your wellness order? Choose your meal or plan category:',
    buttons: [
      { id: 'btn_cat_rte', title: '🍱 Daily Meal Box' },
      { id: 'btn_cat_diet_kits', title: '🌿 28-Day Plan Kit' },
      { id: 'btn_talk_staff', title: '💬 Speak to Team' }
    ],
    isActive: true
  }
];

const DEFAULT_CATALOG = {
  welcomeMessage: `Welcome to *Arogya Ruchulu*! 🌿\n\nPure, healthy, and hygienic wellness food. How can we serve you today? Tap an option below:`,
  welcomeButtons: [
    { id: 'btn_cat_diet_kits', title: '🌿 28-Day Diet Kits' },
    { id: 'btn_cat_rte', title: '🍱 Ready to Eat (RTE)' },
    { id: 'btn_cat_rtc', title: '🍳 Ready to Cook (RTC)' }
  ],
  dietKitsPrompt: `Welcome to our 28-Day Functional Transformation Kits! 🌿\n\nScientifically curated with doctor & nutritionist routines. Select your kit:`,
  dietKits: [
    { id: 'kit_lean_well', title: '🏋️ Lean Well (28 Days)', description: 'Fat loss, metabolism booster, fiber mixes (₹3,499)', price: 3499, details: `🏋️ *Lean Well 28-Day Plan Kit (₹3,499)*\n\n• Designed for healthy fat loss and metabolic boost.\n• Includes: 28 days of portioned multi-millet meal mixes, high-fiber herbal infusions, and weekly nutrition check-ins.\n• Zero starving, 100% natural.\n\nWould you like to place an order enquiry?` },
    { id: 'kit_sugar_shield', title: '🩸 Sugar Shield (28 Days)', description: 'Low-GI, diabetes & blood sugar control kit (₹3,699)', price: 3699, details: `🩸 *Sugar Shield 28-Day Plan Kit (₹3,699)*\n\n• Specially curated for glycemic control and diabetes care.\n• Includes: Ultra-low GI ancient grain blends, sprouted fenugreek formulas, and sugar-balancing herbal teas.\n• Doctor & nutritionist verified.\n\nWould you like to place an order enquiry?` },
    { id: 'kit_cardio_care', title: '❤️ Cardio Care (28 Days)', description: 'Heart wellness, flax blends, zero refined oil (₹3,599)', price: 3599, details: `❤️ *Cardio Care 28-Day Plan Kit (₹3,599)*\n\n• Specially formulated for cardiovascular wellness, cholesterol balance & blood pressure support.\n• Cold-pressed oils and high omega-3 whole seeds.\n\nWould you like to place an order enquiry?` },
    { id: 'kit_gut_reset', title: '🧘 Gut Reset (28 Days)', description: 'Probiotic-rich gut restoration & detox pack (₹3,299)', price: 3299, details: `🧘 *Gut Reset 28-Day Plan Kit (₹3,299)*\n\n• Restores gut microbiome, resolves acidity, bloating & supports natural digestive fire.\n\nWould you like to place an order enquiry?` },
    { id: 'kit_thyro_balance', title: '🦋 Thyro Balance (28 Days)', description: 'Hormonal support, selenium & iodine ancient grains (₹3,599)', price: 3599, details: `🦋 *Thyro Balance 28-Day Plan Kit (₹3,599)*\n\n• Targeted nutritional support for thyroid hormonal harmony, metabolism and daily energy.\n\nWould you like to place an order enquiry?` },
    { id: 'kit_pcos_care', title: '🌸 PCOS/PCOD Care (28 Days)', description: 'Cycle balance, anti-inflammatory seed & millet kit (₹3,799)', price: 3799, details: `🌸 *PCOS/PCOD Care 28-Day Plan Kit (₹3,799)*\n\n• Cycle balancing seeds, myo-inositol rich grains, anti-inflammatory and hormone-stabilizing meal kit.\n\nWould you like to place an order enquiry?` }
  ],
  rtePrompt: `🍱 *Ready to Eat (RTE) Meals*\n\nFreshly prepared home-style food cooked with cold-pressed oils. Please choose your food preference:`,
  rteVegItems: [
    { id: 'rte_thali_box', title: '🍱 Arogya Daily Veg Thali', description: '3 curries, whole wheat phulkas, rice & rasam (₹130)', price: 130 },
    { id: 'rte_millet_khichdi', title: '🍲 Millet Khichdi & Salad', description: 'Foxtail millet, ghee & sprout salad (₹120)', price: 120 },
    { id: 'rte_palak_paneer_box', title: '🧀 Palak Paneer Millet Box', description: 'Fresh cottage cheese, organic palak & millet roti (₹160)', price: 160 },
    { id: 'rte_protein_bowl', title: '🥗 Sprouts & Paneer Bowl', description: 'High-protein tossed salad with mint dressing (₹99)', price: 99 },
    { id: 'rte_moringa_soup', title: '🍵 Drumstick Moringa Soup', description: 'Immunity booster warm broth (₹75)', price: 75 }
  ],
  rteNonVegItems: [
    { id: 'rte_country_chicken_thali', title: '🍗 Natukodi Millet Thali', description: 'Country chicken curry, ragi sangati & rasam (₹210)', price: 210 },
    { id: 'rte_chicken_protein_box', title: '🥗 Grilled Chicken & Quinoa', description: 'Lean grilled chicken breast, quinoa & veggies (₹199)', price: 199 },
    { id: 'rte_fish_pulusu_box', title: '🐟 Traditional Fish Curry', description: 'Freshwater fish in tangy tamarind herbal gravy (₹220)', price: 220 },
    { id: 'rte_egg_millet_biryani', title: '🥚 Egg Brown Rice Biryani', description: 'Double boiled eggs, aromatic herbs & raita (₹150)', price: 150 }
  ],
  rtcPrompt: `🍳 *Ready to Cook (RTC) Preps*\n\nPreservative-free batters, gravies & pre-mixes. Please choose your category:`,
  rtcVegItems: [
    { id: 'rtc_millet_batter', title: 'Multi-Millet Dosa Batter', description: '5 ancient millets naturally fermented 1kg (₹95)', price: 95 },
    { id: 'rtc_ragi_idli_batter', title: 'Sprouted Ragi Idli Batter', description: 'Soft, calcium-rich traditional batter 1kg (₹105)', price: 105 },
    { id: 'rtc_ragi_malt', title: 'Sprouted Ragi Malt (500g)', description: 'Porridge pre-mix with dry fruits & cardamom (₹180)', price: 180 },
    { id: 'rtc_sambar_base', title: 'Cold-Pressed Sambar Gravy', description: 'Slow-cooked lentil spice paste 250g (₹110)', price: 110 },
    { id: 'rtc_curry_leaf_poddi', title: 'Karivepaku Gunpowder Podi', description: 'Iron-rich organic curry leaf spice powder 200g (₹120)', price: 120 }
  ],
  rtcNonVegItems: [
    { id: 'rtc_andhra_chicken_gravy', title: 'Andhra Chicken Curry Base', description: 'Guntur chilli, shallots, stone-ground spices 300g (₹145)', price: 145 },
    { id: 'rtc_mutton_masala_paste', title: 'Mutton Sukka Paste (300g)', description: 'Black pepper, cold-pressed oil, whole spices (₹175)', price: 175 },
    { id: 'rtc_fish_fry_marinade', title: 'Coastal Fish Fry Marinade', description: 'Tangy tamarind, garlic, stone-ground red masala 250g (₹130)', price: 130 }
  ],
  orderConfirmReply: `🎉 *Order Enquiry Received!* \n\nThank you! We have logged your request. Our delivery team will call or message you on this WhatsApp number to confirm your delivery address and preferred delivery slot.`,
  staffNotificationReply: `Thank you! 👨‍💼 A member of our Arogya Ruchulu team has been notified and will message you right here shortly.`,
  itemNextStep: {
    enabled: true,
    stepType: 'buttons', // 'buttons', 'address_prompt', 'direct'
    name: 'Quantity / Portion Selection',
    prompt: `✅ *Selected: {title}* ({price})\n\nHow many portions would you like to order today?`,
    buttons: [
      { id: 'qty_1', title: '🍽️ 1 Portion', responseMessage: `🎉 *Order Received!* (1 Portion of {title})\n\nOur kitchen has logged your order. Our team will contact you shortly to confirm your delivery address!` },
      { id: 'qty_2', title: '🍽️ 2 Portions', responseMessage: `🎉 *Order Received!* (2 Portions of {title})\n\nOur kitchen has logged your order. Our team will contact you shortly to confirm your delivery address!` },
      { id: 'qty_family', title: '👨‍👩‍👧 Family Pack (4)', responseMessage: `🎉 *Order Received!* (Family Pack of {title})\n\nOur kitchen has logged your order. Our team will contact you shortly to confirm your delivery address!` }
    ],
    finalMessage: `🎉 *Order Received!*\n\nThank you! We have logged your selection. Our kitchen team will contact you shortly on WhatsApp to confirm delivery details.`
  },
  // Arogya's built-in food keywords ("diet", "price", "thali", "batter"...) answer with its menu.
  foodBuiltIns: true,
};

/**
 * Starter bot for every new business (the "basic flow"):
 *   welcome message -> [Our services] [Talk to our team] [Raise a query]
 *   Our services -> list of menuItems -> item details -> [Book / Enquire] [Talk to our team]
 *   Book / Enquire -> orderConfirmReply
 * "Our services" is only shown once the business has added at least one item. The Business Admin or
 * a manager fills it in on the Bot Flow and Keywords pages.
 */
const NEUTRAL_CATALOG = {
  welcomeMessage: 'Welcome! 👋 Thanks for messaging us. How can we help you today?',
  welcomeButtons: [
    { id: 'btn_menu', title: '📋 Our services' },
    { id: 'btn_talk_staff', title: '💬 Talk to our team' },
    { id: 'btn_raise_query', title: '📝 Raise a query' },
  ],
  menuPrompt: 'Here is what we offer. Tap an option to see the details:',
  menuButtonLabel: 'View options',
  menuItems: [],
  enquireButtonLabel: '✅ Book / Enquire',
  dietKitsPrompt: 'Here is what we offer. Select an option:',
  dietKits: [],
  rteVegItems: [],
  rteNonVegItems: [],
  rtcVegItems: [],
  rtcNonVegItems: [],
  orderConfirmReply: 'Thank you! We have received your request. Our team will contact you on this WhatsApp number shortly.',
  staffNotificationReply: 'Thank you! A member of our team has been notified and will message you right here shortly.',
  itemNextStep: {
    enabled: false,
    stepType: 'direct',
    name: 'Next step',
    prompt: '✅ *Selected: {title}*\n\nWhat would you like to do next?',
    buttons: [],
    finalMessage: 'Thank you! We have received your selection. Our team will contact you shortly.',
  },
  foodBuiltIns: false,
};

// Business #1 (created by the M1 migration) keeps the bot it always had.
const AROGYA_BUSINESS_ID = 'a0000000-0000-4000-8000-000000000001';

/**
 * The starting bot for a business: Arogya's original one, or the neutral starter bot.
 * @param {unknown} businessId
 * @returns {{ rules: import('./types.cjs').BotRule[], catalog: import('./types.cjs').Catalog }}
 */
function defaultsFor(businessId) {
  return businessId === AROGYA_BUSINESS_ID
    ? { rules: INITIAL_BOT_RULES, catalog: DEFAULT_CATALOG }
    : { rules: [], catalog: NEUTRAL_CATALOG };
}

module.exports = { INITIAL_BOT_RULES, DEFAULT_CATALOG, NEUTRAL_CATALOG, defaultsFor };
