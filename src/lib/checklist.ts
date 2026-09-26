export interface ChecklistStepMeta {
  id: string;
  title: string;
  text: string;
}

/** The 10 "moving checklist" steps' static title/description, shared between NewcomerChecklist.astro (which adds
 * per-borough links on top) and the Guides pages (which show a generic, link-free version in their sidebar). */
export const CHECKLIST_STEPS: ChecklistStepMeta[] = [
  {
    id: "gp",
    title: "Register with a GP and a dentist",
    text: "Registering is free and you don't need proof of address or ID. Do it early: dentists in particular can have long waiting lists.",
  },
  {
    id: "vote",
    title: "Register to vote",
    text: "It takes about five minutes, and being on the electoral register also helps with credit checks and getting a mortgage or phone contract.",
  },
  {
    id: "council-tax",
    title: "Sort out Council Tax",
    text: "You are usually liable from the day you move in. Check your band, and ask about discounts such as the 25% single person discount.",
  },
  {
    id: "bins",
    title: "Find your bin and recycling days",
    text: "Collection days differ street by street, so the council looks them up by address. Check what goes in each bin and how to book bulky waste.",
  },
  {
    id: "parking",
    title: "Parking and getting around",
    text: "Many streets need a resident parking permit, and the rules differ between boroughs. Check the controlled parking zone before you bring a car.",
  },
  {
    id: "address",
    title: "Tell people your new address",
    text: "Update your driving licence, HMRC, your bank, insurers and employer. Redirect your post for a few months so nothing is missed, and get a TV licence if you need one.",
  },
  {
    id: "broadband",
    title: "Check broadband and mobile signal",
    text: "Look at what speeds are available on your street before you sign a contract, and order early: some installations take weeks.",
  },
  {
    id: "schools",
    title: "Schools and childcare",
    text: "If you have children, check school admissions deadlines early. They are set by the council and can fall well before you move in.",
  },
  {
    id: "area",
    title: "Get to know the area",
    text: "Find the nearest parks, libraries and places to eat, and who represents you locally.",
  },
  {
    id: "report",
    title: "Know how to report problems",
    text: "Save these for later: fixing potholes, litter, graffiti and broken street lights is usually quicker through the council's own forms.",
  },
];

export function getChecklistStepMeta(id: string): ChecklistStepMeta | undefined {
  return CHECKLIST_STEPS.find((s) => s.id === id);
}
