// ============================================================
//  Predefined support-chat questions + canned answers - the same set
//  shown as quick-question chips on the frontend (Chat.jsx). Matched
//  first (exact, normalized) before ever falling back to the AI bot.
// ============================================================
export const SUPPORT_FAQ = [
  {
    question: 'How do I join for free?',
    answer: 'Use a valid coupon code (like FREEJOIN, when active) at checkout for 100% off the membership fee - otherwise membership is ₹99 for 6 months or 1 year.',
  },
  {
    question: 'Is my ID/data safe here?',
    answer: "Yes - every member is ID-verified with Aadhaar, PAN and a live selfie before being marked Verified, and your documents are only ever visible to you and our admins.",
  },
  {
    question: 'How are trip costs split?',
    answer: "The total trip budget is split equally among all confirmed members of that trip - there's no separate step to work out who owes what.",
  },
  {
    question: 'How do I host/plan a trip?',
    answer: "Go to Plan a Trip and fill in your origin, destination, dates, budget per head, seats and vehicle type - you'll be the organizer and can review who requests to join.",
  },
  {
    question: 'How do I join a trip someone else is hosting?',
    answer: 'Browse Trips, open one you like, and send a request to join it - the organizer will accept or decline it.',
  },
  {
    question: 'How do I get the Verified badge?',
    answer: 'Upload your Aadhaar, PAN and a live selfie from your profile - once an admin reviews and approves them, you get the Verified badge.',
  },
  {
    question: 'What is a Verified Vehicle Owner?',
    answer: "It's the next tier after Verified - also upload your Driving Licence and vehicle RC, and once approved you're marked a Verified Vehicle Owner.",
  },
  {
    question: 'How do referrals work?',
    answer: 'Share your personal referral link from your profile - when someone you refer activates a paid membership, you earn a wallet reward.',
  },
  {
    question: 'How do I withdraw my wallet balance?',
    answer: 'Open your Wallet from your profile and submit a withdrawal request - an admin manually reviews it and pays out via UPI/bank transfer.',
  },
  {
    question: 'How do I become an influencer/promoter?',
    answer: "Apply through the Influencer/Promoter program in your dashboard - once approved you'll get your own discount coupon code and earn a commission on memberships bought with it.",
  },
  {
    question: 'What are Clubs?',
    answer: 'Clubs are interest-based groups (like a car model club or a bike club), each with its own chat - you can join an existing one or start your own.',
  },
  {
    question: 'How do I report or block a member?',
    answer: "Open that member's profile and use the report or block option there - our team reviews every report.",
  },
  {
    question: 'Can I travel in women-only or safety-focused groups?',
    answer: 'Yes - set your co-traveler preference (female-only, male-only, or both) in your profile, and women-safe verified groups/trips are shown accordingly.',
  },
  {
    question: 'How do I delete my account?',
    answer: 'Send that request here and a human from our team will process the account deletion for you.',
  },
];

const normalize = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

const FAQ_MAP = new Map(SUPPORT_FAQ.map((f) => [normalize(f.question), f.answer]));

export function matchFaqAnswer(text) {
  return FAQ_MAP.get(normalize(text)) || null;
}
