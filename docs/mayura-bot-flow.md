# Mayura Hospitals: WhatsApp bot flow and quick replies

**APPLIED 2026-11-14** to Mayura Hospitals test (live data; no deploy needed: the bot reads it on every message).
What went live uses wording that needs no unknown facts: welcome + [🩺 Book appointment] [📍 Timings & address]
[💬 Talk to our team]; options New appointment, Follow-up visit, Reschedule / cancel, Reports, Consultation fees,
Timings & address, Emergency (+ Talk to our team), each with [✅ Continue] [💬 Talk to our team]; 23 keyword replies
(book / timings / emergency / fees / reports / reschedule words); 15 team quick replies. The test keyword
"appointment → please describe your health problems" was removed. Checked with a dry run of the real bot code
(nothing sent). Still to add when Mayura gives them: departments, OPD timings, address + map link, emergency and
front-desk phone (they go into "Timings & address" and the /timings, /address quick replies).

---
Original draft (2026-11-14):

Business: **Mayura Hospitals test** (Healthcare). Built only from the bot's existing pieces (welcome + 3 buttons, a list
of up to 9 options + "Talk to our team", option details with [Book appointment] [Talk to our team], keyword
replies, the team's saved replies). Rules: no health or cure claims, no invented prices or facts; anything about
the patient's problem goes to a person.

**[ ] = a fact Mayura must give before this goes live.**

## 1. Welcome (any first message, "hi", "hello", "namaste", "menu")
> Namaste 🙏 Welcome to *Mayura Hospitals*.
> We can help you book a doctor's appointment, share our timings and address, or connect you with our front desk.
> For a medical emergency, please call **108** or come straight to our emergency department.

Buttons: **[🩺 Book appointment]** **[📍 Timings & address]** **[💬 Talk to our team]**

## 2. 🩺 Book appointment → list "Choose a department" (button: *View departments*)
| Row | Details shown when tapped |
|---|---|
| [Department 1, e.g. General Medicine] | *[Department 1]* · Doctors: [names] · OPD: [days, hours]. Tap *Book appointment* and our front desk will confirm a time with you here. |
| [Department 2] | same pattern |
| … up to 7 departments | |
| 🕘 Timings & address | (same as button 3) |
| 💬 Talk to our team | (always last; a person replies) |

Each department → **[✅ Book appointment]** **[💬 Talk to our team]**.
*Book appointment* reply:
> Thank you! Our front desk will message you here shortly to fix a time. Please keep ready: the patient's full name,
> age, and the reason for the visit.

(The front desk then books it in the CRM: patient details, doctor, free time, payment type.)

## 3. 📍 Timings & address
> 🕘 *OPD timings:* [Mon–Sat, 9:00 am – 8:00 pm; Sunday: …]
> 🚑 *Emergency:* [24 × 7?] · [emergency phone]
> 📍 *Address:* [full address]
> 🗺️ [Google Maps link]
> 📞 Front desk: [phone]

## 4. 💬 Talk to our team
> Thank you! A member of our front desk has been notified and will message you right here shortly.

## 5. Keyword replies (patients often type these)
| Patient types | Bot replies |
|---|---|
| appointment, book, booking, consult | the department list (2) |
| timing, timings, open, hours, address, location, where | Timings & address (3) |
| emergency, urgent, ambulance | "For a medical emergency please call **108** or come to our emergency department now. [Emergency phone]." + [💬 Talk to our team] |
| fee, fees, charges, cost, price | "Consultation fees depend on the doctor. Our front desk will share the exact fee when they confirm your appointment." + [🩺 Book appointment] [💬 Talk to our team] |
| report, reports, result, test results | "For reports, please share the patient's name and the test date. Our team will check and reply here." + [💬 Talk to our team] |
| doctor, doctors | the department list (2) |
| cancel, reschedule, change | "Please share the patient's name and the appointment date. Our front desk will help you here." + [💬 Talk to our team] |

Removes the test keyword "appointment → please describe your health problems" (the bot shouldn't ask for symptoms).

## 6. Quick replies for the team (type `/` in the chat box)
| Shortcut | Text (the agent edits the [ ] before sending) |
|---|---|
| /welcome | Namaste 🙏 Thank you for contacting Mayura Hospitals. How can I help you today? |
| /details | To book the appointment, please share: the patient's full name, age, gender, and the reason for the visit. |
| /slots | Dr [name] is available on [day] at [time 1] or [time 2]. Which time suits you? |
| /confirmed | ✅ Your appointment is confirmed: Dr [name], [day, date] at [time]. Please come 15 minutes early with any old reports and prescriptions. |
| /paylink | Please pay the consultation fee of ₹[amount] using the payment link we just sent. Your appointment is confirmed as soon as the payment goes through. |
| /payatdesk | You can pay the consultation fee of ₹[amount] at the reception desk when you come, by cash, UPI or card. |
| /paid | Thank you, we have received your payment of ₹[amount]. Reference: [reference ID]. |
| /timings | 🕘 OPD: [timings]. 🚑 Emergency: [emergency]. |
| /address | 📍 [address] · 🗺️ [Maps link] |
| /reschedule | No problem. Which day and time would suit you better? We'll check Dr [name]'s free slots. |
| /reminder | Reminder: your appointment with Dr [name] is on [day] at [time]. Reply here if you need to change it. |
| /followup | Dr [name] has advised a follow-up visit around [date]. Shall I book it for you? |
| /reports | Your report is ready. You can collect it from [counter] between [time], or we can share it here. |
| /emergency | For a medical emergency, please call 108 or come straight to our emergency department. [Emergency phone] |
| /thanks | Thank you for choosing Mayura Hospitals. Take care! 🙏 |

## Facts needed from Mayura
1. Departments / specialities (up to 7), and which doctors are in each.
2. OPD days and timings (and Sunday / holidays).
3. Emergency: 24 × 7 or not, and the emergency phone number.
4. Full address and the Google Maps link.
5. Front-desk phone number.
6. Languages: English only, or English + Telugu?
